import 'dotenv/config';
import { setTimeout as delay } from 'node:timers/promises';
import { Pool } from 'pg';
import { assertSynthetic, encryptionKey } from './gateway/fhir.js';
import { processOutbox } from './gateway/outbox.js';

assertSynthetic();
encryptionKey();
if (!process.env.DATABASE_URL) throw new Error('Defina DATABASE_URL com a role brvital_app.');
const target = new URL(process.env.DATABASE_URL);
if (!['localhost', '127.0.0.1', 'postgres'].includes(target.hostname) || target.username !== 'brvital_app') {
  throw new Error('Worker exige PostgreSQL local e a role brvital_app.');
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4, connectionTimeoutMillis: 5000 });
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { stopping = true; });
try {
  const role = await pool.query<{ current_user: string }>('SELECT current_user');
  if (role.rows[0]?.current_user !== 'brvital_app') throw new Error('Worker exige a role brvital_app.');
  console.info('Gateway sintético iniciado. HAPI não representa fila hospitalar real.');
  while (!stopping) {
    try {
      const processed = await processOutbox(pool, { batchSize: 1 });
      if (!processed) await delay(1000);
    } catch {
      console.error('Falha operacional do gateway sintético; mensagem preservada, nova tentativa em 2 segundos.');
      await delay(2000);
    }
  }
} finally { await pool.end(); }
