import type { Pool, PoolClient } from 'pg';
import {
  assertSynthetic, buildBundle, cancelEncounter, confirmBundle, encryptionKey, GatewayError, sendFhir,
  type DispatchData,
} from './fhir.js';

export interface OutboxOptions {
  batchSize?: number;
  timeoutMs?: number;
  maxAttempts?: number;
  retryDelayMs?: number;
}
interface OutboxRow { id: string; aggregate_id: string; type: string; payload: { ticketId?: unknown; reason?: unknown }; attempts: number }
interface TicketData extends DispatchData {
  status: string; external_ref: string | null; valid_until: Date | null;
  connector_base_url: string; connector_kind: string; synthetic: boolean;
  accepts_remote_tickets: boolean; ticket_window_min: number;
  red_flags: string[]; erased_at: Date | null; cancellation_pending: boolean;
  report_patient_id: string;
}

async function event(client: PoolClient, ticketId: string, type: string, payload: Record<string, unknown> = {}): Promise<void> {
  await client.query('INSERT INTO ops.ticket_event(ticket_id, type, payload) VALUES ($1,$2,$3)', [ticketId, type, payload]);
  await client.query("INSERT INTO ops.audit_log(actor, action, resource) VALUES ('gateway', $1, $2)", [type, `ticket:${ticketId}`]);
}

async function publish(client: PoolClient, id: string): Promise<void> {
  await client.query('UPDATE ops.outbox SET published_at = now() WHERE id = $1', [id]);
}

