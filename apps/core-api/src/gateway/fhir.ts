import { createDecipheriv, createHash } from 'node:crypto';
import type { Bundle, DocumentReference, Encounter, Observation, Patient, Resource } from '@medplum/fhirtypes';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { v5 as uuidv5 } from 'uuid';

export class GatewayError extends Error {
  constructor(readonly code: string, readonly retryable = false) { super(code); }
}

export function assertSynthetic(): void {
  if (process.env.APP_MODE !== 'synthetic' || process.env.NODE_ENV === 'production') {
    throw new Error('Gateway exclusivo do ambiente sintético; produção proibida.');
  }
}

function localBase(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new GatewayError('FHIR_URL_local_INVALIDA'); }
  if (url.protocol !== 'http:' || !['localhost', 'hapi'].includes(url.hostname) || url.port !== '8080'
    || !['/fhir', '/fhir/'].includes(url.pathname) || url.username || url.password || url.search || url.hash) {
    throw new GatewayError('FHIR_URL_local_PROIBIDA');
  }
  return url.origin + '/fhir';
}

/** Não segue redirects nem inclui mensagens do servidor nos erros. */
export async function sendFhir(base: string, body: unknown, timeoutMs: number, path = '', method = 'POST', version?: string): Promise<unknown> {
  assertSynthetic();
  const url = localBase(base);
  if (path && !/^\/(Patient|Encounter|Observation|DocumentReference)\/[A-Za-z0-9.-]{1,64}$/.test(path)) {
    throw new GatewayError('FHIR_REFERENCIA_INVALIDA');
  }
  try {
    const response = await fetch(url + path, {
      method, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs),
      headers: { 'Content-Type': 'application/fhir+json', Accept: 'application/fhir+json', Prefer: 'return=representation', ...(version ? { 'If-Match': `W/"${version}"` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new GatewayError(`FHIR_HTTP_${response.status}`, response.status === 408 || response.status === 429 || response.status >= 500 || response.status === 412);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new GatewayError('FHIR_RESPOSTA_VAZIA', true);
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 2_000_000) { await reader.cancel(); throw new GatewayError('FHIR_RESPOSTA_EXCESSIVA'); }
      chunks.push(chunk.value);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown; }
    catch { throw new GatewayError('FHIR_JSON_INVALIDO', true); }
  } catch (error) {
    if (error instanceof GatewayError) throw error;
    throw new GatewayError('FHIR_INDISPONIVEL', true);
  }
}

export interface DispatchData {
  id: string; patient_id: string; facility_id: string; idempotency_key: string;
  name: string; urgency_level: number; specialties: string[]; explanation: string[];
  ruleset_version: string; content_hash: Buffer; created_at: Date;
  full_name_enc: Buffer | null; cpf_enc: Buffer | null; cns_enc: Buffer | null; birth_date_enc: Buffer | null;
}

export function encryptionKey(): Buffer {
  const raw = process.env.PII_ENCRYPTION_KEY ?? '';
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32 || key.toString('base64') !== raw) throw new GatewayError('CHAVE_PII_INVALIDA');
  return key;
}

function decrypt(value: Buffer | null, key: Buffer): string | undefined {
  if (!value) return undefined;
  try {
    if (value.length < 28) throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12));
    decipher.setAuthTag(value.subarray(12, 28));
    return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString('utf8');
  } catch { throw new GatewayError('PII_CIFRA_INVALIDA'); }
}

export const identifierSystem = (type: string): string => `urn:brvital:idempotency:${type}`;
export const syntheticCode = (id: string): string => `DEMO-${id.toUpperCase()}`;
const syntheticTag = { system: 'urn:brvital:ambiente', code: 'synthetic', display: 'Demonstração sintética — sem fila real' };

