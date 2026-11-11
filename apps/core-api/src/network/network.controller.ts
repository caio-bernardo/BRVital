import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentActor } from '../auth/auth.guard.js';
import type { Actor } from '../auth/auth.service.js';
import { idSchema, validate } from '../validation.js';
import { NetworkService } from './network.service.js';
const locationSchema = z.object({ lat: z.coerce.number().min(-90).max(90).optional(), lng: z.coerce.number().min(-180).max(180).optional(), area: z.string().trim().min(1).max(80).optional() })
  .refine(value => (value.lat !== undefined && value.lng !== undefined) || (!!value.area && value.lat === undefined && value.lng === undefined));
@ApiTags('Rede sintética') @ApiBearerAuth()
@Controller('triage-sessions')
export class NetworkController {
  constructor(@Inject(NetworkService) private readonly network: NetworkService) {}
  @Get(':id/recommendations')
  @ApiQuery({ name: 'lat', required: false, type: Number }) @ApiQuery({ name: 'lng', required: false, type: Number }) @ApiQuery({ name: 'area', required: false, type: String })
  get(@CurrentActor() actor: Actor, @Param('id') id: string, @Query() query: unknown) { return this.network.recommend(actor.id, validate(idSchema, id), validate(locationSchema, query)); }
}
