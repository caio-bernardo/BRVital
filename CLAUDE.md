# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status

Alfa local sintética implementada em workspaces npm: `apps/core-api`, `apps/mobile`, `apps/triage-panel` e `packages/contracts`. Consulte `README.md` para comandos reais de setup, build, lint e testes; `TASKS.md` registra pendências. API e gateway bloqueiam produção; HAPI não representa uma fila hospitalar real. `RFC.md` (v0.2.0, escopo MDP) continua sendo a fonte de verdade: leia a seção relevante antes de implementar. Escreva comentários, documentação e textos da interface em português brasileiro, salvo orientação contrária.

BRVital: app for symptom pre-triage (rule-based, per clinical protocol), hospital recommendation, and remote queue ticket (senha) issuance written into a real hospital HIS via HL7 FHIR.

## Planned architecture (from RFC)

- **Mobile app**: React Native + Expo, TypeScript (10 screens, S-01..S-10). Triage web panel: React + Cognito (single screen W-01).
- **Backend**: a single NestJS modular monolith, `core-api`, with modules: sessions, triage rules, hospital network, tickets. OpenAPI-documented. A **gateway worker** lives in the same codebase but runs as a separate process.
- **Database**: PostgreSQL 16 + PostGIS, four schemas: `identity` (the only place with PII, column-encrypted; HMAC columns for lookup), `clinical`, `network`, `ops`. UUID v7 ids, `timestamptz`. Full SQL is in RFC "Esquema do banco de dados".
- **Ticket issuance flow**: `POST /v1/tickets` writes ticket + `ops.outbox` row in one transaction → worker reads outbox with `SELECT ... FOR UPDATE SKIP LOCKED` → builds a FHIR transaction Bundle (Patient/Encounter/Observation/DocumentReference, conditional create via `If-None-Exist` on idempotency key) → HIS. The DB is the queue; no SQS/Redis/Kafka.
- **Infra**: AWS sa-east-1, ECS Fargate, Terraform, GitHub Actions; Sentry + CloudWatch.

## Invariants to preserve

- **Triage urgency comes only from deterministic rules** in versioned YAML files (no ML/LLM in the MVP). Missing/doubtful answer on a critical discriminator raises urgency one level; any red flag stops the flow and shows the 192 emergency screen (no ticket, no recommendation).
- **`clinical.triage_report` is immutable** (no UPDATE/DELETE via trigger + permissions) and stores ruleset version + SHA-256 content hash. Reprocessing creates a new report. `ops.ticket_event` and `ops.audit_log` are append-only.
- **Idempotency lives in the DB**: unique `idempotency_key` and a partial unique index allowing one active ticket (`requested|sent|active`) per patient.
- **Ticket states**: `requested → sent → active`; `sent → rejected|failed`; `active → attended|no_show|expired|cancelled`. Never fail silently; on failure offer the next facility.
- **Privacy**: PII only in `identity`; nothing is sent to the HIS before the patient picks a facility and has granted the separate `share_with_facility` consent; logs must contain no personal data; secrets only in Secrets Manager.
- Hospital's own triage classification always prevails and is recorded in `ops.outcome`.
- Out of scope for the MVP: diagnosis, ML/LLM, pediatrics (adults only), saved health profile, HL7 v2 (unless the pilot HIS requires it), anything outside São Paulo. See RFC Appendix D before adding such features.

## Development process (RFC Definition of Done)

- TDD in domain modules (triage, ticket, consent), ≥80% coverage there; integration tests against a HAPI FHIR server for anything touching the gateway.
- Changing clinical rules requires a version bump, updated test cases, and clinical-owner approval. Rule test cases must cover 100% of red flags.
- Record an ADR for architecture decisions; keep OpenAPI updated; WCAG 2.1 AA on UI (urgency shown in color _and_ text).

## Repo tooling

`.agents/` and `.claude/` hold installed skills (caveman, frontend-design, ponytail, tdd), pinned in `skills-lock.json`.