async function reportPdf(data: DispatchData): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.setCreationDate(data.created_at);
  pdf.setModificationDate(data.created_at);
  pdf.setTitle('Pré-triagem sintética BRVital — não é diagnóstico');
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  let page = pdf.addPage();
  let y = page.getHeight() - 45;
  const lines = ['DEMONSTRAÇÃO SINTÉTICA — SEM VALIDADE CLÍNICA', 'Não é diagnóstico. A triagem do hospital sempre prevalece.',
    `Urgência de pré-triagem: ${data.urgency_level}`, `Regras: ${data.ruleset_version}`,
    `SHA-256 do laudo: ${data.content_hash.toString('hex')}`, ...data.explanation];
  for (const line of lines) {
    // Fonte padrão não tem Unicode completo; substitui somente glifos indisponíveis.
    let text = '';
    for (const char of line.replace(/[\r\n\t]/g, ' ')) {
      try { font.encodeText(char); text += char; } catch { text += '?'; }
    }
    while (text.length) {
      let count = Math.min(text.length, 95);
      while (count > 1 && font.widthOfTextAtSize(text.slice(0, count), 10) > page.getWidth() - 90) count--;
      if (y < 45) { page = pdf.addPage(); y = page.getHeight() - 45; }
      page.drawText(text.slice(0, count), { x: 45, y, size: 10, font });
      y -= 15;
      text = text.slice(count);
    }
  }
  return Buffer.from(await pdf.save());
}

export async function buildBundle(data: DispatchData, key: Buffer): Promise<Bundle> {
  const fullUrl = (type: string): string => `urn:uuid:${uuidv5(`${data.id}:${type}`, uuidv5.URL)}`;
  const identifier = (type: string) => [{ system: identifierSystem(type), value: data.idempotency_key }];
  const fullName = decrypt(data.full_name_enc, key);
  const birthDate = decrypt(data.birth_date_enc, key);
  if (birthDate && !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) throw new GatewayError('PII_DATA_INVALIDA');
  const patient: Patient = {
    resourceType: 'Patient', meta: { tag: [syntheticTag] }, identifier: identifier('Patient'),
    ...(fullName ? { name: [{ text: fullName }] } : {}), ...(birthDate ? { birthDate } : {}),
  };
  for (const [encrypted, system] of [[data.cpf_enc, 'http://www.saude.gov.br/fhir/r4/NamingSystem/cpf'], [data.cns_enc, 'http://www.saude.gov.br/fhir/r4/NamingSystem/cns']] as const) {
    const value = decrypt(encrypted, key);
    if (value) patient.identifier!.push({ system, value });
  }
  const encounter: Encounter = {
    resourceType: 'Encounter', meta: { tag: [syntheticTag] }, status: 'planned',
    identifier: [...identifier('Encounter'), { system: 'urn:brvital:synthetic-ticket', value: syntheticCode(data.id) }],
    class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'EMER' },
    subject: { reference: fullUrl('Patient') },
    serviceProvider: { identifier: { system: 'urn:brvital:facility', value: data.facility_id }, display: data.name },
  };
  const observation: Observation = {
    resourceType: 'Observation', meta: { tag: [syntheticTag] }, identifier: identifier('Observation'), status: 'final',
    code: { coding: [{ system: 'urn:brvital:pre-triage', code: 'urgency', display: 'Urgência de pré-triagem sintética' }] },
    subject: { reference: fullUrl('Patient') }, encounter: { reference: fullUrl('Encounter') },
    effectiveDateTime: data.created_at.toISOString(), valueInteger: data.urgency_level,
    note: [{ text: `Regras ${data.ruleset_version}. Não é diagnóstico; classificação hospitalar prevalece.` }],
  };
  const bytes = await reportPdf(data);
  const document: DocumentReference = {
    resourceType: 'DocumentReference', meta: { tag: [syntheticTag] }, identifier: identifier('DocumentReference'),
    status: 'current', subject: { reference: fullUrl('Patient') },
    context: { encounter: [{ reference: fullUrl('Encounter') }] },
    extension: [
      { url: 'urn:brvital:report-sha256', valueString: data.content_hash.toString('hex') },
      { url: 'urn:brvital:pdf-sha256', valueString: createHash('sha256').update(bytes).digest('hex') },
    ],
    content: [{ attachment: { contentType: 'application/pdf', title: 'Laudo sintético de pré-triagem',
      data: bytes.toString('base64'), size: bytes.length,
      // FHIR R4 define Attachment.hash como SHA-1; SHA-256 está na extensão acima.
      hash: createHash('sha1').update(bytes).digest('base64') } }],
  };
  return {
    resourceType: 'Bundle', type: 'transaction', entry: [patient, encounter, observation, document].map((resource) => ({
      fullUrl: fullUrl(resource.resourceType), resource,
      request: { method: 'POST', url: resource.resourceType,
        ifNoneExist: `identifier=${encodeURIComponent(identifierSystem(resource.resourceType) + '|' + data.idempotency_key)}` },
    })),
  };
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new GatewayError('FHIR_RESPOSTA_INVALIDA', true);
  return value as Record<string, unknown>;
}

