import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultRulesPath, evaluate, loadRules } from './triage.js';

describe('regras sintéticas de demonstração', () => {
  it('começa pelo sexo e ramifica perguntas objetivas pela queixa', async () => {
    const rules = await loadRules(defaultRulesPath);
    expect(evaluate(rules, {})).toMatchObject({ nextQuestion: { id: 'sex' }, progress: { answered: 0, total: 5 }, synthetic: true });
    const answers = { sex: 'masculino', comorbidities: ['nenhuma'], complaint: 'queixa_a', alarm_a: 'nao', alarm_b: 'nao' };
    expect(evaluate(rules, answers)).toMatchObject({ nextQuestion: { id: 'discriminator_a' }, progress: { answered: 5, total: 6 } });
    expect(evaluate(rules, { ...answers, complaint: 'queixa_b' })).toMatchObject({ nextQuestion: { id: 'discriminator_b' } });
    expect(evaluate(rules, { ...answers, discriminator_a: 'nao' })).toMatchObject({ nextQuestion: null, outcome: 'REPORT_READY', urgencyLevel: 5, specialties: ['clinica_demonstrativa', 'especialidade_demonstrativa_a'] });
  });
  it.each([
    ['alarm_a', 'alarme_ficticio_a'],
    ['alarm_b', 'alarme_ficticio_b'],
  ])('interrompe imediatamente com %s mesmo sem as demais respostas', async (questionId, flag) => {
    const rules = await loadRules(defaultRulesPath);
    expect(evaluate(rules, { [questionId]: 'sim' })).toMatchObject({
      nextQuestion: null, outcome: 'EMERGENCY', urgencyLevel: 1, specialties: [], redFlags: [flag],
    });
    expect(rules.decisions.filter(decision => decision.redFlag).map(decision => decision.redFlag)).toEqual(['alarme_ficticio_a', 'alarme_ficticio_b']);
  });

  it('eleva só um nível por críticos ausentes ou duvidosos e explica a precaução', async () => {
    const rules = await loadRules(defaultRulesPath);
    const base = { sex: 'feminino', comorbidities: ['marcador_x'], complaint: 'queixa_a' };
    expect(evaluate(rules, base)).toMatchObject({ urgencyLevel: 3 });
    const uncertain = evaluate(rules, { ...base, alarm_a: 'desconhecido', alarm_b: 'desconhecido', discriminator_a: 'desconhecido' });
    expect(uncertain).toMatchObject({ urgencyLevel: 3, outcome: 'REPORT_READY', nextQuestion: null });
    expect(uncertain.explanation).toContain('Precaução: discriminador crítico ausente ou desconhecido; urgência elevada uma única vez.');
    expect(evaluate(rules, { ...base, alarm_a: 'nao', alarm_b: 'nao', discriminator_a: 'sim' })).toMatchObject({ urgencyLevel: 3 });
    expect(evaluate(rules, { ...base, complaint: 'queixa_b', discriminator_b: 'sim' })).toMatchObject({ urgencyLevel: 1, redFlags: [] });
  });

  it.each([
    { inexistente: 'sim' }, { sex: 'invalido' }, { sex: ['masculino'] },
    { comorbidities: [] }, { comorbidities: ['marcador_x', 'marcador_x'] },
    { comorbidities: ['desconhecido_invalido'] }, { sex: null },
  ])('rejeita resposta inválida sem gerar laudo: %j', async answers => {
    const rules = await loadRules(defaultRulesPath);
    expect(() => evaluate(rules, answers as never)).toThrow(/Resposta inválida/);
  });

  it('gera hash canônico das regras, respostas estruturadas e resultado sem depender da ordem', async () => {
    const rules = await loadRules(defaultRulesPath);
    const a = evaluate(rules, { sex: 'masculino', comorbidities: ['marcador_x', 'marcador_y'] });
    const b = evaluate(rules, { comorbidities: ['marcador_y', 'marcador_x'], sex: 'masculino' });
    expect(a.contentHash).toBe(b.contentHash);
    expect(a.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(evaluate(rules, { sex: 'nao_informado', comorbidities: ['marcador_x', 'marcador_y'] }).contentHash).not.toBe(a.contentHash);
    expect(evaluate({ ...rules, baseUrgency: 2 }, { sex: 'masculino', comorbidities: ['marcador_x', 'marcador_y'] }).contentHash).not.toBe(a.contentHash);
    const directory = await mkdtemp(join(tmpdir(), 'brvital-regras-'));
    try {
      const path = join(directory, 'rules.yaml');
      await writeFile(path, `${await readFile(defaultRulesPath, 'utf8')}\n# Conteúdo sintético alterado\n`);
      const changed = await loadRules(path);
      expect(changed.contentHash).not.toBe(rules.contentHash);
      expect(evaluate(changed, { sex: 'masculino', comorbidities: ['marcador_x', 'marcador_y'] }).contentHash).not.toBe(a.contentHash);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each([
    ['produção', 'synthetic: true', 'synthetic: false'],
    ['versão ausente', 'version: synthetic-0.1.0', 'version: 1'],
    ['campo inesperado', 'synthetic: true', 'synthetic: true\naprovado: true'],
    ['urgência fora da escala', 'baseUrgency: 5', 'baseUrgency: 6'],
    ['YAML malformado', 'synthetic: true', 'synthetic: ['],
    ['perguntas duplicadas', 'id: alarm_b', 'id: alarm_a'],
    ['opções duplicadas', 'value: masculino', 'value: feminino'],
    ['condição inexistente', 'questionId: complaint', 'questionId: inexistente'],
    ['valor da condição inexistente', 'values: [queixa_a]', 'values: [inexistente]'],
    ['dependência futura', 'when: { questionId: complaint, values: [queixa_a] }', 'when: { questionId: discriminator_b, values: [sim] }'],
    ['decisão inexistente', 'questionId: sex', 'questionId: inexistente'],
    ['valor da decisão inexistente', 'values: [feminino]', 'values: [inexistente]'],
    ['crítico sem opção de dúvida', 'value: desconhecido', 'value: ignorado'],
    ['crítico multisseleção', 'id: alarm_a', 'id: alarm_a\n    multiple: true'],
    ['alarme com urgência contraditória', 'redFlag: alarme_ficticio_a\n    urgency: 1', 'redFlag: alarme_ficticio_a\n    urgency: 4'],
  ])('rejeita esquema inseguro: %s', async (_name, before, after) => {
    const directory = await mkdtemp(join(tmpdir(), 'brvital-invalido-'));
    try {
      const path = join(directory, 'rules.yaml');
      await writeFile(path, (await readFile(defaultRulesPath, 'utf8')).replaceAll(before, after));
      await expect(loadRules(path)).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('carrega YAML versionado sem atribuir aprovação clínica', async () => {
    const rules = await loadRules(defaultRulesPath);
    expect(rules).toMatchObject({ synthetic: true, version: 'synthetic-0.1.0' });
    expect(rules.disclaimer).toContain('sem validade clínica');
    expect(rules.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });
});
