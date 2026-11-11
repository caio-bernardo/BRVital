import type { TicketStatus } from '@brvital/contracts';
import { describe, expect, it } from 'vitest';
import { assertTicketTransition, checkTicketRequest } from './tickets.js';

describe('estados da senha', () => {
  it('bloqueia alarme e exige consentimento separado antes de emitir senha', () => {
    const share = { purpose: 'share_with_facility', granted_at: '2026-11-01T10:00:00Z', revoked_at: null };
    expect(() => checkTicketRequest({ redFlags: ['alarme_ficticio_a'] }, [share])).toThrow(/emergência.*192/);
    expect(() => checkTicketRequest({ redFlags: [] }, [])).toThrow(/compartilhamento/);
    expect(() => checkTicketRequest({ redFlags: [] }, [{ ...share, purpose: 'triage' }])).toThrow(/compartilhamento/);
    expect(() => checkTicketRequest({ redFlags: [] }, [{ ...share, revoked_at: '2026-11-02T10:00:00Z' }])).toThrow(/compartilhamento/);
    expect(() => checkTicketRequest({ redFlags: [] }, [share])).not.toThrow();
  });

  it('permite somente as transições do RFC, inclusive rejeitando repetição e estados terminais', () => {
    const allowed: Record<TicketStatus, TicketStatus[]> = {
      requested: ['sent'], sent: ['active', 'rejected', 'failed'],
      active: ['attended', 'no_show', 'expired', 'cancelled'],
      rejected: [], failed: [], attended: [], no_show: [], expired: [], cancelled: [],
    };
    for (const from of Object.keys(allowed) as TicketStatus[]) {
      for (const to of Object.keys(allowed) as TicketStatus[]) {
        if (allowed[from].includes(to)) expect(() => assertTicketTransition(from, to)).not.toThrow();
        else expect(() => assertTicketTransition(from, to)).toThrow(/Transição de senha inválida/);
      }
    }
    expect(() => assertTicketTransition('inexistente' as TicketStatus, 'sent')).toThrow(/Transição de senha inválida/);
  });
});
