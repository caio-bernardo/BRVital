import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Pool, type PoolClient } from 'pg';
import { readConfig } from './config.js';

@Injectable()
export class Database implements OnModuleDestroy {
  readonly config = readConfig();
  readonly pool = new Pool({ connectionString: this.config.DATABASE_URL, max: 10, connectionTimeoutMillis: 3000, statement_timeout: 10000 });
  async transaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await run(client);
      await client.query('COMMIT');
      return result;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  async onModuleDestroy() { await this.pool.end(); }
}
export async function audit(client: PoolClient, actor: string, action: string, resource: string) {
  await client.query('INSERT INTO ops.audit_log(actor,action,resource) VALUES ($1,$2,$3)', [actor, action, resource]);
}
