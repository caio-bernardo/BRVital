import 'reflect-metadata';
import { Controller, Get, Inject, Module, ServiceUnavailableException, type INestApplication } from '@nestjs/common';
import { APP_GUARD, NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Database } from './database.js';
import { AuthGuard, Public } from './auth/auth.guard.js';
import { DatabaseModule, IdentityModule, NetworkModule, PanelModule, PrivacyModule, TicketsModule, TriageModule } from './modules.js';
import { SafeErrorFilter } from './http-errors.js';
import { describeApi } from './openapi.js';

@Controller('health')
class HealthController {
  constructor(@Inject(Database) private readonly db: Database) {}
  @Public() @Get()
  async health() {
    try { await this.db.pool.query('SELECT 1'); } catch { throw new ServiceUnavailableException('Banco local indisponível.'); }
    return { status: 'ok', mode: 'synthetic', clinicalUseAllowed: false };
  }
}
@Module({ imports: [DatabaseModule, IdentityModule, TriageModule, NetworkModule, TicketsModule, PanelModule, PrivacyModule], controllers: [HealthController], providers: [{ provide: APP_GUARD, useClass: AuthGuard }] })
class CoreModule {}
export async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create(CoreModule, { logger: ['error', 'warn'], bodyParser: true });
  const config = app.get(Database).config;
  app.setGlobalPrefix('v1');
  app.useGlobalFilters(new SafeErrorFilter());
  app.enableCors({ origin: config.CORS_ORIGINS.split(',').map(value => value.trim()), methods: ['GET', 'POST', 'PUT', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'] });
  app.use((_request: unknown, response: { setHeader: (key: string, value: string) => void }, next: () => void) => {
    response.setHeader('Cache-Control', 'no-store'); response.setHeader('X-Content-Type-Options', 'nosniff'); response.setHeader('Referrer-Policy', 'no-referrer'); next();
  });
  const document = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('BRVital — demonstração sintética').setDescription('Sem validade clínica. API local; não integra fila hospitalar real.').setVersion('0.1.0').addBearerAuth().build());
  describeApi(document);
  SwaggerModule.setup('docs', app, document, { jsonDocumentUrl: 'openapi.json' });
  return app;
}
