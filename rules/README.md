# Regras exclusivamente sintéticas

`synthetic-0.1.0.yaml` é uma fixture de engenharia **sem validade clínica e sem aprovação clínica**. Queixas A/B, marcadores X/Y, contadores e especialidades são inventados. Nenhuma dessas regras deve decidir atendimento ou ser apresentada como protocolo aprovado. Em emergência real, ligue 192.

Mudanças desta fixture exigem nova versão e atualização dos testes. Regras clínicas reais exigirão validação e aprovação do responsável clínico, além de revisão dos textos e dos casos de alarme previstos no RFC.

## API pública do domínio

Os módulos estão em `apps/core-api/src/domain/`; imports ESM usam `.js` também no código TypeScript.

### `triage.ts`

```ts
export const defaultRulesPath: string;
export function loadRules(path: string): Promise<Rules>;
export function evaluate(rules: Rules, answers: Record<string, Answer>): Evaluation;
```

- `Answer`, `Question` e `Urgency` são os tipos de `@brvital/contracts`.
- `Rules` é o YAML validado com `contentHash` SHA-256 dos bytes UTF-8 carregados. O chamador deve tratar as regras carregadas como somente leitura.
- `defaultRulesPath` usa `import.meta.url`, não o diretório de execução. Tanto `apps/core-api/src/domain/` quanto `apps/core-api/dist/domain/` ficam quatro níveis abaixo da raiz. O artefato implantado deve preservar a pasta `rules/` nessa raiz.
- `loadRules` rejeita YAML inválido, campos desconhecidos, versões não sintéticas, identificadores/opções duplicados, referências inexistentes, dependências futuras e discriminadores críticos sem opção `desconhecido` ou com seleção múltipla. Alarmes devem declarar urgência 1. Erros de leitura e validação são propagados; nunca há fallback silencioso.
- `evaluate` não altera regras nem respostas. Rejeita perguntas/opções desconhecidas, arrays em seleção única, arrays vazios, seleções repetidas e valores não estruturados. Uma pergunta de seleção múltipla aceita string ou array de strings.
- Perguntas seguem a ordem do YAML: sexo, comorbidades fictícias, queixa, alarmes e discriminador objetivo do ramo escolhido. `when` compara opções por correspondência de qualquer valor. Respostas válidas de ramo não selecionado são preservadas no hash, mas não influenciam a classificação; **alarmes são globais**, mesmo fora do ramo ativo ou com outras respostas ausentes.
- `progress` conta apenas perguntas aplicáveis; seu total pode aumentar quando a queixa for escolhida. `desconhecido` conta como respondido. Uma resposta ausente mantém a pergunta pendente.
- Urgência é o menor número entre a base e decisões correspondentes (1 é a maior urgência). Havendo qualquer crítico aplicável ausente ou `desconhecido`, sobe **uma única vez**, com limite em 1. Isso não cria um sinal de alarme fictício adicional.
- Qualquer alarme retorna `EMERGENCY`, nível 1, `nextQuestion: null` e `specialties: []`. Não recomendar unidade nem emitir senha nesse caso.
- Sem pendências e sem alarme, retorna `REPORT_READY`. Durante o questionário, `outcome` não está presente. Só persistir laudo quando estiver pronto; IDs, sessão e data ficam a cargo do serviço.

```ts
export interface Evaluation {
  nextQuestion: Question | null;
  progress: { answered: number; total: number };
  outcome?: 'EMERGENCY' | 'REPORT_READY';
  urgencyLevel: Urgency;
  specialties: string[];
  redFlags: string[];
  explanation: string[];
  rulesetVersion: string;
  contentHash: string;
  synthetic: true;
}
```

O hash do resultado é SHA-256 do JSON UTF-8 com as chaves, nesta ordem:

