import { createParamDecorator, ExecutionContext, ForbiddenException, Inject, Injectable, SetMetadata, type CanActivate } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthService, type Actor } from './auth.service.js';

export const Public = () => SetMetadata('public', true);
export const Staff = () => SetMetadata('staff', true);
interface AuthenticatedRequest { headers: { authorization?: string }; actor: Actor; }
export const CurrentActor = createParamDecorator((_data: unknown, context: ExecutionContext): Actor => context.switchToHttp().getRequest<AuthenticatedRequest>().actor);
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(AuthService) private readonly auth: AuthService, @Inject(Reflector) private readonly reflector: Reflector) {}
  async canActivate(context: ExecutionContext) {
    if (this.reflector.getAllAndOverride<boolean>('public', [context.getHandler(), context.getClass()])) return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    request.actor = await this.auth.authenticate(request.headers.authorization);
    const staff = this.reflector.getAllAndOverride<boolean>('staff', [context.getHandler(), context.getClass()]);
    if (staff ? request.actor.role !== 'staff' || !request.actor.facilityId : request.actor.role !== 'patient') throw new ForbiddenException('Acesso não autorizado.');
    return true;
  }
}
