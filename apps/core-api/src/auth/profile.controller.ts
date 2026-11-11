import { BadRequestException, Body, Controller, Get, Inject, Put, Res } from '@nestjs/common';
import { profileSchema } from '@brvital/contracts';
import { validate } from '../validation.js';

import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Database, audit } from '../database.js';
import { CurrentActor } from './auth.guard.js';
import type { Actor } from './auth.service.js';
import { digest, open, seal } from './crypto.js';

@ApiTags('Perfil e privacidade') @ApiBearerAuth()
@Controller('profile')
export class ProfileController {
  constructor(@Inject(Database) private readonly db: Database) {}
  @Put()
  async save(@CurrentActor() actor: Actor, @Body() body: unknown) {
    const profile = validate(profileSchema, body);
    const birth = new Date(`${profile.birthDate}T00:00:00Z`);
    const adult = new Date(); adult.setUTCFullYear(adult.getUTCFullYear() - 18);
    if (birth > adult || birth.getUTCFullYear() < 1900) throw new BadRequestException('Demonstração disponível somente para adultos. Confira a data de nascimento.');
    await this.db.transaction(async client => {
      const cpf = profile.document.length === 11;
      await client.query(`UPDATE identity.patient SET full_name_enc=$2, birth_date_enc=$3,
        cpf_enc=$4, cpf_hmac=$5, cns_enc=$6 WHERE id=$1`, [actor.id, seal(profile.fullName, this.db.config), seal(profile.birthDate, this.db.config),
        cpf ? seal(profile.document, this.db.config) : null, cpf ? digest(`cpf:${profile.document}`, this.db.config) : null,
        cpf ? null : seal(profile.document, this.db.config)]);
      await audit(client, `patient:${actor.id}`, 'profile.updated', `patient:${actor.id}`);
    });
    return profile;
  }
  @Get()
  async get(@CurrentActor() actor: Actor, @Res() response: { json: (body: unknown) => unknown }) {
    const result = await this.db.pool.query('SELECT full_name_enc,cpf_enc,cns_enc,birth_date_enc FROM identity.patient WHERE id=$1', [actor.id]);
    const row = result.rows[0];
    return response.json(row?.full_name_enc && row.birth_date_enc ? {
      fullName: open(row.full_name_enc, this.db.config), document: row.cpf_enc || row.cns_enc ? open(row.cpf_enc ?? row.cns_enc, this.db.config) : '', birthDate: open(row.birth_date_enc, this.db.config),
    } : null);
  }
}