async function enqueueExpired(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const due = await client.query<{ id: string }>(`SELECT id FROM ops.ticket
      WHERE status = 'active' AND valid_until <= now() AND NOT cancellation_pending
      ORDER BY valid_until LIMIT 100 FOR UPDATE SKIP LOCKED`);
    for (const { id } of due.rows) {
      await client.query('UPDATE ops.ticket SET cancellation_pending = true WHERE id = $1', [id]);
      await client.query(`INSERT INTO ops.outbox(aggregate_id,type,payload)
        VALUES ($1::uuid,'ticket.cancel',jsonb_build_object('ticketId',($1::uuid)::text,'reason','expired'))`, [id]);
      await event(client, id, 'ticket.expiry_requested');
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

/** Uma transação por mensagem mantém os locks até a confirmação HTTP com timeout. */
export async function processOutbox(pool: Pool, options: OutboxOptions = {}): Promise<number> {
  assertSynthetic();
  const key = encryptionKey();
  const { batchSize = 10, timeoutMs = 4000, maxAttempts = 3, retryDelayMs = 1000 } = options;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100
    || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000
    || !Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10
    || !Number.isInteger(retryDelayMs) || retryDelayMs < 0 || retryDelayMs > 60000) throw new Error('Limites inválidos do worker.');
  await enqueueExpired(pool);
  let processed = 0;
  for (; processed < batchSize; processed++) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout = '2s'");
      await client.query("SET LOCAL statement_timeout = '5s'");
      const selected = await client.query<OutboxRow>(`SELECT * FROM ops.outbox
        WHERE published_at IS NULL AND next_attempt_at <= now()
        ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED`);
      const row = selected.rows[0];
      if (!row) { await client.query('COMMIT'); break; }
      const result = await client.query<TicketData>(`SELECT t.*, f.name, f.connector_base_url, f.connector_kind,
        f.synthetic, f.accepts_remote_tickets, f.ticket_window_min,
        r.urgency_level, r.specialties, r.red_flags, r.explanation, r.ruleset_version, r.content_hash, r.created_at,
        s.patient_id AS report_patient_id,
        p.full_name_enc, p.cpf_enc, p.cns_enc, p.birth_date_enc, p.erased_at
        FROM ops.ticket t JOIN network.facility f ON f.id = t.facility_id
        JOIN clinical.triage_report r ON r.id = t.report_id
        JOIN clinical.triage_session s ON s.id = r.session_id
        JOIN identity.patient p ON p.id = t.patient_id
        WHERE t.id = $1 FOR UPDATE OF t`, [row.aggregate_id]);
      const ticket = result.rows[0];
      if (!ticket) {
        await publish(client, row.id);
        await client.query("INSERT INTO ops.audit_log(actor,action,resource) VALUES ('gateway','outbox.sem_ticket',$1)", [`outbox:${row.id}`]);
        await client.query('COMMIT');
        continue;
      }
      try {
        if (!row.payload || row.payload.ticketId !== ticket.id || !['ticket.requested', 'ticket.cancel'].includes(row.type)) {
          throw new GatewayError('OUTBOX_MENSAGEM_INVALIDA');
        }
        if (row.type === 'ticket.requested') {
          if (!['requested', 'sent'].includes(ticket.status)) { await publish(client, row.id); await client.query('COMMIT'); continue; }
          if (ticket.status === 'requested') {
            await client.query("UPDATE ops.ticket SET status = 'sent' WHERE id = $1", [ticket.id]);
            await event(client, ticket.id, 'ticket.sent');
            ticket.status = 'sent';
          }
          if (!ticket.synthetic || ticket.connector_kind !== 'fhir_r4' || !ticket.accepts_remote_tickets) throw new GatewayError('UNIDADE_SINTETICA_INDISPONIVEL');
          if (ticket.red_flags.length || ticket.urgency_level === 1 || ticket.report_patient_id !== ticket.patient_id) throw new GatewayError('LAUDO_NAO_ELEGIVEL');
          // Serializa revogação/anonimização com o envio, inclusive nas novas tentativas.
          const patient = await client.query('SELECT id FROM identity.patient WHERE id = $1 AND erased_at IS NULL FOR SHARE', [ticket.patient_id]);
          const consent = await client.query(`SELECT id FROM identity.consent
            WHERE patient_id = $1 AND purpose = 'share_with_facility' AND revoked_at IS NULL AND granted_at <= now() FOR SHARE`, [ticket.patient_id]);
          if (!patient.rowCount || !consent.rowCount) throw new GatewayError('COMPARTILHAMENTO_NAO_AUTORIZADO');
          const bundle = await buildBundle(ticket, key);
          const accepted = await confirmBundle(ticket.connector_base_url, await sendFhir(ticket.connector_base_url, bundle, timeoutMs), ticket, timeoutMs);
          await client.query(`UPDATE ops.ticket SET status = 'active', external_ref = $2, display_code = $3,
            issued_at = COALESCE(issued_at, now()), valid_until = COALESCE(valid_until, now() + $4 * interval '1 minute'),
            failure_reason = NULL WHERE id = $1`, [ticket.id, accepted.externalRef, accepted.displayCode, ticket.ticket_window_min]);
          await event(client, ticket.id, 'ticket.active', { synthetic: true });
        } else {
          if (!['requested', 'sent', 'active'].includes(ticket.status)) {
            await client.query('UPDATE ops.ticket SET cancellation_pending = false WHERE id = $1', [ticket.id]);
            await publish(client, row.id);
            await client.query('COMMIT');
            continue;
          }
          if (!ticket.synthetic || ticket.connector_kind !== 'fhir_r4') throw new GatewayError('UNIDADE_SINTETICA_INDISPONIVEL');
          if (!ticket.external_ref) throw new GatewayError('CANCELAMENTO_AGUARDA_EMISSAO', true);
          // Não envia PII no cancelamento; revogação não impede desfazer um envio anterior.
          await cancelEncounter(ticket.connector_base_url, ticket.external_ref, ticket.idempotency_key, timeoutMs);
          const expired = row.payload.reason === 'expired' && ticket.valid_until !== null && ticket.valid_until.getTime() <= Date.now();
          const status = expired ? 'expired' : 'cancelled';
          await client.query('UPDATE ops.ticket SET status = $2, cancellation_pending = false, failure_reason = NULL WHERE id = $1', [ticket.id, status]);
          await event(client, ticket.id, `ticket.${status}`, { synthetic: true });
        }
        await publish(client, row.id);
      } catch (error) {
        // Erros SQL abortam a transação: deixam a mensagem intacta para a próxima execução.
        if (!(error instanceof GatewayError)) throw error;
        const attempts = row.attempts + 1;
        const retry = error.retryable && attempts < maxAttempts;
        await client.query(`UPDATE ops.outbox SET attempts = $2,
          next_attempt_at = now() + $3 * interval '1 millisecond',
          published_at = CASE WHEN $4 THEN NULL ELSE now() END WHERE id = $1`,
        [row.id, attempts, Math.min(60000, retryDelayMs * 2 ** (attempts - 1)), retry]);
        const cancellation = row.type === 'ticket.cancel';
        if (!retry && !cancellation && ['requested', 'sent'].includes(ticket.status)) {
          const rejected = /^FHIR_HTTP_4\d\d$/.test(error.code) && !error.retryable;
          await client.query('UPDATE ops.ticket SET status = $2, failure_reason = $3 WHERE id = $1', [ticket.id, rejected ? 'rejected' : 'failed', error.code]);
        } else {
          // Falha de cancelamento não libera a senha nem finge confirmação externa.
          await client.query('UPDATE ops.ticket SET failure_reason = $2 WHERE id = $1', [ticket.id, error.code]);
        }
        await event(client, ticket.id, retry ? 'gateway.retry_scheduled' : cancellation ? 'ticket.cancellation_failed' : 'ticket.dispatch_failed', { reason: error.code, attempts });
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }
  return processed;
}
