# ADR 0001 — Base local sintética do monólito modular

- Estado: aceito para desenvolvimento local.
- Data: 2026-11-11.
- Referências: RFC v0.2.0 e autorização do usuário para fixtures clínicas sintéticas.

## Contexto

A RFC define um MDP com uma fila hospitalar real, mas o protocolo aprovado, o hospital, suas credenciais e as liberações regulatórias ainda não estão disponíveis. A primeira entrega precisa demonstrar os fluxos sem confundir armazenamento FHIR com uma fila hospitalar nem apresentar regras fictícias como orientação clínica.

## Decisão

1. Usar workspaces npm e TypeScript: `core-api` NestJS modular, app Expo, painel React/Vite e contratos compartilhados.
2. Manter PostgreSQL 16/PostGIS como persistência e outbox. O worker FHIR é outro processo no mesmo pacote do backend. Não adicionar intermediador de mensagens.
3. Testar pelas fronteiras públicas acordadas: motor, HTTP/PostgreSQL, worker/HAPI e interações das interfaces. Implementar fatias verticais com teste falhando antes do código.
4. Permitir apenas `APP_MODE=synthetic`; API, worker, migrações e seed recusam produção. API escuta loopback e worker restringe os destinos FHIR ao HAPI local.
5. Usar regras versionadas deliberadamente fictícias: queixas A/B, contadores e alarmes sintéticos. Nenhuma regra tem aprovação clínica. O hash inclui o conteúdo do YAML, respostas canônicas e resultado, sem IDs ou datas variáveis.
6. O código `DEMO-<UUID>` é um identificador sintético persistido e confirmado pelo HAPI. Não é uma senha hospitalar real. O conector produtivo deverá extrair o código efetivamente emitido pelo HIS, após homologação.
7. No desenvolvimento, cifrar colunas de identificação por AES-256-GCM com chave local gerada e usar HMAC independente para buscas e códigos OTP. Antes de produção, migrar para envelope encryption KMS/Secrets Manager e política de rotação aprovada.
8. OTP é local, com desafio persistido, expiração, limite de tentativas, cooldown e uso único. O código é devolvido explicitamente como `developmentCode`. Não existe envio de SMS nesta entrega.
9. O painel suporta Cognito authorization-code/PKCE no cliente e validação de access token/JWKS no servidor. Uma associação de grupo `facility:<UUID>` define a unidade; o cliente não escolhe sua autorização. Acesso sintético local é separado e pode ser desativado.
10. A RFC prevalece sobre referências a IA, chat, mapa embutido e perfil de saúde em `DESIGN.md`. Preservar tipografia, bordas e cores; usar texto escuro sobre o verde de marca para contraste.

## Consequências

- O fluxo sintético é executável e tem persistência, concorrência e interoperabilidade reais em infraestrutura local.
- HAPI não fornece fila, capacidade, espera ou ETA. Esses valores não são inventados. As recomendações usam distância PostGIS e, nesta fase, somente unidades 24h.
- A busca textual local cobre Centro, Sé e CEP 01001-000; demais bairros exigem geocodificação futura.
- Notificações push, SMS real, Google Routes, mTLS/Secrets Manager, Terraform AWS, Sentry/CloudWatch, operação LGPD completa e liberação de produção continuam pendentes em `TASKS.md`.
- Cobertura do domínio não mede validade clínica nem cobertura integral da aplicação. A avaliação clínica exige casos e responsável clínico independentes.
- Não basta mudar uma variável para produção: os gates são intencionais e sua substituição exige nova decisão, implementação, testes e aprovação.
