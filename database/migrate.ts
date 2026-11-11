import "dotenv/config";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";

import { Pool } from "pg";

if (
    process.env.APP_MODE !== "synthetic" ||
    process.env.NODE_ENV === "production"
) {
    throw new Error(
        "Migrações deste scaffold são exclusivas do ambiente sintético.",
    );
}
if (!process.env.DATABASE_MIGRATOR_URL || !process.env.DATABASE_APP_PASSWORD) {
    throw new Error("Defina DATABASE_MIGRATOR_URL e DATABASE_APP_PASSWORD.");
}
const target = new URL(process.env.DATABASE_MIGRATOR_URL);
if (
    !["localhost", "127.0.0.1", "postgres"].includes(target.hostname) ||
    target.username !== "brvital_migrator"
) {
    throw new Error(
        "Migrações permitidas somente no PostgreSQL local com a role brvital_migrator.",
    );
}
const pool = new Pool({
    connectionString: process.env.DATABASE_MIGRATOR_URL,
    connectionTimeoutMillis: 5000,
    statement_timeout: 30000,
});
const client = await pool.connect();
try {
    const role = await client.query<{ current_user: string }>(
        "SELECT current_user",
    );
    if (role.rows[0]?.current_user !== "brvital_migrator")
        throw new Error("Migrações exigem brvital_migrator como proprietário.");
    await client.query("SELECT pg_advisory_lock(791304812)");
    await client.query(`CREATE TABLE IF NOT EXISTS public.schema_migration (
    name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
  )`);
    const directory = new URL("./migrations/", import.meta.url);
    const files = (await readdir(directory))
        .filter((file) => /^\d+.*\.sql$/.test(file))
        .sort();
    const applied = await client.query<{ name: string }>(
        "SELECT name FROM public.schema_migration",
    );
    if (applied.rows.some(({ name }) => !files.includes(name)))
        throw new Error("Migração aplicada ausente no diretório.");
    for (const name of files) {
        const sql = await readFile(new URL(name, directory), "utf8");
        const checksum = createHash("sha256").update(sql).digest("hex");
        const previous = await client.query<{ checksum: string }>(
            "SELECT checksum FROM public.schema_migration WHERE name = $1",
            [name],
        );
        if (previous.rows[0]) {
            if (previous.rows[0].checksum !== checksum)
                throw new Error(`Checksum divergente na migração ${name}.`);
            continue;
        }
        await client.query("BEGIN");
        try {
            await client.query(sql);
            await client.query(
                "INSERT INTO public.schema_migration(name, checksum) VALUES ($1, $2)",
                [name, checksum],
            );
            await client.query("COMMIT");
            console.info(`Migração aplicada: ${name}`);
        } catch (error) {
            await client.query("ROLLBACK");
            throw error;
        }
    }
    // ALTER ROLE não aceita parâmetros; quote_literal fica no servidor, nunca nos logs.
    const password = await client.query<{ literal: string }>(
        "SELECT quote_literal($1) AS literal",
        [process.env.DATABASE_APP_PASSWORD],
    );
    await client.query(
        `ALTER ROLE brvital_app PASSWORD ${password.rows[0]!.literal}`,
    );
} catch {
    console.error(
        "Falha na migração. Confira conexão, permissões e checksums; nenhum segredo foi registrado.",
    );
    process.exitCode = 1;
} finally {
    await client
        .query("SELECT pg_advisory_unlock(791304812)")
        .catch(() => undefined);
    client.release();
    await pool.end();
}
