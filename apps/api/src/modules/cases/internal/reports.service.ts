import { Injectable, NotFoundException } from '@nestjs/common';
import type { ConsultReport, ConsultReportDraft, ReportStatus } from '@mir/contracts';
import { requireContext, runWithContext, systemContext } from '../../../shared/context/request-context';
import { DatabaseService } from '../../../shared/db/database.service';
import { EventBus } from '../../../shared/events/event-bus';
import { LedgerService } from '../../ledger';
import { actorFields, translateCaseWriteError } from './cases.service';

/** Draft-only upsert: a submitted report matches no row, so it reads as missing. */
const UPSERT_DRAFT = `INSERT INTO cases_reports (case_id, author_id, content) VALUES ($1, $2, $3)
  ON CONFLICT (case_id) DO UPDATE SET content = EXCLUDED.content, updated_at = now()
    WHERE cases_reports.status = 'draft'`;

export interface StoredReport {
  status: ReportStatus;
  content: ConsultReportDraft;
  submittedAt: Date | null;
}

/**
 * The consult report — spec 2026-09-21 §5. Who may read or write it is
 * migration 0034's RLS; a refusal or a miss is "Case not found" (§6).
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly bus: EventBus,
    private readonly ledger: LedgerService,
  ) {}

  async get(caseId: string): Promise<StoredReport | null> {
    const row = await this.db.tx(async (tx) => {
      const r = await tx.query<{
        status: ReportStatus;
        content: ConsultReportDraft;
        submitted_at: Date | null;
      }>('SELECT status, content, submitted_at FROM cases_reports WHERE case_id = $1', [caseId]);
      return r.rows[0];
    });
    return row === undefined
      ? null
      : { status: row.status, content: row.content, submittedAt: row.submitted_at };
  }

  async saveDraft(caseId: string, draft: ConsultReportDraft): Promise<void> {
    const { userId } = requireContext();
    const written = await this.db
      .tx(async (tx) => (await tx.query(UPSERT_DRAFT, [caseId, userId, JSON.stringify(draft)])).rowCount ?? 0)
      .catch((err: unknown) => translateCaseWriteError(err, 'Case not found'));
    if (written === 0) throw new NotFoundException('Case not found');
  }

  /**
   * The answer IS the submitted report: one transaction stores it and moves
   * the case `accepted → answered`, so neither exists without the other.
   */
  async submitWithAnswer(caseId: string, report: ConsultReport): Promise<void> {
    const { userId } = requireContext();
    const answered = await this.db
      .tx(async (tx) => {
        const up = await tx.query(UPSERT_DRAFT, [caseId, userId, JSON.stringify(report)]);
        if ((up.rowCount ?? 0) === 0) throw new NotFoundException('Case not found');
        // Submitted BEFORE the case moves: the update policy requires the case
        // to still be `accepted`.
        await tx.query(
          `UPDATE cases_reports SET status = 'submitted', submitted_at = now() WHERE case_id = $1`,
          [caseId],
        );
        const moved = await tx.query<{ patient_id: string; doctor_id: string }>(
          `UPDATE cases_cases SET status = 'answered', answered_at = now()
            WHERE id = $1 AND status = 'accepted' RETURNING patient_id, doctor_id`,
          [caseId],
        );
        // Throwing rolls the report back with the case.
        if (moved.rows[0] === undefined) throw new NotFoundException('Case not found');
        return moved.rows[0];
      })
      .catch((err: unknown) => translateCaseWriteError(err, 'Case not found'));

    // As the system role — the ledger's INSERT policy admits nobody else (see
    // CasesService.markPaid). Idempotent by the one-payout-per-case index.
    await runWithContext(systemContext('case-accrual'), () =>
      this.ledger.accrueDoctorPayout(caseId),
    );
    await this.bus.publish({
      type: 'CaseAnswered',
      caseId,
      patientId: answered.patient_id,
      doctorId: answered.doctor_id,
      ...actorFields(),
    });
  }
}
