import 'dotenv/config';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { Pool } from 'pg';
import { v7 as uuid } from 'uuid';
import { processOutbox } from './gateway/outbox.js';

let app: INestApplication;
let base: string;
async function call(path: string, method = 'GET', body?: unknown, token?: string, headers?: Record<string, string>) {
  const response = await fetch(`${base}/v1${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, body: await response.json() };
}
async function login() {
  const phone = `+55119${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
  const challenge = await call('/auth/otp', 'POST', { phone });
  expect(challenge.status).toBe(201);
  const verified = await call('/auth/verify', 'POST', { challengeId: challenge.body.challengeId, code: challenge.body.developmentCode });
  expect(verified.status).toBe(200);
  return { token: verified.body.accessToken as string, challenge: challenge.body };
}

async function registeredPatient() {
  const { token } = await login();
  await call('/profile', 'PUT', { fullName: 'Paciente Fictício', document: `9${String(Math.floor(Math.random() * 1e14)).padStart(14, '0')}`, birthDate: '1990-01-01' }, token);
  await call('/consents', 'POST', { purpose: 'triage', granted: true }, token);
  return token;
}
async function completeSession(token: string) {
  let session = (await call('/triage-sessions', 'POST', undefined, token)).body;
  const answers: Record<string, string> = { sex: 'nao_informado', comorbidities: 'nenhuma', complaint: 'queixa_a', alarm_a: 'nao', alarm_b: 'nao', discriminator_a: 'nao' };
  while (session.nextQuestion) {
    const id = session.nextQuestion.id;
    const response = await call(`/triage-sessions/${session.sessionId}/answers`, 'POST', { questionId: id, value: answers[id] }, token);
    expect(response.status).toBe(200);
    session = response.body;
  }
  return { session, report: (await call(`/triage-sessions/${session.sessionId}/report`, 'GET', undefined, token)).body };
}

describe.skipIf(process.env.RUN_INTEGRATION !== '1')('API HTTP com PostgreSQL real, somente fixtures sintéticas', () => {
  beforeAll(async () => { app = await createApp(); await app.listen(0, '127.0.0.1'); base = await app.getUrl(); });
  afterAll(async () => { await app?.close(); });
  it('autentica OTP de uso único e protege dados do paciente', async () => {
    expect((await call('/profile')).status).toBe(401);
    expect((await call('/auth/otp', 'POST', { phone: 'invalido' })).status).toBe(400);
    const { token, challenge } = await login();
    expect((await call('/profile', 'GET', undefined, token)).body).toBeNull();
    expect((await call('/auth/verify', 'POST', { challengeId: challenge.challengeId, code: challenge.developmentCode })).status).toBe(401);
  });
  it('exige cadastro adulto e permite triagem sem consentir compartilhamento', async () => {
    const { token } = await login();
    expect((await call('/triage-sessions', 'POST', undefined, token)).status).toBe(403);
    const document = `9${String(Math.floor(Math.random() * 1e14)).padStart(14, '0')}`;
    expect((await call('/profile', 'PUT', { fullName: 'Paciente Fictício', document, birthDate: '2020-01-01' }, token)).status).toBe(400);
    expect((await call('/profile', 'PUT', { fullName: 'Paciente Fictício', document, birthDate: '1990-01-01' }, token)).status).toBe(200);
    const consent = await call('/consents', 'POST', { purpose: 'triage', granted: true }, token);
    expect(consent.status).toBe(200);
    expect(consent.body).toContainEqual({ purpose: 'share_with_facility', granted: false, policyVersion: 'synthetic-2026-11' });
    const session = await call('/triage-sessions', 'POST', undefined, token);
    expect(session.status).toBe(201);
    expect(session.body.nextQuestion.id).toBe('sex');
    expect((await call(`/triage-sessions/${session.body.sessionId}`, 'GET', undefined, (await login()).token)).status).toBe(404);
  });
  it('retoma respostas e bloqueia recomendação imediatamente após alarme', async () => {
    const token = await registeredPatient();
    const session = (await call('/triage-sessions', 'POST', undefined, token)).body;
    const alarm = await call(`/triage-sessions/${session.sessionId}/answers`, 'POST', { questionId: 'alarm_a', value: 'sim' }, token);
    expect(alarm.body).toMatchObject({ outcome: 'EMERGENCY', nextQuestion: null });
    expect((await call(`/triage-sessions/${session.sessionId}`, 'GET', undefined, token)).body.answers).toEqual({ alarm_a: 'sim' });
    expect((await call(`/triage-sessions/${session.sessionId}/recommendations?area=Centro`, 'GET', undefined, token)).status).toBe(403);
  });
  it('emite idempotente sob concorrência e cancela apenas após confirmação FHIR sintética', async () => {
    const token = await registeredPatient();
    expect((await call('/tickets/active', 'GET', undefined, token)).body).toBeNull();
    const { session, report } = await completeSession(token);
    expect(report).toMatchObject({ urgencyLevel: 5, redFlags: [], synthetic: true, rulesetVersion: 'synthetic-0.1.0' });
    expect(report.contentHash).toMatch(/^[a-f0-9]{64}$/);
    const facilities = await call(`/triage-sessions/${session.sessionId}/recommendations?area=Centro`, 'GET', undefined, token);
    expect(facilities.status).toBe(200);
    expect(facilities.body[0]).toMatchObject({ facilityId: '019b0000-0000-7000-8000-000000000001', travelMinutes: null, waitMinutes: null });
    const body = { reportId: report.id, facilityId: facilities.body[0].facilityId };
    const headers = { 'Idempotency-Key': uuid() };
    expect((await call('/tickets', 'POST', body, token, headers)).status).toBe(403);
    await call('/consents', 'POST', { purpose: 'share_with_facility', granted: true }, token);
    const requests = await Promise.all([call('/tickets', 'POST', body, token, headers), call('/tickets', 'POST', body, token, headers)]);
    expect(requests.map(response => response.status)).toEqual([202, 202]);
    const ticketId = requests[0]!.body.id;
    expect(requests[1]!.body.id).toBe(ticketId);
    expect((await call('/tickets', 'POST', body, token, { 'Idempotency-Key': uuid() })).status).toBe(409);
    expect((await call(`/tickets/${ticketId}`, 'GET', undefined, (await login()).token)).status).toBe(404);
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      await processOutbox(pool);
      expect((await call(`/tickets/${ticketId}`, 'GET', undefined, token)).body).toMatchObject({ status: 'active', displayCode: `DEMO-${ticketId.toUpperCase()}` });
      const pending = await call(`/tickets/${ticketId}/cancel`, 'POST', undefined, token);
      expect(pending.body).toMatchObject({ status: 'active', cancellationPending: true });
      await processOutbox(pool);
      expect((await call(`/tickets/${ticketId}`, 'GET', undefined, token)).body).toMatchObject({ status: 'cancelled', cancellationPending: false });
    } finally { await pool.end(); }
  });
  it('registra pedido LGPD com prazo e restringe painel à unidade autenticada', async () => {
    const token = await registeredPatient();
    const request = await call('/privacy-requests', 'POST', { kind: 'export' }, token);
    expect(request.status).toBe(201);
    expect(request.body.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Date(request.body.dueAt).getTime() - new Date(request.body.receivedAt).getTime()).toBe(15 * 86400000);
    expect((await call('/panel/queue', 'GET', undefined, token)).status).toBe(403);
    const staff = await call('/auth/development-staff', 'POST');
    const staffToken = staff.body.accessToken as string;
    expect((await call('/panel/queue', 'GET', undefined, staffToken)).status).toBe(200);
    expect((await call('/profile', 'GET', undefined, staffToken)).status).toBe(403);
    const { session, report } = await completeSession(token);
    const facilities = (await call(`/triage-sessions/${session.sessionId}/recommendations?area=Centro`, 'GET', undefined, token)).body;
    await call('/consents', 'POST', { purpose: 'share_with_facility', granted: true }, token);
    const issued = await call('/tickets', 'POST', { reportId: report.id, facilityId: facilities[0].facilityId }, token, { 'Idempotency-Key': uuid() });
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      await processOutbox(pool);
      expect((await call('/panel/queue', 'GET', undefined, staffToken)).body).toContainEqual(expect.objectContaining({ ticket: expect.objectContaining({ id: issued.body.id }) }));
      const outcome = await call(`/panel/tickets/${issued.body.id}/outcome`, 'POST', { urgencyLevel: 3, disposition: 'referred' }, staffToken);
      expect(outcome.body).toEqual({ recorded: true });
      expect((await call(`/triage-sessions/${session.sessionId}/report`, 'GET', undefined, token)).body).toEqual(report);
    } finally { await pool.end(); }
  });
  it('limita OTP e impede novas respostas após revogação sem apagar a sessão', async () => {
    const phone = `+55119${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
    const challenge = (await call('/auth/otp', 'POST', { phone })).body;
    expect((await call('/auth/otp', 'POST', { phone })).status).toBe(429);
    const wrong = challenge.developmentCode === '000000' ? '999999' : '000000';
    for (let attempt = 0; attempt < 5; attempt++) expect((await call('/auth/verify', 'POST', { challengeId: challenge.challengeId, code: wrong })).status).toBe(401);
    expect((await call('/auth/verify', 'POST', { challengeId: challenge.challengeId, code: challenge.developmentCode })).status).toBe(401);
    const token = await registeredPatient();
    const session = (await call('/triage-sessions', 'POST', undefined, token)).body;
    await call('/consents', 'POST', { purpose: 'triage', granted: false }, token);
    expect((await call(`/triage-sessions/${session.sessionId}/answers`, 'POST', { questionId: 'sex', value: 'masculino' }, token)).status).toBe(403);
    expect((await call(`/triage-sessions/${session.sessionId}`, 'GET', undefined, token)).body.answers).toEqual({});
    const openapi = await (await fetch(`${base}/openapi.json`)).json();
    expect(openapi.paths['/v1/tickets'].post.responses['202'].content['application/json'].schema.properties.status).toBeDefined();
  });
});
