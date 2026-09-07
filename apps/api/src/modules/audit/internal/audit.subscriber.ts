import { Injectable, type OnModuleInit } from '@nestjs/common';
import { EventBus } from '../../../shared/events/event-bus';
import type { DomainEventType } from '../../../shared/events/domain-events';
import { AuditService } from './audit.service';

/**
 * Subscribes the audit log to every domain event — BUILD_SPEC P4.4 step 2.
 *
 * The list is exhaustive by construction: `AUDITED_EVENTS` is typed as
 * `DomainEventType[]` and the completeness test asserts it covers the union.
 * Adding an event type without auditing it therefore fails a test rather than
 * quietly producing an untracked action.
 */

const AUDITED_EVENTS: DomainEventType[] = [
  'PatientCreated',
  'ConsentGranted',
  'ConsentRevoked',
  'StudyUploadCompleted',
  'CaseSubmitted',
  'CaseQuoted',
  'CaseCancelled',
  'CaseDeclined',
  'CaseExpired',
  'CaseAccepted',
  'StudyAccessed',
];

@Injectable()
export class AuditSubscriber implements OnModuleInit {
  constructor(
    private readonly bus: EventBus,
    private readonly audit: AuditService,
  ) {}

  onModuleInit(): void {
    for (const type of AUDITED_EVENTS) {
      // critical: an audit write that fails must surface, not be logged and
      // forgotten. An action that happened without a record of it having
      // happened is the exact failure this log exists to prevent.
      this.bus.subscribe(
        type,
        async (event) => {
          await this.audit.recordEvent(event);
        },
        { critical: true },
      );
    }
  }
}

export { AUDITED_EVENTS };
