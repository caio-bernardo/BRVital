import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { phoneSchema } from '@brvital/contracts';
import { validate } from '../validation.js';
import { Public } from './auth.guard.js';
import { AuthService } from './auth.service.js';

@ApiTags('Acesso sintético')
@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}
  @Public() @Post('otp')
  @ApiOperation({ summary: 'Solicitar OTP local; não envia SMS' })
  @ApiBody({ schema: { type: 'object', required: ['phone'], properties: { phone: { type: 'string', example: '+5511900000000' } } } })
  request(@Body() body: unknown) { return this.auth.requestOtp(validate(z.object({ phone: phoneSchema }), body).phone); }
  @Public() @Post('verify') @HttpCode(200)
  @ApiBody({ schema: { type: 'object', required: ['challengeId', 'code'], properties: { challengeId: { type: 'string', format: 'uuid' }, code: { type: 'string', pattern: '^\\d{6}$' } } } })
  verify(@Body() body: unknown) {
    const value = validate(z.object({ challengeId: z.uuid(), code: z.string().regex(/^\d{6}$/) }), body);
    return this.auth.verifyOtp(value.challengeId, value.code);
  }
  @Public() @Post('development-staff') @HttpCode(200)
  @ApiOperation({ summary: 'Credencial do triador fictício, somente instalação local isolada' })
  staff() { return this.auth.developmentStaff(); }
}
