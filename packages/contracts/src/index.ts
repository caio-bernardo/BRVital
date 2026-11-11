import { z } from 'zod';

export const purposeSchema = z.enum(['triage', 'share_with_facility']);
export type ConsentPurpose = z.infer<typeof purposeSchema>;
export const phoneSchema = z.string().regex(/^\+55\d{10,11}$/, 'Informe celular brasileiro com +55 e DDD.');
export const profileSchema = z.object({
  fullName: z.string().trim().min(3).max(120),
  document: z.string().regex(/^(\d{11}|\d{15})$/, 'Informe CPF (11 dígitos) ou CNS (15 dígitos).'),
  birthDate: z.iso.date(),
});
export type Profile = z.infer<typeof profileSchema>;
export const answerSchema = z.union([z.string().max(100), z.array(z.string().max(60)).max(20)]);
export type Answer = z.infer<typeof answerSchema>;
export interface Question { id: string; text: string; critical: boolean; options: { value: string; label: string }[]; }
export type Urgency = 1 | 2 | 3 | 4 | 5;
export const urgencyLabels: Record<Urgency, string> = { 1: 'Emergência', 2: 'Muito urgente', 3: 'Urgente', 4: 'Pouco urgente', 5: 'Não urgente' };
export interface TriageReport {
  id: string; sessionId: string; urgencyLevel: Urgency; specialties: string[]; redFlags: string[];
  explanation: string[]; rulesetVersion: string; contentHash: string; createdAt: string; synthetic: true;
}
export interface Session {
  sessionId: string; answers: Record<string, Answer>; status: 'in_progress' | 'emergency' | 'completed';
  nextQuestion: Question | null; progress: { answered: number; total: number }; outcome?: 'EMERGENCY' | 'REPORT_READY';
}
export const ticketStatuses = ['requested', 'sent', 'active', 'rejected', 'failed', 'cancelled', 'expired', 'attended', 'no_show'] as const;
export type TicketStatus = typeof ticketStatuses[number];
export interface Recommendation {
  facilityId: string; name: string; address: string; specialties: string[]; distanceKm: number;
  travelMinutes: number | null; waitMinutes: number | null; statusUpdatedAt: string | null; latitude: number; longitude: number;
}
export interface Ticket {
  id: string; reportId: string; facilityId: string; status: TicketStatus; displayCode: string | null;
  externalRef: string | null; validUntil: string | null; failureReason: string | null; cancellationPending: boolean;
}
export interface Consent { purpose: ConsentPurpose; granted: boolean; policyVersion: string; }
export interface PanelEntry { ticket: Ticket; report: TriageReport; }
export interface AuthResult { accessToken: string; patientId: string; }
export const policyVersion = 'synthetic-2026-11';
export const syntheticWarning = 'Ambiente de demonstração. Dados e regras sintéticos, sem validade clínica. Não use para decidir atendimento.';
export const ticketRequestSchema = z.object({ reportId: z.uuid(), facilityId: z.uuid() });
export const outcomeSchema = z.object({ urgencyLevel: z.number().int().min(1).max(5), disposition: z.enum(['attended', 'referred', 'admitted', 'discharged']) });

/** Cliente sem armazenamento de credenciais; cada plataforma controla sua sessão. */
export function createApi(baseUrl: string, token: () => string | null) {
  async function request<T>(path: string, method = 'GET', body?: unknown, headers?: Record<string, string>): Promise<T> {
    const accessToken = token();
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/v1${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({})) as { message?: string | string[] };
      throw new Error(Array.isArray(error.message) ? error.message.join(' ') : error.message ?? 'Não foi possível concluir. Tente novamente.');
    }
    return response.json() as Promise<T>;
  }
  return {
    requestOtp: (phone: string) => request<{ challengeId: string; developmentCode?: string }>('/auth/otp', 'POST', { phone }),
    verifyOtp: (challengeId: string, code: string) => request<AuthResult>('/auth/verify', 'POST', { challengeId, code }),
    profile: () => request<Profile | null>('/profile'),
    saveProfile: (profile: Profile) => request<Profile>('/profile', 'PUT', profile),
    consents: () => request<Consent[]>('/consents'),
    setConsent: (purpose: ConsentPurpose, granted: boolean) => request<Consent[]>('/consents', 'POST', { purpose, granted }),
    startSession: () => request<Session>('/triage-sessions', 'POST'),
    session: (id: string) => request<Session>(`/triage-sessions/${id}`),
    answer: (id: string, questionId: string, value: Answer) => request<Session>(`/triage-sessions/${id}/answers`, 'POST', { questionId, value }),
    report: (id: string) => request<TriageReport>(`/triage-sessions/${id}/report`),
    recommendations: (id: string, location: { lat?: number; lng?: number; area?: string }) => {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(location)) if (value !== undefined) params.set(key, String(value));
      return request<Recommendation[]>(`/triage-sessions/${id}/recommendations?${params}`);
    },
    issueTicket: (reportId: string, facilityId: string, key: string) => request<Ticket>('/tickets', 'POST', { reportId, facilityId }, { 'Idempotency-Key': key }),
    ticket: (id: string) => request<Ticket>(`/tickets/${id}`),
    activeTicket: () => request<Ticket | null>('/tickets/active'),
    cancelTicket: (id: string) => request<Ticket>(`/tickets/${id}/cancel`, 'POST'),
    privacyRequest: (kind: 'export' | 'erase') => request<{ requestId: string; receivedAt: string; dueAt: string }>('/privacy-requests', 'POST', { kind }),
    panelQueue: () => request<PanelEntry[]>('/panel/queue'),
    recordOutcome: (id: string, urgencyLevel: number, disposition: string) => request<{ recorded: true }>(`/panel/tickets/${id}/outcome`, 'POST', { urgencyLevel, disposition }),
  };
}
export type Api = ReturnType<typeof createApi>;
