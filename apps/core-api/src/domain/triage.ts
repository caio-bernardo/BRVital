import type { Answer, Question, Urgency } from '@brvital/contracts';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { z } from 'zod';

const text = z.string().trim().min(1);
const urgency = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]);
const conditionSchema = z.strictObject({ questionId: text, values: z.array(text).min(1) });
const questionSchema = z.strictObject({
  id: text, text, critical: z.boolean(), multiple: z.boolean().default(false),
  options: z.array(z.strictObject({ value: text, label: text })).min(2),
  when: conditionSchema.optional(),
});
const rulesSchema = z.strictObject({
  version: z.string().regex(/^synthetic-\d+\.\d+\.\d+$/),
  synthetic: z.literal(true), disclaimer: text,
  baseUrgency: urgency, specialties: z.array(text).min(1),
  questions: z.array(questionSchema).min(1),
  decisions: z.array(z.strictObject({
    ...conditionSchema.shape, urgency: urgency.optional(), specialties: z.array(text).min(1).optional(),
    redFlag: text.optional(), explanation: text,
  })).min(1),
}).superRefine((rules, context) => {
  const invalid = (message: string) => context.addIssue({ code: 'custom', message });
  const validCondition = (condition: z.infer<typeof conditionSchema>, questions = rules.questions) => {
    const question = questions.find(question => question.id === condition.questionId);
    return question && condition.values.every(value => question.options.some(option => option.value === value));
  };
  if (new Set(rules.questions.map(question => question.id)).size !== rules.questions.length) {
    invalid('Identificadores de pergunta duplicados.');
  }
  rules.questions.forEach((question, index) => {
    if (new Set(question.options.map(option => option.value)).size !== question.options.length) {
      invalid('Opções duplicadas.');
    }
    if (question.when && !validCondition(question.when, rules.questions.slice(0, index))) {
      invalid('Condição deve referenciar uma opção de pergunta anterior.');
    }
    if (question.critical && (question.multiple || !question.options.some(option => option.value === 'desconhecido'))) {
      invalid('Discriminador crítico deve ser de seleção única e permitir desconhecido.');
    }
  });
  for (const decision of rules.decisions) {
    if (!validCondition(decision)) invalid('Decisão referencia pergunta ou opção inexistente.');
    if (decision.redFlag && decision.urgency !== 1) invalid('Alarme deve declarar urgência 1.');
  }
});
export type Rules = z.infer<typeof rulesSchema> & { contentHash: string };

// src/domain e dist/domain têm a mesma profundidade em relação à raiz do repositório.
export const defaultRulesPath = fileURLToPath(new URL('../../../../rules/synthetic-0.1.0.yaml', import.meta.url));

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

export function evaluate(rules: Rules, answers: Record<string, Answer>): Evaluation {
  if (!z.record(z.string(), z.union([z.string(), z.array(z.string())])).safeParse(answers).success) {
    throw new Error('Resposta inválida: use opções estruturadas.');
  }
  for (const [id, answer] of Object.entries(answers)) {
    const question = rules.questions.find(question => question.id === id);
    const values = Array.isArray(answer) ? answer : [answer];
    if (!question || (Array.isArray(answer) && !question.multiple) || !values.length ||
        new Set(values).size !== values.length || values.some(value => !question.options.some(option => option.value === value))) {
      throw new Error('Resposta inválida: pergunta, formato ou opção não reconhecidos.');
    }
  }
  const matches = (condition: z.infer<typeof conditionSchema>) => {
    const answer = answers[condition.questionId];
    return condition.values.some(value => Array.isArray(answer) ? answer.includes(value) : answer === value);
  };
  const questions = rules.questions.filter(question => !question.when || matches(question.when));
  // Alarmes são globais: nunca aguardar o preenchimento de outro ramo para interromper.
  const decisions = rules.decisions.filter(decision => (decision.redFlag || questions.some(question => question.id === decision.questionId)) && matches(decision));
  const redFlags = decisions.flatMap(decision => decision.redFlag ? [decision.redFlag] : []);
  const urgencyLevel = Math.min(rules.baseUrgency, ...decisions.flatMap(decision => decision.urgency === undefined ? [] : [decision.urgency])) as Urgency;
  const uncertain = questions.some(question => question.critical && (answers[question.id] === undefined || answers[question.id] === 'desconhecido'));
  const next = questions.find(question => answers[question.id] === undefined);
  const result: Evaluation = {
    nextQuestion: next && !redFlags.length ? { id: next.id, text: next.text, critical: next.critical, options: next.options.map(option => ({ ...option })) } : null,
    progress: { answered: questions.filter(question => answers[question.id] !== undefined).length, total: questions.length },
    ...(redFlags.length ? { outcome: 'EMERGENCY' as const } : !next ? { outcome: 'REPORT_READY' as const } : {}),
    urgencyLevel: redFlags.length ? 1 : Math.max(1, urgencyLevel - (uncertain ? 1 : 0)) as Urgency,
    specialties: redFlags.length ? [] : [...new Set([...rules.specialties, ...decisions.flatMap(decision => decision.specialties ?? [])])],
    redFlags, explanation: [...decisions.map(decision => decision.explanation), ...(uncertain && !redFlags.length ? ['Precaução: discriminador crítico ausente ou desconhecido; urgência elevada uma única vez.'] : [])],
    rulesetVersion: rules.version, contentHash: '', synthetic: true,
  };
  const canonicalAnswers = Object.fromEntries(Object.keys(answers).sort().map(id => {
    const answer = answers[id];
    return [id, Array.isArray(answer) ? [...answer].sort() : answer];
  }));
  const clinicalResult = {
    urgencyLevel: result.urgencyLevel, specialties: [...result.specialties].sort(),
    redFlags: [...result.redFlags].sort(), explanation: result.explanation,
    rulesetVersion: result.rulesetVersion, synthetic: result.synthetic,
  };
  result.contentHash = createHash('sha256').update(JSON.stringify({ ruleContentHash: rules.contentHash, answers: canonicalAnswers, clinicalResult })).digest('hex');
  return result;
}

export async function loadRules(path: string): Promise<Rules> {
  const source = await readFile(path, 'utf8');
  const rules = rulesSchema.parse(parse(source));
  return { ...rules, contentHash: createHash('sha256').update(source).digest('hex') };
}
