import type { OpenAPIObject, SchemaObject } from '@nestjs/swagger';
import { z } from 'zod';
import { answerSchema, outcomeSchema, phoneSchema, profileSchema, purposeSchema, ticketRequestSchema, ticketStatuses } from '@brvital/contracts';

const id = z.uuid(), nullableString = z.string().nullable();
const question = z.object({ id: z.string(), text: z.string(), critical: z.boolean(), options: z.array(z.object({ value: z.string(), label: z.string() })) });
const session = z.object({ sessionId: id, answers: z.record(z.string(), answerSchema), status: z.enum(['in_progress', 'emergency', 'completed']), nextQuestion: question.nullable(), progress: z.object({ answered: z.number(), total: z.number() }), outcome: z.enum(['EMERGENCY', 'REPORT_READY']).optional() });
const report = z.object({ id, sessionId: id, urgencyLevel: z.number().int().min(1).max(5), specialties: z.array(z.string()), redFlags: z.array(z.string()), explanation: z.array(z.string()), rulesetVersion: z.string(), contentHash: z.string().regex(/^[a-f0-9]{64}$/), createdAt: z.iso.datetime(), synthetic: z.literal(true) });
const ticket = z.object({ id, reportId: id, facilityId: id, status: z.enum(ticketStatuses), displayCode: nullableString, externalRef: nullableString, validUntil: nullableString, failureReason: nullableString, cancellationPending: z.boolean() });
const consent = z.array(z.object({ purpose: purposeSchema, granted: z.boolean(), policyVersion: z.string() }));
const recommendation = z.array(z.object({ facilityId: id, name: z.string(), address: z.string(), specialties: z.array(z.string()), distanceKm: z.number(), travelMinutes: z.number().nullable(), waitMinutes: z.number().nullable(), statusUpdatedAt: nullableString, latitude: z.number(), longitude: z.number() }));
const schema = (value: z.ZodType): SchemaObject => z.toJSONSchema(value, { target: 'openapi-3.0', unrepresentable: 'any' }) as SchemaObject;

/** Mantém o contrato HTTP publicado junto dos schemas usados para validar a entrada. */
export function describeApi(document: OpenAPIObject) {
  const operations: { path: string; method: 'get' | 'post' | 'put'; status: number; input?: z.ZodType; output: z.ZodType }[] = [
    { path: '/auth/otp', method: 'post', status: 201, input: z.object({ phone: phoneSchema }), output: z.object({ challengeId: id, developmentCode: z.string() }) },
    { path: '/auth/verify', method: 'post', status: 200, input: z.object({ challengeId: id, code: z.string().regex(/^\d{6}$/) }), output: z.object({ accessToken: z.string(), patientId: id }) },
    { path: '/auth/development-staff', method: 'post', status: 200, output: z.object({ accessToken: z.string() }) },
    { path: '/profile', method: 'get', status: 200, output: profileSchema.nullable() },
    { path: '/profile', method: 'put', status: 200, input: profileSchema, output: profileSchema },
    { path: '/consents', method: 'get', status: 200, output: consent },
    { path: '/consents', method: 'post', status: 200, input: z.object({ purpose: purposeSchema, granted: z.boolean() }), output: consent },
    { path: '/triage-sessions', method: 'post', status: 201, output: session },
    { path: '/triage-sessions/{id}', method: 'get', status: 200, output: session },
    { path: '/triage-sessions/{id}/answers', method: 'post', status: 200, input: z.object({ questionId: z.string(), value: answerSchema }), output: session },
    { path: '/triage-sessions/{id}/report', method: 'get', status: 200, output: report },
    { path: '/triage-sessions/{id}/recommendations', method: 'get', status: 200, output: recommendation },
    { path: '/tickets', method: 'post', status: 202, input: ticketRequestSchema, output: ticket },
    { path: '/tickets/active', method: 'get', status: 200, output: ticket.nullable() },
    { path: '/tickets/{id}', method: 'get', status: 200, output: ticket },
    { path: '/tickets/{id}/cancel', method: 'post', status: 200, output: ticket },
    { path: '/privacy-requests', method: 'post', status: 201, input: z.object({ kind: z.enum(['export', 'erase']) }), output: z.object({ requestId: id, receivedAt: z.iso.datetime(), dueAt: z.iso.datetime() }) },
    { path: '/panel/queue', method: 'get', status: 200, output: z.array(z.object({ ticket, report })) },
    { path: '/panel/tickets/{id}/outcome', method: 'post', status: 200, input: outcomeSchema, output: z.object({ recorded: z.literal(true) }) },
  ];
  for (const entry of operations) {
    const operation = document.paths[`/v1${entry.path}`]?.[entry.method];
    if (!operation) throw new Error(`Endpoint não documentado: ${entry.path}`);
    if (entry.input) operation.requestBody = { required: true, content: { 'application/json': { schema: schema(entry.input) } } };
    operation.responses = { [entry.status]: { description: 'Operação concluída no ambiente sintético.', content: { 'application/json': { schema: schema(entry.output) } } },
      ...Object.fromEntries([400, 401, 403, 404, 409, 429, 503].map(status => [status, { description: 'Erro validado; sem dados pessoais ou detalhes internos.', content: { 'application/json': { schema: { type: 'object', properties: { statusCode: { type: 'integer' }, message: { type: 'string' } } } } } }])) };
  }
}
