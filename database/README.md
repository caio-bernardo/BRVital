# Banco local sintético

PostgreSQL 16 + PostGIS. Somente o migrador é proprietário das tabelas; o runtime usa `brvital_app`, sem privilégios DDL, sem UPDATE/DELETE/TRUNCATE dos laudos e trilhas. Os gatilhos também bloqueiam mutação pelo proprietário (que ainda pode alterar DDL: não use a credencial do migrador na API).

Execute `npm run local:setup` na raiz. O script cria `.env` não versionado, gera chaves locais aleatórias e configura as credenciais públicas exclusivas do Compose de demonstração. Não sobrescreve um `.env` existente. Nunca use essas credenciais ou dados reais fora do ambiente sintético isolado.

Use senhas compatíveis com URL ou faça percent-encoding na URL. `docker compose up -d`, `npm run db:migrate`, `npm run db:seed`. Aguarde o HAPI responder em `http://localhost:8080/fhir/metadata`; o primeiro boot pode demorar. `npm run dev:worker` inicia o processo separado. Os comandos rejeitam produção ou ausência do modo sintético.

As migrações são transacionais, serializadas por advisory lock e verificadas por SHA-256 em `public.schema_migration`. Arquivo já aplicado não pode ser alterado. A senha da role é configurada pelo runner via `DATABASE_APP_PASSWORD`, não pelo SQL versionado. O usuário inicial da imagem PostgreSQL é superusuário local para instalar PostGIS: essa conveniência NÃO é configuração de produção.

O PostgreSQL usa volume persistente. O HAPI usa o H2 padrão dentro do container: reiniciar preserva os recursos, mas recriar/remover o container os perde. Não remova o HAPI se precisar manter referências de demonstrações anteriores; perda externa é tratada como falha, nunca como cancelamento confirmado.

O seed idempotente cria apenas a clínica fictícia `019b0000-0000-7000-8000-000000000001`, em São Paulo, com cinco especialidades 24h (`{"alwaysOpen":true}`): `clinica_demonstrativa`, `especialidade_demonstrativa_a`, `especialidade_demonstrativa_b`, `especialidade_demonstrativa_f` (compatíveis com as regras sintéticas) e `clinica-geral` (mantida para os testes existentes do gateway). Reexecutar o seed acrescenta os vínculos ausentes, sem duplicar a unidade ou remover especialidades. Não cria PII nem pacientes. `queue_size` e `avg_wait_min` permanecem nulos: HAPI não conhece filas reais.

## Contrato com a API

- `identity.otp_challenge`: `id`, `phone_hmac`, `phone_enc`, `code_hash`, `expires_at`, `attempts` (0), `consumed_at`, `created_at`. Índice `(phone_hmac, created_at)` suporta a limitação transacional de frequência implementada pela API.
- Consentimento ativo único por paciente/finalidade: revogar e inserir na mesma transação.
- `clinical.triage_session.status` aceita `completed`; `answers` e `recommendations` são JSONB. Resultado persistido em `clinical.triage_report`; `explanation` é array JSON de strings.
- `ops.ticket` inclui `failure_reason` e `cancellation_pending` (false). Tipos outbox: `ticket.requested` e `ticket.cancel`, ambos com payload `{ "ticketId": "<uuid>" }` e `aggregate_id = ticketId`.
- `ops.privacy_request`: export/erase, status `requested`, `received_at`, `due_at`. Este scaffold registra a solicitação; não executa apagamento de laudos imutáveis.
- IDs UUID v7 são fornecidos pela aplicação. `content_hash` de laudo é SHA-256 (32 bytes). Datas são `timestamptz`.

A API não deve inserir nome, telefone, CPF ou nascimento em `answers`, outbox ou logs. Cifra local AES-256-GCM: `[IV de 12 bytes | tag de 16 bytes | ciphertext]`; apenas colunas `identity.*_enc` recebem PII.
