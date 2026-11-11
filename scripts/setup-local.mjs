import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

// Credenciais do banco são exclusivas do Compose local; chaves de aplicação são geradas por instalação.
const values = {
  APP_MODE: 'synthetic', NODE_ENV: 'development', PORT: '3000',
  DATABASE_MIGRATOR_PASSWORD: 'brvital_local_migrator', DATABASE_APP_PASSWORD: 'brvital_local_app',
  DATABASE_MIGRATOR_URL: 'postgresql://brvital_migrator:brvital_local_migrator@localhost:5432/brvital',
  DATABASE_URL: 'postgresql://brvital_app:brvital_local_app@localhost:5432/brvital',
  PII_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  LOOKUP_HMAC_KEY: randomBytes(32).toString('base64'),
  JWT_SECRET: randomBytes(48).toString('base64'),
  CORS_ORIGINS: 'http://localhost:8081,http://localhost:5173',
  LOCAL_STAFF_ENABLED: 'true',
};
try {
  await writeFile('.env', Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n') + '\n', { flag: 'wx', mode: 0o600 });
  console.info('.env local criado. Não use dados reais nem publique este ambiente na internet.');
} catch (error) {
  if (error.code === 'EEXIST') console.info('.env já existe; nenhuma configuração foi alterada.');
  else throw error;
}
