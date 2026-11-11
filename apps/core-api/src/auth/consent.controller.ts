import { Body, Controller, Get, HttpCode, Inject, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { policyVersion, purposeSchema, type Consent } from '@brvital/contracts';
import { z } from 'zod';
import { v7 as uuid } from 'uuid';
import { Database, audit } from '../database.js';
import { validate } from '../validation.js';
import { CurrentActor } from './auth.guard.js';
import type { Actor } from './auth.service.js';

@ApiTags('Consentimentos') @ApiBearerAuth()
@Controller('consents')
export class ConsentController {
  constructor(@Inject(Database) private readonly db: Database) {}
  @Get()
  async list(@CurrentActor() actor: Actor): Promise<Consent[]> {
    const rows = await this.db.pool.query('SELECT purpose,policy_version FROM identity.consent WHERE patient_id=$1 AND revoked_at IS NULL', [actor.id]);
    return ['triage', 'share_with_facility'].map(purpose => ({ purpose: purpose as Consent['purpose'], granted: rows.rows.some(row => row.purpose === purpose), policyVersion: rows.rows.find(row => row.purpose === purpose)?.policy_version ?? policyVersion }));
  }
  @Post() @HttpCode(200)
  async set(@CurrentActor() actor: Actor, @Body() body: unknown) {
    const value = validate(z.object({ purpose: purposeSchema, granted: z.boolean() }), body);
    await this.db.transaction(async client => {
      await client.query('SELECT id FROM identity.patient WHERE id=$1 FOR UPDATE', [actor.id]);
      await client.query('UPDATE identity.consent SET revoked_at=now() WHERE patient_id=$1 AND purpose=$2 AND revoked_at IS NULL', [actor.id, value.purpose]);
      if (value.granted) await client.query('INSERT INTO identity.consent(id,patient_id,purpose,policy_version,granted_at) VALUES($1,$2,$3,$4,now())', [uuid(), actor.id, value.purpose, policyVersion]);
      await audit(client, `patient:${actor.id}`, value.granted ? 'consent.granted' : 'consent.revoked', `consent:${value.purpose}`);
    });
    return this.list(actor);
  }
}
