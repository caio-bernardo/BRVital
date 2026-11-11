export interface ConsentRecord {
  purpose: string;
  granted_at: Date | string;
  revoked_at: Date | string | null;
}

export function consentGranted(consents: readonly ConsentRecord[], purpose: string): boolean {
  let latest = -Infinity;
  let granted = false;
  for (const consent of consents) {
    if (consent.purpose !== purpose) continue;
    const date = (value: Date | string) => value instanceof Date ? value.getTime() : Date.parse(value);
    const at = date(consent.granted_at);
    const revoked = consent.revoked_at === null ? null : date(consent.revoked_at);
    if (!Number.isFinite(at) || (revoked !== null && (!Number.isFinite(revoked) || revoked < at))) return false;
    if (at > latest) {
      latest = at;
      granted = revoked === null;
    } else if (at === latest && revoked !== null) {
      granted = false;
    }
  }
  return granted;
}
