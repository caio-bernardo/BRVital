import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { createHash } from 'node:crypto';
import { v7 as uuid } from 'uuid';
import type { Recommendation, Ticket } from '@brvital/contracts';
import { Database, audit } from '../database.js';
import { TriageService } from '../triage/triage.service.js';
import { assertTicketTransition, checkTicketRequest } from '../domain/tickets.js';

export function toTicket(row: Record<string, unknown>): Ticket {
  return { id: row.id as string, reportId: row.report_id as string, facilityId: row.facility_id as string, status: row.status as Ticket['status'],
    displayCode: row.display_code as string | null, externalRef: row.external_ref as string | null, validUntil: row.valid_until ? (row.valid_until as Date).toISOString() : null,
    failureReason: row.failure_reason ? 'A unidade não confirmou a operação. Atualize o status ou escolha outra unidade após a falha de emissão.' : null, cancellationPending: row.cancellation_pending as boolean };
}
async function event(client: PoolClient, patientId: string, ticketId: string, type: string) {
  await client.query('INSERT INTO ops.ticket_event(ticket_id,type,payload) VALUES($1,$2,$3)', [ticketId, type, { synthetic: true }]);
  await audit(client, `patient:${patientId}`, type, `ticket:${ticketId}`);
}
@Injectable()
export class TicketService {
  constructor(@Inject(Database) private readonly db: Database, @Inject(TriageService) private readonly triage: TriageService) {}
  async get(patientId: string, id: string) {
    const row = (await this.db.pool.query('SELECT * FROM ops.ticket WHERE id=$1 AND patient_id=$2', [id, patientId])).rows[0];
    if (!row) throw new NotFoundException('Senha não encontrada.');
    return toTicket(row);
  }
  async active(patientId: string) {
    const row = (await this.db.pool.query("SELECT * FROM ops.ticket WHERE patient_id=$1 AND status IN ('requested','sent','active')", [patientId])).rows[0];
    return row ? toTicket(row) : null;
  }
  async issue(patientId: string, body: { reportId: string; facilityId: string }, key: string) {
    return this.db.transaction(async client => {
      const lock = createHash('sha256').update(`ticket:${key}`).digest().readBigInt64BE();
      await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [lock.toString()]);
      await client.query('SELECT id FROM identity.patient WHERE id=$1 FOR UPDATE', [patientId]);
      const existing = (await client.query('SELECT * FROM ops.ticket WHERE idempotency_key=$1', [key])).rows[0];
      if (existing) {
        if (existing.patient_id !== patientId || existing.report_id !== body.reportId || existing.facility_id !== body.facilityId) throw new ConflictException('Chave de idempotência já utilizada em outra solicitação.');
        return toTicket(existing);
      }
      await this.triage.requireConsent(client, patientId, 'share_with_facility');
      await this.triage.requireProfile(client, patientId);
      const report = (await client.query(`SELECT r.*,s.recommendations,s.status AS session_status FROM clinical.triage_report r
        JOIN clinical.triage_session s ON s.id=r.session_id WHERE r.id=$1 AND s.patient_id=$2`, [body.reportId, patientId])).rows[0];
      if (!report) throw new NotFoundException('Laudo não encontrado.');
      const consents = (await client.query('SELECT purpose,granted_at,revoked_at FROM identity.consent WHERE patient_id=$1 AND revoked_at IS NULL AND granted_at<=now()', [patientId])).rows;
      try { checkTicketRequest({ redFlags: report.red_flags }, consents); } catch { throw new ForbiddenException('Emissão não autorizada. Confira o laudo e os consentimentos.'); }
      if (report.urgency_level === 1 || report.session_status !== 'completed') throw new ForbiddenException('Sinal de emergência. Ligue 192; não será emitida senha.');
      const recommendations = (report.recommendations ?? []) as Recommendation[];
      if (!recommendations.some(item => item.facilityId === body.facilityId)) throw new ForbiddenException('Escolha uma unidade da lista de recomendações atualizada.');
      const facility = (await client.query(`SELECT f.id FROM network.facility f WHERE f.id=$1 AND f.synthetic AND f.accepts_remote_tickets
        AND EXISTS(SELECT 1 FROM network.facility_specialty fs WHERE fs.facility_id=f.id AND fs.specialty_code=ANY($2::text[]) AND fs.open_hours @> '{"alwaysOpen":true}')`, [body.facilityId, report.specialties])).rows[0];
      if (!facility) throw new ConflictException('Unidade indisponível. Atualize as recomendações.');
      const active = await client.query("SELECT id FROM ops.ticket WHERE patient_id=$1 AND status IN ('requested','sent','active')", [patientId]);
      if (active.rowCount) throw new ConflictException('Você já tem uma senha em andamento. Acompanhe a senha atual.');
      const ticket = (await client.query(`INSERT INTO ops.ticket(id,report_id,patient_id,facility_id,status,priority,idempotency_key)
        VALUES($1,$2,$3,$4,'requested',$5,$6) RETURNING *`, [uuid(), body.reportId, patientId, body.facilityId, report.urgency_level, key])).rows[0];
      await client.query('INSERT INTO ops.outbox(aggregate_id,type,payload) VALUES($1,$2,$3)', [ticket.id, 'ticket.requested', { ticketId: ticket.id }]);
      await client.query('INSERT INTO ops.outcome(ticket_id) VALUES($1)', [ticket.id]);
      await event(client, patientId, ticket.id, 'ticket.requested');
      return toTicket(ticket);
    });
  }
  async cancel(patientId: string, id: string) {
    return this.db.transaction(async client => {
      const ticket = (await client.query('SELECT * FROM ops.ticket WHERE id=$1 AND patient_id=$2 FOR UPDATE', [id, patientId])).rows[0];
      if (!ticket) throw new NotFoundException('Senha não encontrada.');
      if (ticket.status === 'cancelled') return toTicket(ticket);
      try { assertTicketTransition(ticket.status, 'cancelled'); } catch { throw new ConflictException('Aguarde a confirmação da emissão; somente senha ativa pode ser cancelada.'); }
      const pending = await client.query("SELECT id FROM ops.outbox WHERE aggregate_id=$1 AND type='ticket.cancel' AND published_at IS NULL", [id]);
      if (!pending.rowCount) {
        await client.query("INSERT INTO ops.outbox(aggregate_id,type,payload) VALUES($1,'ticket.cancel',$2)", [id, { ticketId: id }]);
        await client.query('UPDATE ops.ticket SET cancellation_pending=true,failure_reason=NULL WHERE id=$1', [id]);
        await event(client, patientId, id, 'ticket.cancellation_requested');
      }
      return toTicket({ ...ticket, cancellation_pending: true, failure_reason: null });
    });
  }
}
