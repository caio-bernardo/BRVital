import { Body, Controller, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { answerSchema } from '@brvital/contracts';
import { CurrentActor } from '../auth/auth.guard.js';
import type { Actor } from '../auth/auth.service.js';
import { validate, idSchema } from '../validation.js';
import { TriageService } from './triage.service.js';

@ApiTags('Pré-triagem sintética') @ApiBearerAuth()
@Controller('triage-sessions')
export class TriageController {
  constructor(@Inject(TriageService) private readonly triage: TriageService) {}
  @Post() start(@CurrentActor() actor: Actor) { return this.triage.start(actor.id); }
  @Get(':id') get(@CurrentActor() actor: Actor, @Param('id') id: string) { return this.triage.get(actor.id, validate(idSchema, id)); }
  @Post(':id/answers') @HttpCode(200)
  answer(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() body: unknown) {
    const value = validate(z.object({ questionId: z.string().min(1).max(100), value: answerSchema }), body);
    return this.triage.answer(actor.id, validate(idSchema, id), value.questionId, value.value);
  }
  @Get(':id/report') report(@CurrentActor() actor: Actor, @Param('id') id: string) { return this.triage.report(actor.id, validate(idSchema, id)); }
}
