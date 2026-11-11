import { createApp } from './app.js';
import { readConfig } from './config.js';

try {
  const config = readConfig();
  const app = await createApp();
  app.enableShutdownHooks();
  await app.listen(config.PORT, '127.0.0.1');
  console.info(`BRVital sintético em http://localhost:${config.PORT}; OpenAPI em /docs. Sem validade clínica.`);
} catch {
  console.error('Não foi possível iniciar a API local. Confira .env, dependências e banco de demonstração.');
  process.exitCode = 1;
}
