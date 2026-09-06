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
 * completed upload or an confirmed booking. The EventBus logs and continues.
 */
@Injectable()
export class NotificationsSubscriber implements OnModuleInit {
  private readonly logger = new Logger(NotificationsSubscriber.name);

  constructor(private readonly bus: EventBus) {}

  onModuleInit(): void {
    this.bus.subscribe('StudyUploadCompleted', (event) => {
      this.queue('upload_complete', { fileCount: String(event.fileCount) });
    });

    this.bus.subscribe('AppointmentBooked', (event) => {
      // D2 says a PATIENT's booking is not yet confirmed when it is made — the
      // money is only held, and the message goes out on payment. That reasoning
      // is about the payment step, and an appointment the practice itself
      // enters has no payment step to wait for: it is confirmed the moment the
      // receptionist writes it down. So the caller's role decides.
      if (event.actorRole === 'patient') return;
      this.queue('booking_confirmed', {});
    });

    this.bus.subscribe('AppointmentReminderDue', () => {
      this.queue('appointment_reminder', {});
    });

    this.bus.subscribe('AppointmentRescheduled', () => {
      this.queue('appointment_moved', {});
    });

    this.bus.subscribe('AppointmentCancelled', () => {
      // Note what is NOT forwarded: the event's `reason`. It is free text a
      // receptionist typed, and this file's whole guarantee is that a
      // notification cannot carry something a template author never anticipated.
      this.queue('appointment_cancelled', {});
    });

    // Was subscribed to PaymentSucceeded, because capturing the patient's card
    // is what used to confirm a booking. The doctor's acceptance is what does
    // now, so the template is unchanged and only its trigger moved.
    this.bus.subscribe('AppointmentConfirmed', () => {
      this.queue('booking_confirmed', {});
    });

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
