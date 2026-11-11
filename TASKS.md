# Plano de implementação do MDP

Referências: `RFC.md` v0.2.0, `CLAUDE.md` e `DESIGN.md`.

## Estado da entrega

**Alfa local sintética executável. Não é o MDP produtivo da RFC.** A emissão termina no HAPI, não em uma fila hospitalar real. Produção permanece bloqueada no código.

- [x] Ler requisitos, histórias, arquitetura, invariantes e estilos.
- [x] Aplicar precedência da RFC: sem IA/LLM, chat, mapa embutido ou perfil de saúde salvo.
- [x] Adotar as fronteiras públicas propostas e o início autorizado pelo usuário: motor, HTTP/PostgreSQL, worker/HAPI e interações das interfaces.
- [x] Receber autorização explícita para fixtures exclusivamente sintéticas.

## M0 — Base executável

- [x] Workspaces TypeScript: `core-api`, app Expo, painel React e contratos compartilhados.
- [x] NestJS modular com worker separado no mesmo pacote; PostgreSQL como outbox, sem intermediador de mensagens.
- [x] ADR 0001 com decisões, gates de produção e diferenças entre HAPI e HIS.
- [x] TypeScript estrito, scripts de build/testes/lint, lockfile e `.gitignore`.
- [x] Docker Compose com PostgreSQL 16/PostGIS e HAPI; script de espera com prazo limitado.
- [x] Migrações transacionais com checksums e advisory lock; 11 tabelas da RFC, OTP e pedidos de privacidade.
- [x] UUID v7, `timestamptz`, índice único de idempotência e índice parcial de senha ativa por paciente.
- [x] Laudo imutável e trilhas append-only por trigger e permissões; runtime separado do proprietário.
- [x] Setup local gera chaves aleatórias sem sobrescrever `.env` existente.
- [x] OpenAPI dos endpoints implementados em `/docs` e `/openapi.json`.
- [x] CI configurada para tipos, lint, cobertura, auditoria, integração PostgreSQL/HAPI e builds.
- [x] README com comandos executados e limites da entrega.
- [ ] Executar a CI em GitHub e obter revisão/aprovação de PR.
- [ ] Terraform e implantação AWS sa-east-1; não há provisionamento nesta entrega.

## M1 — Acesso e pré-triagem

### US-01 — Acesso e consentimento; S-01, S-02 e S-10

- [x] OTP **local** persistido, uso único, expiração, cooldown, limite de solicitações e tentativas.
- [x] Token com expiração, autenticação e autorização por titularidade.
- [x] Cadastro cifrado por coluna em `identity`, HMAC independente para buscas e OTP; logs sem PII.
- [x] Cadastro adulto com nome, documento e nascimento; validação de formato no modo sintético.
- [x] Consentimentos separados e versionados; recusar compartilhamento não impede triagem.
- [x] Revogação auditada e aplicada no servidor.
- [x] Acesso sintético explícito e bloqueio de produção.
- [ ] Integrar provedor SMS e validar entrega real, custos e proteção contra abuso.
- [ ] Validar CPF/CNS/titularidade segundo política aprovada do piloto.
- [ ] Substituir chave local por envelope encryption KMS/Secrets Manager com rotação.

### US-02, US-03 e US-04 — Sessão, emergência e laudo; S-03 a S-06

- [x] YAML versionado validado, determinístico e deliberadamente fictício; sem ML/LLM ou texto livre no caminho crítico.
- [x] Sexo, marcadores de comorbidade e queixas fictícias por sessão; perguntas objetivas, progresso e edição antes de concluir.
- [x] Persistência a cada resposta e retomada pelo identificador da sessão; sem armazenar respostas clínicas no dispositivo.
- [x] Precaução de um nível para discriminador crítico ausente/duvidoso.
- [x] Alarmes interrompem imediatamente, mostram 192 e impedem recomendações e emissão também no servidor.
- [x] Laudo imutável com urgência, especialidades, motivos, versão e SHA-256 que incorpora o conteúdo das regras.
- [x] Urgência em texto e cor; aviso de que não é diagnóstico e de que a classificação hospitalar prevalece.
- [x] Casos para todos os alarmes do conjunto sintético; testes de domínio implementados em ciclos red/green.
- [ ] Protocolo escolhido/licenciado e regras/casos/textos aprovados pelo responsável clínico.
- [ ] Verificar metas clínicas M1 e M2 com conjunto independente aprovado; fixtures não são evidência clínica.

