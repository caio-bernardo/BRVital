import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { v7 as uuid } from 'uuid';
import type { Answer, Session, TriageReport } from '@brvital/contracts';
import { Database, audit } from '../database.js';
import { defaultRulesPath, evaluate, loadRules, type Rules } from '../domain/triage.js';
import { open } from '../auth/crypto.js';

interface SessionRow { id: string; patient_id: string; status: Session['status']; answers: Record<string, Answer>; }
export function toReport(row: Record<string, unknown>): TriageReport {
  return { id: row.id as string, sessionId: row.session_id as string, urgencyLevel: row.urgency_level as TriageReport['urgencyLevel'],
    specialties: row.specialties as string[], redFlags: row.red_flags as string[], explanation: row.explanation as string[],
    rulesetVersion: row.ruleset_version as string, contentHash: (row.content_hash as Buffer).toString('hex'), createdAt: (row.created_at as Date).toISOString(), synthetic: true };
}
@Injectable()
export class TriageService {
  private rules: Promise<Rules> | undefined;
  constructor(@Inject(Database) private readonly db: Database) {}
  private getRules() { return this.rules ??= loadRules(defaultRulesPath); }
  async requireConsent(client: PoolClient, patientId: string, purpose: 'triage' | 'share_with_facility') {
    const consent = await client.query('SELECT id FROM identity.consent WHERE patient_id=$1 AND purpose=$2 AND revoked_at IS NULL AND granted_at<=now() FOR SHARE', [patientId, purpose]);
    if (!consent.rowCount) throw new ForbiddenException(purpose === 'triage' ? 'Autorize a pré-triagem para continuar.' : 'Autorize o compartilhamento com a unidade para emitir a senha.');
  }
  async requireProfile(client: PoolClient, patientId: string) {
    const patient = await client.query('SELECT full_name_enc,birth_date_enc,cpf_enc,cns_enc FROM identity.patient WHERE id=$1 AND erased_at IS NULL FOR SHARE', [patientId]);
    const profile = patient.rows[0];
    if (!profile?.full_name_enc || !profile.birth_date_enc || !(profile.cpf_enc || profile.cns_enc)) throw new ForbiddenException('Complete seu cadastro antes da pré-triagem.');
    const adult = new Date(); adult.setUTCFullYear(adult.getUTCFullYear() - 18);
    if (new Date(open(profile.birth_date_enc, this.db.config)) > adult) throw new ForbiddenException('Demonstração somente para adultos.');
  }
  private async view(row: SessionRow): Promise<Session> {
    const result = evaluate(await this.getRules(), row.answers);
    return { sessionId: row.id, answers: row.answers, status: row.status, nextQuestion: result.nextQuestion, progress: result.progress, ...(result.outcome ? { outcome: result.outcome } : {}) };
  }
  async start(patientId: string) {
    return this.db.transaction(async client => {
      await this.requireConsent(client, patientId, 'triage');
      await this.requireProfile(client, patientId);
      const id = uuid();
      const row = (await client.query<SessionRow>(`INSERT INTO clinical.triage_session(id,patient_id,status,answers) VALUES($1,$2,'in_progress','{}') RETURNING *`, [id, patientId])).rows[0]!;
      await audit(client, `patient:${patientId}`, 'triage.started', `session:${id}`);
      return this.view(row);
    });
  }
  async get(patientId: string, id: string) {
    const result = await this.db.pool.query<SessionRow>('SELECT * FROM clinical.triage_session WHERE id=$1 AND patient_id=$2', [id, patientId]);
    if (!result.rows[0]) throw new NotFoundException('Sessão não encontrada.');
    return this.view(result.rows[0]);
  }
  async answer(patientId: string, id: string, questionId: string, value: Answer) {
    return this.db.transaction(async client => {
      await this.requireConsent(client, patientId, 'triage');
      const row = (await client.query<SessionRow>('SELECT * FROM clinical.triage_session WHERE id=$1 AND patient_id=$2 FOR UPDATE', [id, patientId])).rows[0];
      if (!row) throw new NotFoundException('Sessão não encontrada.');
      if (JSON.stringify(row.answers[questionId]) === JSON.stringify(value)) return this.view(row);
      if (row.status !== 'in_progress') throw new ConflictException('Sessão encerrada. Inicie outra para gerar um novo laudo.');
      const rules = await this.getRules();
      const current = evaluate(rules, row.answers);
      if (current.nextQuestion?.id !== questionId && row.answers[questionId] === undefined && !rules.decisions.some(decision => decision.questionId === questionId && decision.redFlag)) {
        throw new BadRequestException('Responda a pergunta atual para continuar.');
      }
      const index = rules.questions.findIndex(question => question.id === questionId);
      const answers = row.answers[questionId] === undefined ? { ...row.answers } : Object.fromEntries(Object.entries(row.answers).filter(([key]) => rules.questions.findIndex(question => question.id === key) <= index));
      answers[questionId] = value;
      let evaluation;
      try { evaluation = evaluate(rules, answers); } catch { throw new BadRequestException('Opção ou pergunta inválida.'); }
      const status = evaluation.outcome === 'EMERGENCY' ? 'emergency' : evaluation.outcome === 'REPORT_READY' ? 'completed' : 'in_progress';
      await client.query('UPDATE clinical.triage_session SET answers=$2,status=$3 WHERE id=$1', [id, answers, status]);
      if (evaluation.outcome) {
        await client.query(`INSERT INTO clinical.triage_report(id,session_id,urgency_level,specialties,red_flags,explanation,ruleset_version,content_hash)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [uuid(), id, evaluation.urgencyLevel, evaluation.specialties, evaluation.redFlags, JSON.stringify(evaluation.explanation), evaluation.rulesetVersion, Buffer.from(evaluation.contentHash, 'hex')]);
      }
      await audit(client, `patient:${patientId}`, evaluation.outcome === 'EMERGENCY' ? 'triage.emergency' : evaluation.outcome ? 'triage.report_created' : 'triage.answer_saved', `session:${id}`);
      return this.view({ ...row, answers, status });
    });
  }
  async report(patientId: string, id: string) {
    return this.db.transaction(async client => {
      const report = await client.query('SELECT r.* FROM clinical.triage_report r JOIN clinical.triage_session s ON s.id=r.session_id WHERE s.id=$1 AND s.patient_id=$2', [id, patientId]);
      if (!report.rows[0]) throw new NotFoundException('Laudo ainda não disponível.');
      await audit(client, `patient:${patientId}`, 'report.read', `report:${report.rows[0].id}`);
      return toReport(report.rows[0]);
    });
  }
}
