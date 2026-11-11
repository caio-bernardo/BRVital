import { describe, expect, it } from 'vitest';
import { consentGranted } from './consent.js';

describe('consentimentos separados', () => {
  it('usa a concessão mais recente e falha de forma segura com datas inválidas ou empate revogado', () => {
    const old = { purpose: 'triage', granted_at: '2026-11-01T10:00:00Z', revoked_at: null };
    const recent = { purpose: 'triage', granted_at: '2026-11-02T10:00:00Z', revoked_at: '2026-11-03T10:00:00Z' };
    expect(consentGranted([old, recent], 'triage')).toBe(false);
    expect(consentGranted([recent, old], 'triage')).toBe(false);
    expect(consentGranted([recent, { ...old, granted_at: '2026-11-04T10:00:00Z' }], 'triage')).toBe(true);
    expect(consentGranted([old, { ...old, revoked_at: recent.revoked_at }], 'triage')).toBe(false);
    expect(consentGranted([{ ...old, revoked_at: recent.revoked_at }, old], 'triage')).toBe(false);
    expect(consentGranted([{ ...old, granted_at: 'inválido' }], 'triage')).toBe(false);
    expect(consentGranted([{ ...old, granted_at: new Date('inválido') }], 'triage')).toBe(false);
    expect(consentGranted([{ ...recent, revoked_at: 'inválido' }], 'triage')).toBe(false);
    expect(consentGranted([{ ...recent, revoked_at: '2026-10-01T10:00:00Z' }], 'triage')).toBe(false);
  });

  it('exige concessão não revogada para a finalidade solicitada', () => {
    const grant = { purpose: 'triage', granted_at: '2026-11-01T10:00:00Z', revoked_at: null };
    expect(consentGranted([], 'triage')).toBe(false);
    expect(consentGranted([grant], 'triage')).toBe(true);
    expect(consentGranted([grant], 'share_with_facility')).toBe(false);
    expect(consentGranted([{ ...grant, revoked_at: new Date('2026-11-02T10:00:00Z') }], 'triage')).toBe(false);
    expect(consentGranted([{ ...grant, granted_at: new Date(grant.granted_at) }], 'triage')).toBe(true);
  });
});
