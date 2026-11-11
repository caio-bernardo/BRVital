import 'dotenv/config';
import { setTimeout } from 'node:timers/promises';
import { Pool } from 'pg';

if (process.env.APP_MODE !== 'synthetic' || process.env.NODE_ENV === 'production') throw new Error('Espera permitida apenas em ambiente sintético.');
const pool = new Pool({ connectionString: process.env.DATABASE_MIGRATOR_URL, connectionTimeoutMillis: 2000, max: 1 });
try {
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      await pool.query('SELECT 1');
      const response = await fetch('http://localhost:8080/fhir/metadata', { signal: AbortSignal.timeout(3000) });
      if (response.ok) { ready = true; break; }
    } catch { /* O HAPI pode levar alguns minutos no primeiro boot. */ }
    await setTimeout(3000);
  }
  if (!ready) throw new Error('PostgreSQL ou HAPI não ficou disponível no prazo. Confira docker compose logs.');
  console.info('PostgreSQL e HAPI locais disponíveis.');
} finally { await pool.end(); }
