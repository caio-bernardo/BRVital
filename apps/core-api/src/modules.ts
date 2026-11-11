import { Global, Module } from '@nestjs/common';
import { Database } from './database.js';
import { AuthController } from './auth/auth.controller.js';
import { AuthService } from './auth/auth.service.js';
import { ConsentController } from './auth/consent.controller.js';
import { ProfileController } from './auth/profile.controller.js';
import { TriageController } from './triage/triage.controller.js';
import { TriageService } from './triage/triage.service.js';
import { NetworkController } from './network/network.controller.js';
import { NetworkService } from './network/network.service.js';
import { TicketController } from './tickets/ticket.controller.js';
import { TicketService } from './tickets/ticket.service.js';
import { PanelController } from './panel/panel.controller.js';
import { PrivacyController } from './privacy/privacy.controller.js';

@Global() @Module({ providers: [Database], exports: [Database] })
export class DatabaseModule {}
@Module({ controllers: [AuthController, ProfileController, ConsentController], providers: [AuthService], exports: [AuthService] })
export class IdentityModule {}
@Module({ controllers: [TriageController], providers: [TriageService], exports: [TriageService] })
export class TriageModule {}
@Module({ imports: [TriageModule], controllers: [NetworkController], providers: [NetworkService] })
export class NetworkModule {}
@Module({ imports: [TriageModule], controllers: [TicketController], providers: [TicketService] })
export class TicketsModule {}
@Module({ controllers: [PanelController] })
export class PanelModule {}
@Module({ controllers: [PrivacyController] })
export class PrivacyModule {}
