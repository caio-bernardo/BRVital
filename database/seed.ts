import "dotenv/config";
import { Pool } from "pg";

if (
    process.env.APP_MODE !== "synthetic" ||
    process.env.NODE_ENV === "production"
) {
    throw new Error(
        "Seed permitido somente em modo sintético, nunca em produção.",
    );
}
if (!process.env.DATABASE_MIGRATOR_URL)
    throw new Error("Defina DATABASE_MIGRATOR_URL.");
const target = new URL(process.env.DATABASE_MIGRATOR_URL);
if (
    !["localhost", "127.0.0.1", "postgres"].includes(target.hostname) ||
    target.username !== "brvital_migrator"
) {
    throw new Error(
        "Seed permitido somente no PostgreSQL local com a role brvital_migrator.",
    );
}
const pool = new Pool({
    connectionString: process.env.DATABASE_MIGRATOR_URL,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
});
const client = await pool.connect();
try {
    await client.query("BEGIN");
    await client.query(`INSERT INTO network.facility (
    id, name, org_name, cnpj, kind, address, geo, accepts_remote_tickets,
    connector_kind, connector_base_url, connector_secret_ref, synthetic
  ) VALUES (
    '019b0000-0000-7000-8000-000000000001', 'Clínica Demonstração BRVital — FICTÍCIA',
    'Organização Fictícia BRVital', 'FICTICIO-SEM-CNPJ', 'private',
    '{"city":"São Paulo","state":"SP","street":"Endereço fictício — demonstração"}',
    ST_SetSRID(ST_MakePoint(-46.6333, -23.5505),4326)::geography, true,
    'fhir_r4', 'http://localhost:8080/fhir', 'synthetic:no-secret', true
  ) ON CONFLICT (id) DO NOTHING`);
    await client.query(`INSERT INTO network.facility_specialty(facility_id, specialty_code, open_hours)
    SELECT '019b0000-0000-7000-8000-000000000001'::uuid, specialty_code, '{"alwaysOpen":true}'::jsonb
    FROM unnest(ARRAY['clinica-geral', 'clinica_demonstrativa', 'especialidade_demonstrativa_a',
      'especialidade_demonstrativa_b', 'especialidade_demonstrativa_f']) AS specialty(specialty_code)
    ON CONFLICT (facility_id, specialty_code) DO NOTHING`);
    await client.query("COMMIT");
    console.info(
        "Unidade fictícia 24h de São Paulo disponível; nenhum paciente foi criado.",
    );
} catch {
    await client.query("ROLLBACK");
    console.error("Falha no seed sintético. Confira conexão e migrações.");
    process.exitCode = 1;
} finally {
    client.release();
    await pool.end();
}
