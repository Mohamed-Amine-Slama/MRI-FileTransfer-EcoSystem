import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { EventBus } from '../../../shared/events/event-bus';
import { render, type TemplateId } from './templates';

/**
 * Turns domain events into notifications — BUILD_SPEC PHASE 12.
 *
 * Note what is NOT passed to `render`: nothing from the event beyond counts
 * and identifiers. The events themselves carry no clinical detail (§5.2), so
 * there is nothing clinical available to leak even by accident.
 *
 * Subscribers here are NON-critical: a failed SMS must not roll back a
 * completed upload or an accepted case. The EventBus logs and continues.
 */
@Injectable()
export class NotificationsSubscriber implements OnModuleInit {
  private readonly logger = new Logger(NotificationsSubscriber.name);

  constructor(private readonly bus: EventBus) {}

  onModuleInit(): void {
    this.bus.subscribe('StudyUploadCompleted', (event) => {
      this.queue('upload_complete', { fileCount: String(event.fileCount) });
    });

    // Acceptance is what the lab is waiting for: the doctor has committed and
    // the imaging is now open to them.
    this.bus.subscribe('CaseAccepted', () => {
      this.queue('case_accepted', {});
    });

    // A refusal needs the lab to act — pick someone else — so it is a message,
    // not just a status change they might notice later.
    this.bus.subscribe('CaseDeclined', () => {
      this.queue('case_declined', {});
    });

    // Note what is NOT forwarded on a cancellation: the event's `reason`. It is
    // free text somebody typed, and this file's whole guarantee is that a
    // notification cannot carry something a template author never anticipated.
    // There is deliberately no template for it either — a cancellation the lab
    // itself performed needs no SMS telling them so.

    this.bus.subscribe('ConsentGranted', () => {
      this.queue('consent_request', {});
    });

    this.bus.subscribe('ConsentRevoked', () => {
      this.queue('consent_revoked', {});
    });
  }

  /**
   * Placeholder delivery. A real SMS/email provider is wired in when one is
   * chosen; rendering and the no-clinical-data guarantee are already enforced
   * and tested, which is the part that must not be got wrong later.
   */
  private queue(templateId: TemplateId, variables: Record<string, string>): void {
    const { body } = render(templateId, 'sms', 'ar', variables);
    this.logger.log(`notification queued: ${templateId} (${body.length} chars)`);
  }
}
