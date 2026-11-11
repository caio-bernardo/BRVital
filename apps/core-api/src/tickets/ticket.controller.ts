import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { ticketRequestSchema } from '@brvital/contracts';
import { z } from 'zod';
import { CurrentActor } from '../auth/auth.guard.js';
import type { Actor } from '../auth/auth.service.js';
import { idSchema, validate } from '../validation.js';
import { TicketService } from './ticket.service.js';

@ApiTags('Senhas sintéticas') @ApiBearerAuth()
@Controller('tickets')
export class TicketController {
  constructor(@Inject(TicketService) private readonly tickets: TicketService) {}
  @Get('active')
  async active(@CurrentActor() actor: Actor, @Res() response: { json: (body: unknown) => unknown }) { return response.json(await this.tickets.active(actor.id)); }
  @Get(':id') get(@CurrentActor() actor: Actor, @Param('id') id: string) { return this.tickets.get(actor.id, validate(idSchema, id)); }
  @Post() @HttpCode(202) @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'UUID gerado uma única vez por confirmação.' })
  issue(@CurrentActor() actor: Actor, @Body() body: unknown, @Headers('idempotency-key') key: unknown) {
    return this.tickets.issue(actor.id, validate(ticketRequestSchema, body), validate(z.string().min(8).max(128).regex(/^[A-Za-z0-9_-]+$/), key));
  }
  @Post(':id/cancel') @HttpCode(200)
  cancel(@CurrentActor() actor: Actor, @Param('id') id: string) { return this.tickets.cancel(actor.id, validate(idSchema, id)); }
}
