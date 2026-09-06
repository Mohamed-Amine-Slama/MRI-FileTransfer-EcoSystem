'use client';

import type { Appointment } from '../lib/api/endpoints';
import { useT } from '../lib/i18n/provider';
import { Badge } from './ui';

/**
 * Appointment status, translated and colour-coded.
 *
 * The distinction that matters to the referring clinic is between `declined`
 * and `cancelled`: a refusal means send the case elsewhere, a cancellation is
 * their own withdrawal. Rendering both as a generic "not happening" would hide
 * the one fact that decides what they do next.
 *
 * The vocabulary used to be DECISION D2's, where the interesting split was
 * `authorised` vs `confirmed` — money held, not taken. Migration 0023 removed
 * both states with the card.
 *
 * `no_show` is red and `completed` is green because they are not two shades of
 * "done": one of them is the visit that happened and the other is the slot the
 * practice lost.
 */
export function AppointmentStatusBadge({
  status,
}: {
  status: Appointment['status'];
}): React.JSX.Element {
  const t = useT();

  const map: Record<Appointment['status'], { tone: 'info' | 'warning' | 'success' | 'danger'; label: string }> = {
    pending: { tone: 'warning', label: t.statusPending },
    confirmed: { tone: 'success', label: t.statusConfirmed },
    declined: { tone: 'danger', label: t.statusDeclined },
    cancelled: { tone: 'danger', label: t.statusCancelled },
    completed: { tone: 'success', label: t.statusCompleted },
    no_show: { tone: 'danger', label: t.statusNoShow },
  };

  const { tone, label } = map[status];
  return (
    <Badge tone={tone} testId="appointment-status">
      {label}
    </Badge>
  );
}