1. `ruleContentHash`: hash do conteúdo do arquivo de regras.
2. `answers`: chaves ordenadas lexicograficamente; arrays de seleção múltipla também ordenados, sem alterar os originais.
3. `clinicalResult`: `urgencyLevel`, `specialties` ordenadas, `redFlags` ordenados, `explanation` na ordem das decisões, `rulesetVersion`, `synthetic`.

Não entram IDs, datas, progresso ou próxima pergunta. Mesmas regras, respostas estruturadas e resultado produzem o mesmo hash independentemente da ordem de inserção. Mudanças no arquivo, inclusive comentários, alteram o hash das regras e consequentemente o hash do resultado.

### `consent.ts`

```ts
export interface ConsentRecord {
  purpose: string;
  granted_at: Date | string;
  revoked_at: Date | string | null;
}
export function consentGranted(consents: readonly ConsentRecord[], purpose: string): boolean;
```

A concessão mais recente por `granted_at` controla a finalidade, independentemente da ordem dos registros. Empate com revogação nega acesso. Data inválida ou revogação anterior à concessão na finalidade consultada também nega. Uma concessão posterior permite consentir novamente. Não consulta relógio, banco nem estado global; o serviço deve fornecer registros já efetivados e datas persistidas, não intenções futuras.

### `tickets.ts`

```ts
export function assertTicketTransition(from: TicketStatus, to: TicketStatus): void;
export function checkTicketRequest(
  report: Pick<TriageReport, 'redFlags'>,
  consents: readonly ConsentRecord[],
): void;
```

`assertTicketTransition` permite exclusivamente:

- `requested → sent`
- `sent → active | rejected | failed`
- `active → attended | no_show | expired | cancelled`

Repetição e saída de estado terminal lançam erro. Idempotência não significa repetir uma transição: o serviço recupera o resultado já persistido no banco.

`checkTicketRequest` lança erro quando houver alarme ou faltar consentimento atual `share_with_facility`. Não substitui checagem de titularidade, conclusão do laudo, unidade escolhida, consentimento para iniciar triagem, idempotência, índice de senha ativa, transação/outbox ou validação FHIR. Esses controles pertencem às fronteiras HTTP/PG e worker/HAPI, fora deste domínio puro.

## Validação e ciclos TDD

Cada fatia foi escrita como teste público, executada em red, implementada e reexecutada em green, nesta ordem:

| Arquivo de teste | Fatias | Resultado green acumulado |
| --- | --- | --- |
| `triage.test.ts` | carregamento; navegação/queixas; todos os alarmes; precaução única; respostas inválidas; hash canônico; esquema seguro | 28 testes |
| `consent.test.ts` | finalidades separadas/revogação; histórico/datas inválidas | 2 testes |
| `tickets.test.ts` | matriz de transições; bloqueios de emissão | 2 testes |

Comandos red/green utilizados na raiz, repetidos a cada fatia:

```sh
npm exec vitest run apps/core-api/src/domain/triage.test.ts
npm exec vitest run apps/core-api/src/domain/consent.test.ts
npm exec vitest run apps/core-api/src/domain/tickets.test.ts
```

Antes da instalação do processo pai terminar, o primeiro comando expirou e a tentativa offline retornou `ENOTCACHED`; esses resultados não foram considerados red. O primeiro red efetivo ocorreu com o Vitest disponível, por módulo ainda inexistente.

Validação final:

```sh
npm exec -- vitest run apps/core-api/src/domain --coverage --coverage.reporter=text --coverage.reportsDirectory=/tmp/brvital-domain-coverage
npm exec -- tsc -p apps/core-api/tsconfig.json --noEmit
npm exec -- eslint apps/core-api/src/domain
```

Os testes enumeram os dois alarmes da fixture e verificam a lista completa declarada no YAML, evitando que um novo alarme seja adicionado sem ampliar os casos. Cobertura medida após as sete fatias de triagem: 100% de linhas, statements, funções e branches em cada um dos três módulos. Nenhuma chamada a HIS, dado real ou simulação de aprovação clínica integra estes testes.
