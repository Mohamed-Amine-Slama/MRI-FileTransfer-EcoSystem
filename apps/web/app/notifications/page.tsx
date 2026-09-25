'use client';

import Link from '../../components/ui/link';
import { useCallback, useEffect, useState } from 'react';
import { BellRing, FileUp, MessageSquare, RefreshCw } from 'lucide-react';
import { unreadCount, type Notification, type NotificationKind } from '@mir/contracts';
import { casesApi } from '../../lib/api/mock';
import { rolesForSides } from '../../lib/corridor/registry';
import { useCaseAudience } from '../../lib/provider/current-provider';
import type { Dictionary } from '../../lib/i18n/dictionary';
import { useDateFormat, useT } from '../../lib/i18n/provider';
import { RoleGate } from '../../components/RoleGate';
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  Main,
  PageHeader,
  Spinner,
} from '../../components/ui';

/**
 * The notification centre — brief §5.6.
 *
 * §5.6 P0 names exactly three triggers, and the contract's `NotificationKind`
 * is that list. Both maps below are exhaustive `Record`s, so adding a fourth
 * trigger is a compile error here rather than a row that renders a blank icon
 * and an enum value.
 *
 * Every notification is about a case, so every row links to one. A notification
 * that cannot be acted on is just noise.
 */
const NOTIFICATION_ROLES = rolesForSides(['source', 'destination', 'ops']);

export default function NotificationsPage(): React.JSX.Element {
  return (
    <RoleGate allow={NOTIFICATION_ROLES}>
      {casesApi.supports.notifications ? <NotificationCentre /> : <ByEmailOnly />}
    </RoleGate>
  );
}

/**
 * In-app notifications have no backend yet (spec 2026-09-21 D7). Rather than
 * render an inbox that is always empty — which reads as "nothing happened" —
 * the page says where notifications actually go.
 */
function ByEmailOnly(): React.JSX.Element {
  const t = useT();
  return (
    <Main>
      <PageHeader title={t.notificationsTitle} />
      <Alert tone="info" testId="notifications-by-email">
        {t.notificationsByEmail}
      </Alert>
    </Main>
  );
}

function notificationIcon(kind: NotificationKind): typeof BellRing {
  const icons: Record<NotificationKind, typeof BellRing> = {
    case_status_changed: RefreshCw,
    message_received: MessageSquare,
    file_added: FileUp,
  };
  return icons[kind];
}

/**
 * The title is a dictionary KEY on the wire (contract: `titleKey`), so the
 * server never ships translated copy and a locale switch re-renders correctly.
 */
function notificationTitle(t: Dictionary, notification: Notification): string {
  const titles: Record<NotificationKind, string> = {
    case_status_changed: t.notifCaseStatusChanged,
    message_received: t.notifMessageReceived,
    file_added: t.notifFileAdded,
  };
  return titles[notification.kind];
}

function NotificationCentre(): React.JSX.Element {
  const t = useT();
  const formatDate = useDateFormat();
  const { audience, loading: audienceLoading } = useCaseAudience();
  const [items, setItems] = useState<Notification[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (audience === null) return;
    try {
      setItems(await casesApi.listNotifications(audience));
    } catch {
      setError(t.genericError);
      setItems([]);
    }
  }, [t, audience]);

  useEffect(() => {
    if (audienceLoading) return;
    void load();
  }, [load, audienceLoading]);

  const markRead = async (id: string): Promise<void> => {
    // Optimistic: the row is already on screen and the write cannot conflict
    // with anything. A reload reconciles if it failed.
    setItems((prev) =>
      prev === null
        ? prev
        : prev.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)),
    );
    try {
      await casesApi.markNotificationRead(id);
    } catch {
      setError(t.genericError);
      await load();
    }
  };

  if (items === null) {
    return (
      <Main>
        <Spinner label={t.loading} />
      </Main>
    );
  }

  const unread = unreadCount(items);

  return (
    <Main>
      <PageHeader
        title={t.notificationsTitle}
        actions={
          unread > 0 ? (
            <Badge tone="info" testId="unread-count">
              {t.notificationsUnread} · {unread}
            </Badge>
          ) : undefined
        }
      />

      {error !== null && <Alert tone="danger">{error}</Alert>}

      {items.length === 0 ? (
        <EmptyState testId="notifications-empty">{t.notificationsEmpty}</EmptyState>
      ) : (
        <ul className="space-y-2" data-testid="notification-list">
          {items.map((notification) => {
            const Icon = notificationIcon(notification.kind);
            const isUnread = notification.readAt === undefined;
            return (
              <li
                key={notification.id}
                data-unread={isUnread ? 'true' : 'false'}
                className={
                  // Unread is carried by a logical border and weight, not by
                  // colour alone — the distinction has to survive a greyscale
                  // clinic monitor.
                  isUnread
                    ? 'flex items-start gap-3 rounded-md border border-s-4 border-s-primary bg-card p-3'
                    : 'flex items-start gap-3 rounded-md border bg-card p-3 opacity-75'
                }
              >
                <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className={isUnread ? 'text-sm font-semibold' : 'text-sm'}>
                    {notificationTitle(t, notification)}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    <Link href={`/cases/${notification.caseRef}`} className="hover:underline">
                      <bdi className="font-mono">{notification.caseRef}</bdi>
                    </Link>{' '}
                    · {formatDate(notification.occurredAt)}
                  </p>
                </div>
                {isUnread && (
                  <Button
                    size="sm"
                    variant="ghost"
                    data-testid={`mark-read-${notification.id}`}
                    onClick={() => void markRead(notification.id)}
                  >
                    {t.notificationsMarkRead}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Main>
  );
}
