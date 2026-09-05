import {
  Banknote,
  Bell,
  Briefcase,
  Building2,
  CalendarClock,
  CalendarDays,
  FolderKanban,
  Inbox,
  ScrollText,
  Upload,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { Role } from '@mir/contracts';
import { DESTINATION_ROLES, PROVIDER_ROLES, SOURCE_ROLES, rolesForSides } from '../../lib/corridor/registry';
import type { Dictionary } from '../../lib/i18n/dictionary';

/**
 * The application's navigation, as data.
 *
 * TWO RULES HOLD THIS FILE TOGETHER.
 *
 * 1. **Gating is by corridor SIDE, never by role name (§4.3).** The version
 *    this replaced named the referring side's role literally for the patient
 *    index and the upload screen. Both are really "whoever refers", and saying
 *    so is what lets a second corridor be a config entry instead of an edit
 *    here. Only `patient`, `admin`, and `applicant` appear literally, because
 *    none of them is a corridor endpoint — a patient is not a party to a
 *    referral, and an applicant has not been granted a side yet.
 *
 *    `assistant` is named literally for the same reason as those three: an
 *    assistant is seated in a practice rather than playing a side of a
 *    corridor, so `rolesForSides` has nothing to say about them.
 *
 *    This is also why `components/AppShell.tsx` could be removed from the
 *    ratcheting allowlist in `lib/corridor/no-hardcoded-corridor.test.ts`.
 *
 * 2. **Labels are dictionary KEYS, not strings.** The module then needs no
 *    `t`, so it stays a plain data table that a test can read.
 *
 * Filtering by role here is a USABILITY decision and nothing more. The API
 * refuses the route and row-level security refuses the rows regardless of what
 * is rendered (§4.4) — hiding a link protects nothing on its own.
 */

export interface NavItem {
  href: string;
  labelKey: keyof Dictionary;
  /** Used as the sidebar's secondary line and the dashboard card's blurb. */
  descriptionKey: keyof Dictionary;
  roles: readonly Role[];
  Icon: LucideIcon;
}

export interface NavSection {
  /** Absent for the primary group, which needs no heading above the first item. */
  headingKey?: keyof Dictionary;
  items: readonly NavItem[];
}

const OPS_ROLES = rolesForSides(['ops']);
const NOTIFIED_ROLES = rolesForSides(['source', 'destination', 'ops']);

/**
 * Sections, not one flat list.
 *
 * There are fourteen destinations. A single row of them overflowed the header
 * at desktop width and read as an undifferentiated wall in the mobile drawer;
 * grouping them by what the person is doing — casework, money, administration —
 * is what makes the sidebar scannable at a glance.
 */
export const NAV_SECTIONS: readonly NavSection[] = [
  {
    items: [
      {
        href: '/workspace',
        labelKey: 'navWorkspace',
        descriptionKey: 'workspaceDescription',
        roles: PROVIDER_ROLES,
        Icon: Briefcase,
      },
      {
        href: '/cases',
        labelKey: 'navCases',
        descriptionKey: 'casesDescription',
        roles: PROVIDER_ROLES,
        Icon: FolderKanban,
      },
      {
        href: '/doctor',
        labelKey: 'navInbox',
        descriptionKey: 'inboxTitle',
        roles: DESTINATION_ROLES,
        Icon: Inbox,
      },
      {
        href: '/patients',
        labelKey: 'navPatients',
        descriptionKey: 'patientsDescription',
        roles: SOURCE_ROLES,
        Icon: Users,
      },
      {
        href: '/upload',
        labelKey: 'navUpload',
        descriptionKey: 'uploadHint',
        roles: SOURCE_ROLES,
        Icon: Upload,
      },
      {
        href: '/appointments',
        labelKey: 'navAppointments',
        descriptionKey: 'bookingTitle',
        roles: SOURCE_ROLES,
        Icon: CalendarDays,
      },
      {
        // Replaces the bare /doctor/availability form. Both corridor sides run
        // a diary, and a seated assistant runs it on the doctor's behalf.
        href: '/schedule',
        labelKey: 'navSchedule',
        descriptionKey: 'scheduleDescription',
        roles: [...PROVIDER_ROLES, 'assistant'],
        Icon: CalendarClock,
      },
      {
        href: '/notifications',
        labelKey: 'navNotifications',
        descriptionKey: 'notificationsDescription',
        roles: NOTIFIED_ROLES,
        Icon: Bell,
      },
    ],
  },
  {
    headingKey: 'navSectionBilling',
    items: [
      {
        href: '/ledger',
        labelKey: 'navLedger',
        descriptionKey: 'ledgerDescription',
        roles: PROVIDER_ROLES,
        Icon: Banknote,
      },
    ],
  },
  {
    headingKey: 'navSectionAdmin',
    items: [
      {
        href: '/admin/cases',
        labelKey: 'navAdminCases',
        descriptionKey: 'adminCasesDescription',
        roles: OPS_ROLES,
        Icon: FolderKanban,
      },
      {
        href: '/admin/providers',
        labelKey: 'navAdminProviders',
        descriptionKey: 'adminProvidersDescription',
        roles: OPS_ROLES,
        Icon: Building2,
      },
      {
        href: '/admin/ledger',
        labelKey: 'navAdminLedger',
        descriptionKey: 'adminLedgerDescription',
        roles: OPS_ROLES,
        Icon: Banknote,
      },
      {
        href: '/admin/audit',
        labelKey: 'navAudit',
        descriptionKey: 'auditDescription',
        roles: ['admin'],
        Icon: ScrollText,
      },
    ],
  },
];

/** The sections a role can see, with empty ones dropped so no heading floats alone. */
export function sectionsForRole(role: Role | null): NavSection[] {
  if (role === null) return [];
  return NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => item.roles.includes(role)),
  })).filter((section) => section.items.length > 0);
}

export function navItemsForRole(role: Role | null): NavItem[] {
  return sectionsForRole(role).flatMap((section) => section.items);
}
