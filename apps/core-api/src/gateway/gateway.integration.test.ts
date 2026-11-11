import 'dotenv/config';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { v7 as uuid } from 'uuid';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { processOutbox } from './outbox.js';

const facilityId = '019b0000-0000-7000-8000-000000000001';
const base = 'http://localhost:8080/fhir';
let app: Pool;
let owner: Pool;

function encrypted(text: string): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(process.env.PII_ENCRYPTION_KEY!, 'base64'), iv);
  const ciphertext = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}

async function fixture(consent = true, redFlags: string[] = []) {
  const patientId = uuid(), sessionId = uuid(), reportId = uuid(), ticketId = uuid();
  const key = `integracao-${uuid()}`;
  const client = await app.connect();
  try {
    await client.query('BEGIN');
    await client.query('INSERT INTO identity.patient(id,phone_hmac,phone_enc,full_name_enc,birth_date_enc) VALUES ($1,$2,$3,$4,$5)',
      [patientId, randomBytes(32), encrypted('+5500000000000'), encrypted('Paciente Fictício de Integração'), encrypted('1990-01-01')]);
    if (consent) await client.query(`INSERT INTO identity.consent(id,patient_id,purpose,policy_version,granted_at)
      VALUES ($1,$2,'share_with_facility','sintetica-v1',now())`, [uuid(), patientId]);
    await client.query(`INSERT INTO clinical.triage_session(id,patient_id,status,answers) VALUES ($1,$2,'completed','{}')`, [sessionId, patientId]);
    await client.query(`INSERT INTO clinical.triage_report(id,session_id,urgency_level,specialties,red_flags,explanation,ruleset_version,content_hash)
      VALUES ($1,$2,3,ARRAY['clinica-geral'],$3,'["Fixture sintética; não utilizar clinicamente."]','sintetica-v1',$4)`,
    [reportId, sessionId, redFlags, createHash('sha256').update('fixture sintética').digest()]);
    await client.query(`INSERT INTO ops.ticket(id,report_id,patient_id,facility_id,status,priority,idempotency_key)
      VALUES ($1,$2,$3,$4,'requested',3,$5)`, [ticketId, reportId, patientId, facilityId, key]);
    const outbox = await client.query<{ id: string }>(`INSERT INTO ops.outbox(aggregate_id,type,payload)
      VALUES ($1::uuid,'ticket.requested',jsonb_build_object('ticketId',($1::uuid)::text)) RETURNING id`, [ticketId]);
    await client.query('COMMIT');
    return { patientId, sessionId, reportId, ticketId, key, outboxId: outbox.rows[0]!.id };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

async function ticket(id: string) {
  return (await app.query('SELECT * FROM ops.ticket WHERE id = $1', [id])).rows[0]!;
}

async function resources(type: string, key: string) {
  const response = await fetch(`${base}/${type}?identifier=${encodeURIComponent(`urn:brvital:idempotency:${type}|${key}`)}`, { signal: AbortSignal.timeout(5000) });
  expect(response.status).toBe(200);
  return await response.json() as { total: number; entry?: { resource: Record<string, unknown> }[] };
}

async function cancel(ticketId: string) {
  const client = await app.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE ops.ticket SET cancellation_pending = true WHERE id = $1', [ticketId]);
    await client.query(`INSERT INTO ops.outbox(aggregate_id,type,payload) VALUES ($1::uuid,'ticket.cancel',jsonb_build_object('ticketId',($1::uuid)::text))`, [ticketId]);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

describe.skipIf(process.env.RUN_INTEGRATION !== '1')('worker + PostgreSQL/PostGIS + HAPI reais (somente sintético)', () => {
  beforeAll(async () => {
    if (process.env.APP_MODE !== 'synthetic' || process.env.NODE_ENV === 'production' || !process.env.DATABASE_URL || !process.env.DATABASE_MIGRATOR_URL) {
      throw new Error('Integração exige modo sintético, banco local migrado/seed e URLs das duas roles.');
    }
    app = new Pool({ connectionString: process.env.DATABASE_URL, max: 8 });
    owner = new Pool({ connectionString: process.env.DATABASE_MIGRATOR_URL });
    expect((await app.query('SELECT current_user')).rows[0].current_user).toBe('brvital_app');
    expect((await fetch(base + '/metadata', { signal: AbortSignal.timeout(5000) })).status).toBe(200);
  });
  afterAll(async () => { await app?.end(); await owner?.end(); });

  it('emite quatro recursos, repete após perda de confirmação sem duplicar e cancela somente após confirmação externa', async () => {
    const f = await fixture();
    await processOutbox(app);
    expect(await ticket(f.ticketId)).toMatchObject({ status: 'active', display_code: `DEMO-${f.ticketId.toUpperCase()}`, failure_reason: null });
    const original = await ticket(f.ticketId);
    for (const type of ['Patient', 'Encounter', 'Observation', 'DocumentReference']) expect((await resources(type, f.key)).total).toBe(1);
    const document = (await resources('DocumentReference', f.key)).entry![0]!.resource;
    const content = document.content as { attachment: { data: string; hash: string } }[];
    const pdf = Buffer.from(content[0]!.attachment.data, 'base64');
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(content[0]!.attachment.hash).toBe(createHash('sha1').update(pdf).digest('base64'));
    expect(document.extension).toContainEqual({ url: 'urn:brvital:pdf-sha256', valueString: createHash('sha256').update(pdf).digest('hex') });

    // Simula queda do worker depois do commit remoto e antes do commit local.
    await app.query("UPDATE ops.ticket SET status='sent',external_ref=NULL,display_code=NULL WHERE id=$1", [f.ticketId]);
    await app.query('UPDATE ops.outbox SET published_at=NULL WHERE id=$1', [f.outboxId]);
    await processOutbox(app);
    expect((await ticket(f.ticketId)).external_ref).toBe(original.external_ref);
    for (const type of ['Patient', 'Encounter', 'Observation', 'DocumentReference']) expect((await resources(type, f.key)).total).toBe(1);

    await cancel(f.ticketId);
    expect(await ticket(f.ticketId)).toMatchObject({ status: 'active', cancellation_pending: true });
    await processOutbox(app);
    expect(await ticket(f.ticketId)).toMatchObject({ status: 'cancelled', cancellation_pending: false });
    expect((await resources('Encounter', f.key)).entry![0]!.resource.status).toBe('cancelled');
  });

  it('não envia nada ao HAPI sem consentimento, após revogação ou diante de red flag', async () => {
    const absent = await fixture(false);
    const revoked = await fixture();
    await app.query('UPDATE identity.consent SET revoked_at=now() WHERE patient_id=$1', [revoked.patientId]);
    const critical = await fixture(true, ['alerta-sintetico']);
    await processOutbox(app);
    for (const f of [absent, revoked, critical]) {
      expect((await ticket(f.ticketId)).status).toBe('failed');
      for (const type of ['Patient', 'Encounter', 'Observation', 'DocumentReference']) expect((await resources(type, f.key)).total).toBe(0);
    }
    expect((await ticket(absent.ticketId)).failure_reason).toBe('COMPARTILHAMENTO_NAO_AUTORIZADO');
    expect((await ticket(revoked.ticketId)).failure_reason).toBe('COMPARTILHAMENTO_NAO_AUTORIZADO');
    expect((await ticket(critical.ticketId)).failure_reason).toBe('LAUDO_NAO_ELEGIVEL');
  });

  it('banco bloqueia alteração das trilhas inclusive pelo proprietário e mantém unicidade das senhas', async () => {
    const f = await fixture(false);
    await processOutbox(app);
    for (const pool of [app, owner]) {
      for (const [table, column] of [['clinical.triage_report', 'ruleset_version'], ['ops.ticket_event', 'type'], ['ops.audit_log', 'action']]) {
        await expect(pool.query(`UPDATE ${table} SET ${column} = 'alterado' WHERE false`)).rejects.toMatchObject({ code: '42501' });
        await expect(pool.query(`DELETE FROM ${table} WHERE false`)).rejects.toMatchObject({ code: '42501' });
        await expect(pool.query(`TRUNCATE ${table} CASCADE`)).rejects.toMatchObject({ code: '42501' });
      }
    }
    await expect(app.query('CREATE TABLE ops.nao_permitida(id int)')).rejects.toMatchObject({ code: '42501' });
    const role = (await app.query("SELECT rolsuper,rolcreaterole,rolcreatedb FROM pg_roles WHERE rolname=current_user")).rows[0];
    expect(role).toMatchObject({ rolsuper: false, rolcreaterole: false, rolcreatedb: false });
    await expect(app.query(`INSERT INTO ops.ticket(id,report_id,patient_id,facility_id,status,priority,idempotency_key)
      SELECT $1,report_id,patient_id,facility_id,'failed',priority,idempotency_key FROM ops.ticket WHERE id=$2`, [uuid(), f.ticketId]))
      .rejects.toMatchObject({ code: '23505', constraint: 'ticket_idempotency_key_key' });
    const active = await fixture(false);
    await expect(app.query(`INSERT INTO ops.ticket(id,report_id,patient_id,facility_id,status,priority,idempotency_key)
      SELECT $1,report_id,patient_id,facility_id,'requested',priority,$2 FROM ops.ticket WHERE id=$3`, [uuid(), uuid(), active.ticketId]))
      .rejects.toMatchObject({ code: '23505', constraint: 'one_active_ticket' });
    await processOutbox(app);
  });

  it('limita tentativas, mantém falha segura e não ativa respostas incompletas', async () => {
    const f = await fixture();
    const http = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"resourceType":"Bundle","type":"transaction-response","entry":[]}', { status: 200 }));
    try {
      await processOutbox(app, { batchSize: 1, maxAttempts: 2, retryDelayMs: 0 });
      expect(await ticket(f.ticketId)).toMatchObject({ status: 'sent', external_ref: null, failure_reason: 'FHIR_TRANSACAO_NAO_CONFIRMADA' });
      const retry = (await app.query('SELECT attempts,published_at FROM ops.outbox WHERE id=$1', [f.outboxId])).rows[0];
      expect(retry).toMatchObject({ attempts: 1, published_at: null });
      http.mockRejectedValue(new Error('Segredo de transporte que não pode persistir'));
      await processOutbox(app, { batchSize: 1, maxAttempts: 2, retryDelayMs: 0 });
      expect(await ticket(f.ticketId)).toMatchObject({ status: 'failed', failure_reason: 'FHIR_INDISPONIVEL' });
      const stopped = (await app.query('SELECT attempts,published_at FROM ops.outbox WHERE id=$1', [f.outboxId])).rows[0];
      expect(stopped.attempts).toBe(2);
      expect(stopped.published_at).not.toBeNull();
    } finally { http.mockRestore(); }
    expect((await resources('Encounter', f.key)).total).toBe(0);
  });

  it('falha de cancelamento preserva a senha e expiração aguarda confirmação externa', async () => {
    const pending = await fixture();
    await processOutbox(app);
    await cancel(pending.ticketId);
    const http = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('timeout sintético'));
    try {
      await processOutbox(app, { maxAttempts: 2, retryDelayMs: 0 });
      expect(await ticket(pending.ticketId)).toMatchObject({ status: 'active', cancellation_pending: true, failure_reason: 'FHIR_INDISPONIVEL' });
      await app.query("UPDATE ops.ticket SET valid_until=now()-interval '1 second' WHERE id=$1", [pending.ticketId]);
      await processOutbox(app);
      expect(await ticket(pending.ticketId)).toMatchObject({ status: 'active', cancellation_pending: true });
    } finally { http.mockRestore(); }
    expect((await resources('Encounter', pending.key)).entry![0]!.resource.status).toBe('planned');
    // Solicitação explícita permite repetir; revogação não impede desfazer o envio.
    await app.query('UPDATE identity.consent SET revoked_at=now() WHERE patient_id=$1', [pending.patientId]);
    await cancel(pending.ticketId);
    await processOutbox(app);
    expect((await ticket(pending.ticketId)).status).toBe('cancelled');

    const expired = await fixture();
    await processOutbox(app);
    await app.query("UPDATE ops.ticket SET valid_until=now()-interval '1 second' WHERE id=$1", [expired.ticketId]);
    await processOutbox(app);
    expect(await ticket(expired.ticketId)).toMatchObject({ status: 'expired', cancellation_pending: false });
    expect((await resources('Encounter', expired.key)).entry![0]!.resource.status).toBe('cancelled');
  });

  it('localização malformada na resposta externa conta como falha limitada, sem travar a outbox', async () => {
    const f = await fixture();
    const response = { resourceType: 'Bundle', type: 'transaction-response', entry: Array.from({ length: 4 }, () => ({ response: { status: '201 Created', location: 'http://[' } })) };
    const http = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify(response), { status: 200 }));
    try {
      await processOutbox(app, { maxAttempts: 1 });
      expect(await ticket(f.ticketId)).toMatchObject({ status: 'failed', failure_reason: 'FHIR_REFERENCIA_INVALIDA' });
      expect((await app.query('SELECT attempts,published_at FROM ops.outbox WHERE id=$1', [f.outboxId])).rows[0]).toMatchObject({ attempts: 1, published_at: expect.any(Date) });
    } finally { http.mockRestore(); }
  });

  it('dois workers concorrentes processam a mensagem uma única vez', async () => {
    const f = await fixture();
    const counts = await Promise.all([processOutbox(app, { batchSize: 1 }), processOutbox(app, { batchSize: 1 })]);
    expect(counts[0]! + counts[1]!).toBe(1);
    expect((await ticket(f.ticketId)).status).toBe('active');
    expect((await resources('Encounter', f.key)).total).toBe(1);
    const events = await app.query("SELECT count(*)::int AS count FROM ops.ticket_event WHERE ticket_id=$1 AND type='ticket.active'", [f.ticketId]);
    expect(events.rows[0].count).toBe(1);
    await cancel(f.ticketId);
    await processOutbox(app);
  });
});
