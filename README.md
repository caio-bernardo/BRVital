# BRVital

Aplicativo de pré-triagem, recomendação de hospitais e geração de senhas para atendimento.

**Estado: alfa local exclusivamente sintética. Não use com dados reais nem para decidir atendimento.** O fluxo funciona contra PostgreSQL/PostGIS e HAPI FHIR, mas não escreve em uma fila hospitalar real. A API e o worker recusam produção.

## Executar localmente

Requisitos: Node.js **22.19+** (recomendado 24 LTS), npm e Docker com Compose. Execute os comandos na raiz do repositório.

```sh
npm ci
npm run local:setup
docker compose up -d
npm run local:wait
npm run db:migrate
npm run db:seed
npm run build -w @brvital/contracts
```

`local:setup` gera as chaves de aplicação em `.env` não versionado, com permissão restrita; não sobrescreve configurações existentes. As senhas do PostgreSQL são públicas e exclusivas do Compose local. Não exponha esse ambiente à internet. O primeiro boot do HAPI pode levar alguns minutos.

Abra terminais separados:

```sh
# API em http://localhost:3000; Swagger em /docs; JSON em /openapi.json
npm run dev:api
```

```sh
# Worker FHIR: necessário para confirmar emissão, cancelamento e expiração
npm run dev:worker
```

```sh
# App Expo no navegador, normalmente http://localhost:8081
npm run dev:web
```

```sh
# Painel do triador em http://localhost:5173, com acesso sintético explícito
VITE_SYNTHETIC_AUTH=true npm run dev:panel
```

Para Android/iOS, execute `npm run dev:mobile`. A API escuta apenas em loopback. Em Android conectado por USB, use `adb reverse tcp:3000 tcp:3000`; configure `EXPO_PUBLIC_API_URL` se necessário. Em aparelho físico, valide também a conectividade do Metro. Os testes de interface usam React Native Web; não substituem testes em dispositivo.

### Experimentar o fluxo

1. Use somente uma identidade fictícia. O OTP local aparece explicitamente na tela; nenhum SMS é enviado.
2. Preencha cadastro adulto fictício. Neste alfa, CPF/CNS têm validação de formato, não de identidade ou titularidade.
3. Autorize triagem. Compartilhamento é separado e não é necessário para gerar laudo.
4. Responda às perguntas fictícias A/B. Marcar um alarme interrompe o fluxo, mostra o 192 e impede recomendações/senha.
5. Sem alarme, abra as recomendações. Na busca textual local, use **Centro**, **Sé** ou **01001-000**; também é possível usar coordenadas próximas de São Paulo.
6. Selecione a clínica explicitamente fictícia, confirme compartilhamento e solicite a senha sintética. O worker persiste os quatro recursos FHIR no HAPI.
7. `DEMO-<UUID>` confirma somente a demonstração FHIR, **não uma vaga ou senha hospitalar**. Não há estimativa inventada de espera ou deslocamento.
8. No painel, entre na demonstração, abra o laudo e registre a classificação da unidade. O laudo original não muda.
9. Cancelamento continua pendente até confirmação do HAPI. Perfil permite revogar consentimentos e registrar pedidos LGPD com prazo de 15 dias.

Parar infraestrutura preservando o volume PostgreSQL:

```sh
docker compose stop
```

O HAPI usa H2 dentro do container. Recriar/remover esse container perde os recursos FHIR; referências anteriores podem deixar de existir. Não remova volumes se precisar preservar dados de demonstração.

## Organização

```text
apps/core-api/       NestJS modular e worker separado
  src/domain/       regras determinísticas, consentimento e estados
  src/auth/         OTP local, tokens, perfil e consentimentos
  src/triage/       sessões persistidas e laudos imutáveis
  src/network/      recomendações PostGIS e disponibilidade local
  src/tickets/      emissão transacional, idempotência e cancelamento
  src/gateway/      FHIR R4, PDF, outbox e tentativas limitadas
  src/panel/        fila autorizada por unidade e classificação final
  src/privacy/      recibos dos pedidos de direitos LGPD
apps/mobile/        Expo, telas S-01 a S-10
apps/triage-panel/  React/Vite, tela W-01 e Cognito PKCE
packages/contracts/ contratos, validação e cliente HTTP compartilhados
database/           migrações PostgreSQL 16/PostGIS e seed fictício
rules/              YAML e fixtures sem validade clínica
docs/adr/           decisões e limites da entrega
```

O banco é a fila. Não há Redis, SQS, Kafka, ML, LLM, chat ou mapa embutido. Os estilos seguem `DESIGN.md`: Bodoni Moda/Figtree locais, coluna de 420 px, contornos vinho e ações verdes com texto escuro para contraste.

## Verificar

```sh
npm run typecheck
npm run lint
npm run test:coverage
npm run test:integration
npm run build
npm run smoke
npm audit --audit-level=high
```

Os testes de integração exigem Compose disponível, migrações/seed aplicados e `.env`. **Só execute contra o banco sintético local.** Criam registros fictícios e preservam os laudos/eventos imutáveis; não são testes de banco descartável em uma instalação compartilhada.

Validação local registrada: 48 testes de domínio/gateway/interface e 13 de integração passaram. Domínio: 100% de linhas, branches, funções e statements; isso não significa 100% da aplicação ou validade clínica. Builds da API, painel e exportação web do Expo passaram. O smoke local verifica API compilada, banco, OpenAPI, autenticação e bloqueio de produção. Typecheck, lint e auditoria sem findings altos/críticos passaram. Permanecem 8 findings baixos, derivados de `deepmerge` no tooling Expo; não processe configuração de projeto não confiável. Overrides de Metro/PostCSS/glob/minimatch e Vitest atualizado estão no lockfile; reexecute builds e auditoria ao atualizar Expo.

CI: `.github/workflows/ci.yml` repete verificações e integrações locais em runner Linux. Publicação remota e smoke test de staging ainda não foram executados.

## Limites e próximos marcos

`TASKS.md` acompanha entregas e pendências. [ADR 0001](docs/adr/0001-mdp-sintetico.md) registra as escolhas. [Banco](database/README.md) e [gateway](apps/core-api/src/gateway/README.md) detalham os contratos.

Ainda faltam provedores reais de SMS/push/rotas, conector homologado e mTLS, KMS/Secrets Manager, infraestrutura AWS/Terraform, Sentry/CloudWatch e execução operacional dos pedidos LGPD. Cognito tem código de integração, mas não foi verificado contra um user pool real. Não houve auditoria manual WCAG/leitor de tela nem teste em aparelho físico.

A liberação clínica exige protocolo licenciado/aprovado, casos revisados por responsável clínico, hospital piloto, RIPD/DPO e enquadramento SaMD. O MDP da RFC só estará pronto quando uma senha aparecer na fila real do hospital com essas condições atendidas.
