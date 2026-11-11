# Gateway FHIR exclusivamente sintético

**Não emite senha em fila hospitalar real. Não habilitar para pacientes reais ou produção.** O worker recusa `APP_MODE` diferente de `synthetic` e `NODE_ENV=production`. Destinos permitidos são apenas `http://localhost:8080/fhir` e `http://hapi:8080/fhir`; credenciais na URL, query string, fragmento e redirecionamentos são proibidos. Cada unidade também precisa ser `synthetic=true` e usar FHIR R4.

## Execução

Veja `database/README.md` para Compose, credenciais e migrações. `npm run dev:worker` inicia somente o worker; importar `processOutbox` de `outbox.ts` não inicia nenhum loop. `processOutbox(pool, options?)` devolve a quantidade de mensagens processadas; por padrão processa até 10, com timeout HTTP de 4 segundos e no máximo 3 tentativas persistidas. O processo usa lotes de 1 para permitir encerramento entre mensagens.

Contrato outbox:

- Emissão: `type='ticket.requested'`, `aggregate_id=ticketId`, `payload={ticketId}`.
- Cancelamento: `type='ticket.cancel'`, mesmo aggregate/payload; a API marca `cancellation_pending=true` na mesma transação. Só após confirmar Encounter `cancelled` no HAPI o estado local muda.
- Expiração: o worker agenda cancelamento com `reason='expired'` para senhas ativas vencidas. Só após confirmação externa muda para `expired`. Nunca expira silenciosamente uma senha cujo cancelamento está pendente.

O worker mantém uma transação e `FOR UPDATE SKIP LOCKED` por mensagem, além de lock do ticket e locks de compartilhamento no paciente/consentimento antes do envio. Revogação concorrente aguarda a transação; consentimento é revalidado em cada tentativa. Não existe envio de PII quando falta consentimento ou há red flag. Cancelamento usa somente o recurso externo existente, sem dados pessoais novos; pode ocorrer após revogação. Erros HTTP e de payload são códigos fixos sem o corpo remoto, sem URLs ou PII nos logs/eventos.

## FHIR R4

Transação de quatro criações condicionais (`ifNoneExist`), cada recurso com `urn:brvital:idempotency:<ResourceType>|<idempotency_key>`:

1. Patient: identificação mínima decifrada de `identity` (AES-256-GCM, chave `PII_ENCRYPTION_KEY`, base64 de 32 bytes). Telefone não é enviado.
2. Encounter: `planned`, classe EMER, unidade por identificador lógico, **`urn:brvital:synthetic-ticket`** com código `DEMO-<UUID do ticket>`.
3. Observation: urgência determinística de pré-triagem, namespace local, sem alegar classificação clínica oficial.
4. DocumentReference: PDF inline sem identificação pessoal adicional; hash SHA-256 do laudo e do PDF em extensões próprias. `Attachment.hash` usa SHA-1 como exige FHIR R4.

Todos carregam tag `synthetic`. HAPI é armazenamento FHIR, não HIS nem gerenciador de filas: o identificador DEMO é criado pelo gateway, persistido e confirmado na resposta, **não é uma senha devolvida por um hospital**. `queue_size`/`avg_wait_min` não são inventados. A resposta precisa confirmar quatro recursos e identificadores; quando o servidor omite representação, lemos as localizações retornadas, restritas ao mesmo HAPI. Código/id não confirmados nunca ativam ticket.

Cancelamento lê Encounter e faz PUT com `If-Match` da versão; não sobrescreve atendimentos iniciados ou estados externos incompatíveis. Falha mantém status e `cancellation_pending`, registra código seguro e encerra após tentativas limitadas. Nova solicitação explícita pode enfileirar outra mensagem. Timeout após aceite externo pode deixar recursos no HAPI; repetir a emissão usa criação condicional, sem duplicar. Não existe reconciliação com HIS real neste scaffold; falhas ambíguas exigem investigação antes de qualquer operação clínica.

`valid_until` já fornecido pela API é preservado; na ausência usa agora + `ticket_window_min`. O worker não calcula deslocamento. Sessão/laudo/paciente devem corresponder; urgência 1 ou red flags bloqueiam emissão.

## Testes

`npx vitest run apps/core-api/src/gateway/gateway.test.ts` exercita a fronteira HTTP com respostas controladas, sem disputar a porta do HAPI. Para integração, suba Compose, aplique migrações e seed e defina `DATABASE_URL`, `DATABASE_MIGRATOR_URL`, `PII_ENCRYPTION_KEY`, `APP_MODE=synthetic`, `RUN_INTEGRATION=1`; execute `npm run test:integration`. Os testes geram apenas pacientes fictícios e deixam laudos/eventos imutáveis para inspeção no banco local. Não execute contra banco compartilhado ou com dados reais.
