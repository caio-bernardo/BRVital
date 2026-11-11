import { BadRequestException, HttpException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { randomInt, timingSafeEqual } from 'node:crypto';
import { SignJWT, createRemoteJWKSet, jwtVerify } from 'jose';
import { v7 as uuid } from 'uuid';
import { phoneSchema } from '@brvital/contracts';
import { Database, audit } from '../database.js';
import { validate } from '../validation.js';
import { digest, seal } from './crypto.js';

export interface Actor { id: string; role: 'patient' | 'staff'; facilityId?: string; }
@Injectable()
export class AuthService {
  private readonly secret: Uint8Array;
  private readonly jwks;
  constructor(@Inject(Database) private readonly db: Database) {
    this.secret = new TextEncoder().encode(db.config.JWT_SECRET);
    this.jwks = db.config.COGNITO_ISSUER ? createRemoteJWKSet(new URL(`${db.config.COGNITO_ISSUER}/.well-known/jwks.json`)) : null;
  }
  async issue(actor: Actor): Promise<string> {
    return new SignJWT({ role: actor.role, ...(actor.facilityId ? { facilityId: actor.facilityId } : {}) })
      .setProtectedHeader({ alg: 'HS256' }).setIssuer('brvital-synthetic').setAudience('brvital-local').setSubject(actor.id).setIssuedAt().setExpirationTime('1h').sign(this.secret);
  }
  async authenticate(header?: string): Promise<Actor> {
    if (!header?.startsWith('Bearer ') || header.length > 10000) throw new UnauthorizedException('Entre novamente.');
    const token = header.slice(7);
    try {
      const { payload } = await jwtVerify(token, this.secret, { algorithms: ['HS256'], issuer: 'brvital-synthetic', audience: 'brvital-local' });
      if (!payload.sub || !['patient', 'staff'].includes(String(payload.role))) throw new Error();
      if (payload.role === 'patient') {
        const patient = await this.db.pool.query('SELECT id FROM identity.patient WHERE id=$1 AND erased_at IS NULL', [payload.sub]);
        if (!patient.rowCount) throw new Error();
      }
      return { id: payload.sub, role: payload.role as Actor['role'], ...(typeof payload.facilityId === 'string' ? { facilityId: payload.facilityId } : {}) };
    } catch { /* Credenciais do Cognito usam verificação separada e não aceitam algoritmo simétrico. */ }
    if (this.jwks && this.db.config.COGNITO_CLIENT_ID) {
      try {
        const { payload } = await jwtVerify(token, this.jwks, { issuer: this.db.config.COGNITO_ISSUER, algorithms: ['RS256'] });
        const groups = payload['cognito:groups'];
        const facilityGroups = Array.isArray(groups) ? groups.filter((group): group is string => typeof group === 'string' && /^facility:[0-9a-f-]{36}$/.test(group)) : [];
        if (!payload.sub || payload.token_use !== 'access' || payload.client_id !== this.db.config.COGNITO_CLIENT_ID || facilityGroups.length !== 1) throw new Error();
        return { id: payload.sub, role: 'staff', facilityId: facilityGroups[0]!.slice(9) };
      } catch { /* Não expõe claims ou erros do provedor. */ }
    }
    throw new UnauthorizedException('Sessão inválida ou expirada. Entre novamente.');
  }
  async requestOtp(rawPhone: unknown) {
    const phone = validate(phoneSchema, rawPhone);
    const phoneHash = digest(`phone:${phone}`, this.db.config);
    const id = uuid(), code = String(randomInt(100000, 1000000));
    await this.db.transaction(async client => {
      await client.query('SELECT pg_advisory_xact_lock($1)', [phoneHash.readInt32BE(0)]);
      const rate = await client.query<{ recent: string; cooldown: boolean }>(`SELECT count(*)::text AS recent,
        COALESCE(bool_or(created_at > now()-interval '30 seconds'),false) AS cooldown
        FROM identity.otp_challenge WHERE phone_hmac=$1 AND created_at>now()-interval '1 hour'`, [phoneHash]);
      if (Number(rate.rows[0]!.recent) >= 5 || rate.rows[0]!.cooldown) throw new HttpException('Aguarde antes de pedir outro código.', 429);
      await client.query('UPDATE identity.otp_challenge SET consumed_at=now() WHERE phone_hmac=$1 AND consumed_at IS NULL', [phoneHash]);
      await client.query(`INSERT INTO identity.otp_challenge(id,phone_hmac,phone_enc,code_hash,expires_at)
        VALUES ($1,$2,$3,$4,now()+interval '5 minutes')`, [id, phoneHash, seal(phone, this.db.config), digest(`otp:${id}:${code}`, this.db.config)]);
    });
    // shortcut: OTP retornado apenas no ambiente sintético local; integrar SMS antes de homologar acesso real.
    return { challengeId: id, developmentCode: code };
  }
  async verifyOtp(id: string, code: string) {
    const patientId = await this.db.transaction(async client => {
      const result = await client.query('SELECT * FROM identity.otp_challenge WHERE id=$1 FOR UPDATE', [id]);
      const challenge = result.rows[0];
      if (!challenge || challenge.consumed_at || challenge.expires_at <= new Date() || challenge.attempts >= 5) return null;
      const expected = digest(`otp:${id}:${code}`, this.db.config);
      if (!timingSafeEqual(challenge.code_hash, expected)) {
        await client.query('UPDATE identity.otp_challenge SET attempts=attempts+1 WHERE id=$1', [id]);
        return null;
      }
      await client.query('UPDATE identity.otp_challenge SET consumed_at=now() WHERE id=$1', [id]);
      const patient = await client.query(`INSERT INTO identity.patient(id,phone_hmac,phone_enc) VALUES($1,$2,$3)
        ON CONFLICT(phone_hmac) DO UPDATE SET phone_enc=EXCLUDED.phone_enc
        WHERE identity.patient.erased_at IS NULL RETURNING id`, [uuid(), challenge.phone_hmac, challenge.phone_enc]);
      if (!patient.rowCount) return null;
      await audit(client, `patient:${patient.rows[0].id}`, 'auth.otp_verified', `patient:${patient.rows[0].id}`);
      return patient.rows[0].id as string;
    });
    if (!patientId) throw new UnauthorizedException('Código inválido, expirado ou já utilizado.');
    return { patientId, accessToken: await this.issue({ id: patientId, role: 'patient' }) };
  }
  async developmentStaff() {
    if (this.db.config.LOCAL_STAFF_ENABLED !== 'true') throw new BadRequestException('Acesso sintético do triador desabilitado.');
    const facilityId = '019b0000-0000-7000-8000-000000000001';
    return { accessToken: await this.issue({ id: 'synthetic-triador', role: 'staff', facilityId }) };
  }
}