## M2 — Recomendações e senha

### US-05 — Hospitais; S-07

- [x] Seed idempotente de uma clínica explicitamente fictícia em São Paulo; sem cadastro administrativo na interface.
- [x] Recomendações por distância PostGIS, especialidade compatível e unidades sintéticas 24h.
- [x] Verificação do HAPI a cada busca; unidade indisponível não aparece em nova resposta.
- [x] Localização aproximada ou busca textual local por Centro, Sé e CEP 01001-000.
- [x] Distância sem inventar ETA; espera nula quando não há fonte confiável.
- [ ] Geocodificação de bairros/CEP fora do catálogo local.
- [ ] Google Routes, cache de 3 minutos e horário de funcionamento na chegada para unidades não 24h.
- [ ] Fonte real de capacidade/espera e monitoração contínua do conector com SLA de 1 minuto.

### US-06 e US-08 — Emissão e integração; S-08

- [x] Escolha explícita de unidade recomendada, laudo do titular e consentimento vigente antes de emitir.
- [x] Ticket e outbox na mesma transação; `Idempotency-Key` obrigatório.
- [x] Repetição concorrente devolve o mesmo ticket; mudança de conteúdo da chave é rejeitada.
- [x] Somente uma senha solicitada/enviada/ativa por paciente, garantida também pelo banco.
- [x] Worker com `FOR UPDATE SKIP LOCKED`, timeout, tentativas persistidas e recuperação após falha de confirmação.
- [x] Bundle FHIR R4 com Patient, Encounter, Observation e DocumentReference/PDF; criação condicional por identificador.
- [x] Revalidação de consentimento antes de transmitir, erros seguros e ausência de PII em outbox/logs.
- [x] Confirmação do identificador **sintético** persistido no HAPI; não é apresentado como fila hospitalar real.
- [x] Estados de envio, falha acionável e ação para buscar outra unidade; sem emissão automática.
- [x] Integração HAPI cobre repetição, concorrência, cancelamento, falhas e expiração.
- [ ] Adaptador do HIS piloto: código real da senha, leitura de fila, mTLS e credenciais por unidade.
- [ ] Conformidade/homologação do conector do hospital antes de habilitar escrita real.
- [ ] Medir p95 ≤ 5 s e sucesso ≥ 95% contra o HIS do piloto; ainda não comprovados.

### US-07 — Acompanhamento; S-09

- [x] Polling a cada segundo enquanto a emissão está pendente e a cada 5 segundos no acompanhamento ativo.
- [x] Cancelamento só muda estado após confirmação externa; falha não libera a senha silenciosamente.
- [x] Expiração sintética enfileira cancelamento e aguarda confirmação do HAPI.
- [x] Código, estado, validade, unidade, resumo, navegação externa e cancelamento na interface.
- [x] Regras públicas de transição e tratamento de estados inválidos.
- [ ] Push FCM/APNs e revalidação ao retornar do segundo plano em dispositivo real.
- [ ] Validade produtiva baseada em chegada estimada e janela homologada. Sem ETA, o modo sintético usa a janela a partir da emissão.

## M3 — Triador, auditoria e direitos

### US-09 — Painel W-01

