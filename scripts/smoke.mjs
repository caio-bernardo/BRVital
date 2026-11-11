import "dotenv/config";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { once } from "node:events";

const reservation = createServer();
await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
const port = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));
const api = spawn(process.execPath, ["apps/core-api/dist/main.js"], {
  env: { ...process.env, PORT: String(port) },
  stdio: "ignore",
});
try {
  let health;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (api.exitCode !== null)
      throw new Error("API compilada encerrou antes de ficar disponível.");
    try {
      const response = await fetch(`http://127.0.0.1:${port}/v1/health`, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) {
        health = await response.json();
        break;
      }
    } catch {
      /* Aguarda inicialização sem expor configuração ou logs. */
    }
    await delay(100);
  }
  assert.deepEqual(health, {
    status: "ok",
    mode: "synthetic",
    clinicalUseAllowed: false,
  });
  const document = await (
    await fetch(`http://127.0.0.1:${port}/openapi.json`, {
      signal: AbortSignal.timeout(2000),
    })
  ).json();
  assert.ok(document.paths["/v1/tickets"].post.responses["202"]);
  const protectedResponse = await fetch(`http://127.0.0.1:${port}/v1/profile`, {
    signal: AbortSignal.timeout(2000),
  });
  assert.equal(protectedResponse.status, 401);
} finally {
  api.kill("SIGTERM");
  const exited = once(api, "exit");
  await Promise.race([exited, delay(3000)]);
  if (api.exitCode === null && api.signalCode === null) api.kill("SIGKILL");
}
for (const script of [
  "apps/core-api/dist/main.js",
  "apps/core-api/dist/worker.js",
]) {
  const production = spawn(process.execPath, [script], {
    env: { ...process.env, NODE_ENV: "production" },
    stdio: "ignore",
    timeout: 5000,
  });
  const [code] = await once(production, "exit");
  assert.equal(code, 1, "API e worker devem recusar produção.");
}
for (const script of ["database/migrate.ts", "database/seed.ts"]) {
  const remote = spawn(process.execPath, ["--import", "tsx", script], {
    env: {
      ...process.env,
      DATABASE_MIGRATOR_URL:
        "postgresql://brvital_migrator@invalid.example/brvital",
    },
    stdio: ["ignore", "ignore", "pipe"],
    timeout: 5000,
  });
  let error = "";
  remote.stderr.on("data", (chunk) => {
    error += chunk.toString();
  });
  const [code] = await once(remote, "exit");
  assert.equal(
    code,
    1,
    "Ferramentas sintéticas devem recusar banco remoto antes de conectar.",
  );
  assert.match(
    error,
    /somente no PostgreSQL local/,
    "A recusa deve vir do gate, não de falha de conexão.",
  );
}
console.info(
  "Smoke passou: API compilada, banco, OpenAPI, autenticação e gates de produção/banco remoto.",
);