export function verifiedResource(value: unknown, type: string, idempotencyKey: string): Resource {
  const resource = object(value);
  if (resource.resourceType !== type || typeof resource.id !== 'string' || !/^[A-Za-z0-9.-]{1,64}$/.test(resource.id)
    || !Array.isArray(resource.identifier) || !resource.identifier.every((item: unknown) => item !== null && typeof item === 'object' && !Array.isArray(item)) || !resource.identifier.some((item: unknown) => {
      const entry = object(item);
      return entry.system === identifierSystem(type) && entry.value === idempotencyKey;
    })) throw new GatewayError('FHIR_RECURSO_NAO_CONFIRMADO', true);
  return resource as unknown as Resource;
}

export async function confirmBundle(base: string, result: unknown, data: DispatchData, timeout: number): Promise<{ externalRef: string; displayCode: string }> {
  const response = object(result);
  const types = ['Patient', 'Encounter', 'Observation', 'DocumentReference'];
  if (response.resourceType !== 'Bundle' || response.type !== 'transaction-response' || !Array.isArray(response.entry) || response.entry.length !== types.length) {
    throw new GatewayError('FHIR_TRANSACAO_NAO_CONFIRMADA', true);
  }
  let encounter: Encounter | undefined;
  for (const [index, type] of types.entries()) {
    const entry = object(response.entry[index]);
    const status = object(entry.response);
    if (typeof status.status !== 'string' || !/^(200|201)(\s|$)/.test(status.status)) {
      throw new GatewayError('FHIR_ENTRADA_NAO_ACEITA', true);
    }
    let resource: unknown = entry.resource;
    if (!resource) {
      if (typeof status.location !== 'string') throw new GatewayError('FHIR_LOCALIZACAO_AUSENTE', true);
      let location: URL;
      try { location = new URL(status.location, localBase(base) + '/'); }
      catch { throw new GatewayError('FHIR_REFERENCIA_INVALIDA'); }
      if (location.origin !== new URL(localBase(base)).origin || location.search || location.hash) throw new GatewayError('FHIR_REFERENCIA_INVALIDA');
      const match = location.pathname.match(new RegExp(`^/fhir/(${type}/[A-Za-z0-9.-]{1,64})(?:/_history/[A-Za-z0-9.-]{1,64})?$`));
      if (!match) throw new GatewayError('FHIR_REFERENCIA_INVALIDA');
      resource = await sendFhir(base, undefined, timeout, '/' + match[1], 'GET');
    }
    const confirmed = verifiedResource(resource, type!, data.idempotency_key);
    if (confirmed.resourceType === 'Encounter') encounter = confirmed;
  }
  const code = encounter?.identifier?.find((item) => item.system === 'urn:brvital:synthetic-ticket')?.value;
  if (!encounter?.id || !['planned', 'arrived'].includes(encounter.status) || code !== syntheticCode(data.id)) {
    throw new GatewayError('FHIR_SENHA_SINTETICA_NAO_CONFIRMADA', true);
  }
  return { externalRef: `Encounter/${encounter.id}`, displayCode: code };
}

export async function cancelEncounter(base: string, externalRef: string, idempotencyKey: string, timeout: number): Promise<void> {
  if (!/^Encounter\/[A-Za-z0-9.-]{1,64}$/.test(externalRef)) throw new GatewayError('FHIR_REFERENCIA_INVALIDA');
  const resource = verifiedResource(await sendFhir(base, undefined, timeout, '/' + externalRef, 'GET'), 'Encounter', idempotencyKey) as Encounter;
  if (resource.id !== externalRef.slice('Encounter/'.length)) throw new GatewayError('FHIR_RECURSO_NAO_CONFIRMADO', true);
  if (resource.status === 'cancelled') return;
  if (resource.status !== 'planned') throw new GatewayError('CANCELAMENTO_ESTADO_EXTERNO_INCOMPATIVEL');
  const version = resource.meta?.versionId;
  if (typeof version !== 'string' || !/^[A-Za-z0-9.-]{1,64}$/.test(version)) throw new GatewayError('FHIR_VERSAO_AUSENTE', true);
  const confirmed = verifiedResource(await sendFhir(base, { ...resource, status: 'cancelled' }, timeout, '/' + externalRef, 'PUT', version), 'Encounter', idempotencyKey) as Encounter;
  if (confirmed.id !== resource.id || confirmed.status !== 'cancelled') throw new GatewayError('CANCELAMENTO_NAO_CONFIRMADO', true);
}
