import 'dotenv/config';
import { z } from 'zod';

const environment = z.object({
  APP_MODE: z.literal('synthetic'), NODE_ENV: z.enum(['development', 'test']).default('development'),
  DATABASE_URL: z.string().url(), PII_ENCRYPTION_KEY: z.string(), LOOKUP_HMAC_KEY: z.string(), JWT_SECRET: z.string().min(48),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  CORS_ORIGINS: z.string().default('http://localhost:8081,http://localhost:5173'),
  LOCAL_STAFF_ENABLED: z.enum(['true', 'false']).default('false'),
  COGNITO_ISSUER: z.string().optional(), COGNITO_CLIENT_ID: z.string().optional(),
});
export type Config = z.infer<typeof environment>;
export function readConfig(): Config {
  const parsed = environment.safeParse(process.env);
  if (!parsed.success) throw new Error('Configuração inválida. Gere .env local; somente APP_MODE=synthetic e desenvolvimento/teste são permitidos.');
  const config = parsed.data;
  const db = new URL(config.DATABASE_URL);
  if (!['localhost', '127.0.0.1', 'postgres'].includes(db.hostname) || decodeURIComponent(db.username) !== 'brvital_app') {
    throw new Error('Use apenas PostgreSQL local com a role brvital_app.');
  }
  for (const key of [config.PII_ENCRYPTION_KEY, config.LOOKUP_HMAC_KEY]) {
    if (Buffer.from(key, 'base64').length !== 32) throw new Error('Chaves locais devem conter 32 bytes em base64.');
  }
  if (config.COGNITO_ISSUER && !/^https:\/\/cognito-idp\.sa-east-1\.amazonaws\.com\/sa-east-1_[A-Za-z0-9]+$/.test(config.COGNITO_ISSUER)) {
    throw new Error('Cognito deve usar um user pool em sa-east-1.');
  }
  return config;
}