- [x] Interface única com fila, laudo e classificação da unidade.
- [x] Código Cognito authorization-code/PKCE no cliente e verificação JWKS/issuer/client/token_use no servidor.
- [x] Autorização por grupo de unidade, não por `facilityId` enviado pelo cliente; credencial sintética local separada.
- [x] Classificação final em `ops.outcome`, idempotência do registro e preservação do laudo original.
- [x] Leitura e classificação auditadas sem PII nos logs.
- [ ] Provisionar/configurar user pool e executar integração real Cognito.
- [ ] Reconciliar chegada/atendimento/desfechos com o HIS real.

### US-11 — Auditoria

- [x] Eventos de autenticação, cadastro, consentimento, sessão, laudo, recomendações, tickets, gateway e painel.
- [x] Eventos e auditoria append-only protegidos também contra mutação pelo proprietário enquanto os triggers estiverem ativos.
- [x] Laudo ligado às respostas, versão/hash, ticket e eventos; casos de imutabilidade e unicidade no PostgreSQL real.
- [ ] Rotina operacional autorizada de reconstrução/exportação de evidências e revisão de acessos.

### US-12 — Direitos; S-10

- [x] Pedidos de exportação/exclusão no app, recibo imediato e prazo de 15 dias persistido.
- [x] Procedimento preliminar em `docs/privacidade-operacao.md`, explicitando que recebimento não é execução.
- [ ] Aprovar canal de entrega, verificação de identidade, retenção e rotina operacional com DPO.
- [ ] Implementar/executar exportação e anonimização auditadas; não há apagamento automático nesta entrega.

## Interface e acessibilidade

- [x] Tokens Bodoni Moda/Figtree locais, vinho `#5A1E16`, verde `#45B08C`, névoa `#F7F9F7`, branco e texto `#2A2524`.
- [x] Coluna única até 420 px, bordas vinho, sem sombras/gradientes ou funcionalidades fora da RFC.
- [x] Texto escuro sobre verde para contraste; urgência em cor e texto; rótulos, alvos grandes, foco web e aviso sintético.
- [x] Estados de rede, localização, vazio, erro de emissão, cancelamento pendente e expiração.
- [x] Testes de interação do paciente e do triador e exportação web do Expo.
- [ ] Revisão visual em navegador real, ampliação, teclado, leitor de tela e auditoria WCAG 2.1 AA.
- [ ] Smoke tests em aparelho Android/iOS; exportação de bundle não substitui teste de dispositivo.

## M4 — Produção e evidências externas

- [ ] Terraform ECS Fargate/RDS em sa-east-1, rede, IAM mínimo, KMS, Secrets Manager e CloudWatch.
- [ ] Sentry com filtragem de dados sensíveis e alertas; logs atuais são locais e sanitizados.
- [ ] Staging, feature flag de liberação, smoke test e demonstração revisada.
- [x] Auditoria de dependências local sem findings altos/críticos, com lockfile e overrides verificados por build/testes.
- [ ] Acompanhar 8 findings baixos transitivos do tooling Expo (`deepmerge`); atualizar após correção compatível.
- [ ] SAST, revisão independente de segurança e aprovação de PR.
- [ ] Hospital piloto, credenciais/certificados e comprovação de senha na fila real.
- [ ] RIPD, DPO, políticas, enquadramento SaMD e aprovações clínica/regulatória.

## Validação local registrada

- [x] 48 testes de domínio, gateway e interfaces.
- [x] 13 testes de integração HTTP/PostgreSQL/HAPI.
- [x] Domínio com 100% de linhas, branches, funções e statements; não é cobertura integral da aplicação nem validação clínica.
- [x] Typecheck e ESLint de todos os workspaces.
- [x] Build da API, painel e exportações web/Android Expo.
- [x] Smoke da API compilada, banco, OpenAPI, autenticação e gates de produção/banco remoto.
- [x] Migrações e seed repetidos sem duplicação; Compose validado localmente.

O MDP só estará concluído quando a senha aparecer na fila real do hospital e os requisitos de liberação forem atendidos.
