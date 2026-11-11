import { Body, Controller, Inject, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { v7 as uuid } from 'uuid';
import { CurrentActor } from '../auth/auth.guard.js';
import type { Actor } from '../auth/auth.service.js';
import { Database, audit } from '../database.js';
import { validate } from '../validation.js';

@ApiTags('Direitos LGPD') @ApiBearerAuth()
@Controller('privacy-requests')
export class PrivacyController {
  constructor(@Inject(Database) private readonly db: Database) {}
  @Post()
  async request(@CurrentActor() actor: Actor, @Body() body: unknown) {
    const { kind } = validate(z.object({ kind: z.enum(['export', 'erase']) }), body);
    return this.db.transaction(async client => {
      const requestId = uuid();
      const row = (await client.query(`INSERT INTO ops.privacy_request(id,patient_id,kind,due_at) VALUES($1,$2,$3,now()+interval '15 days') RETURNING received_at,due_at`, [requestId, actor.id, kind])).rows[0];
      await audit(client, `patient:${actor.id}`, `privacy.${kind}_requested`, `privacy-request:${requestId}`);
      return { requestId, receivedAt: row.received_at.toISOString(), dueAt: row.due_at.toISOString() };
    });
  }
}
