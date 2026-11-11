import { consentGranted, type ConsentRecord } from './consent.js';
import type { TicketStatus, TriageReport } from '@brvital/contracts';

export function checkTicketRequest(report: Pick<TriageReport, 'redFlags'>, consents: readonly ConsentRecord[]): void {
  if (report.redFlags.length) throw new Error('Sinal de emergência: ligue 192; não emitir senha nem recomendar unidade.');
  if (!consentGranted(consents, 'share_with_facility')) throw new Error('Consentimento de compartilhamento com a unidade é obrigatório.');
}

const transitions: Record<TicketStatus, readonly TicketStatus[]> = {
  requested: ['sent'], sent: ['active', 'rejected', 'failed'],
  active: ['attended', 'no_show', 'expired', 'cancelled'],
  rejected: [], failed: [], attended: [], no_show: [], expired: [], cancelled: [],
};

export function assertTicketTransition(from: TicketStatus, to: TicketStatus): void {
  if (!Object.hasOwn(transitions, from) || !transitions[from].includes(to)) {
    throw new Error(`Transição de senha inválida: ${from} → ${to}.`);
  }
}
