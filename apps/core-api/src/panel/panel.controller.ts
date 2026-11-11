import { Body, ConflictException, Controller, Get, HttpCode, Inject, NotFoundException, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { outcomeSchema, type PanelEntry } from '@brvital/contracts';
import { CurrentActor, Staff } from '../auth/auth.guard.js';
import type { Actor } from '../auth/auth.service.js';
import { Database, audit } from '../database.js';
import { validate, idSchema } from '../validation.js';
import { toReport } from '../triage/triage.service.js';
import { toTicket } from '../tickets/ticket.service.js';

@ApiTags('Triador') @ApiBearerAuth() @Staff()
@Controller('panel')
export class PanelController {
  constructor(@Inject(Database) private readonly db: Database) {}
  @Get('queue')
  async queue(@CurrentActor() actor: Actor): Promise<PanelEntry[]> {
    return this.db.transaction(async client => {
      const rows = await client.query(`SELECT to_jsonb(t) AS ticket,to_jsonb(r) AS report FROM ops.ticket t
        JOIN clinical.triage_report r ON r.id=t.report_id WHERE t.facility_id=$1 AND t.status='active' ORDER BY t.issued_at LIMIT 100`, [actor.facilityId]);
      await audit(client, `staff:${actor.id}`, 'panel.queue_read', `facility:${actor.facilityId}`);
      return rows.rows.map(row => ({ ticket: toTicket({ ...row.ticket, valid_until: row.ticket.valid_until ? new Date(row.ticket.valid_until) : null }),
        report: toReport({ ...row.report, created_at: new Date(row.report.created_at), content_hash: Buffer.from(row.report.content_hash.slice(2), 'hex') }) }));
    });
  }
  @Post('tickets/:id/outcome') @HttpCode(200)
  async outcome(@CurrentActor() actor: Actor, @Param('id') rawId: string, @Body() body: unknown) {
    const id = validate(idSchema, rawId), value = validate(outcomeSchema, body);
    await this.db.transaction(async client => {
      const ticket = (await client.query('SELECT * FROM ops.ticket WHERE id=$1 AND facility_id=$2 FOR UPDATE', [id, actor.facilityId])).rows[0];
      if (!ticket) throw new NotFoundException('Senha não encontrada nesta unidade.');
      if (ticket.status !== 'active' || ticket.cancellation_pending) throw new ConflictException('A senha não está disponível para registrar classificação.');
      const previous = (await client.query('SELECT * FROM ops.outcome WHERE ticket_id=$1 FOR UPDATE', [id])).rows[0];
      if (previous?.facility_urgency_level !== null && previous?.facility_urgency_level !== undefined) {
        if (previous.facility_urgency_level === value.urgencyLevel && previous.disposition === value.disposition) return;
        throw new ConflictException('Classificação já registrada. Correções exigem rotina auditada.');
      }
      await client.query(`INSERT INTO ops.outcome(ticket_id,facility_urgency_level,arrived_at,triaged_at,disposition)
        VALUES($1,$2,now(),now(),$3) ON CONFLICT(ticket_id) DO UPDATE SET facility_urgency_level=$2,arrived_at=COALESCE(ops.outcome.arrived_at,now()),triaged_at=now(),disposition=$3`, [id, value.urgencyLevel, value.disposition]);
      await client.query("INSERT INTO ops.ticket_event(ticket_id,type,payload) VALUES($1,'outcome.recorded',$2)", [id, { facilityUrgencyLevel: value.urgencyLevel }]);
      await audit(client, `staff:${actor.id}`, 'outcome.recorded', `ticket:${id}`);
    });
    return { recorded: true };
  }
}
