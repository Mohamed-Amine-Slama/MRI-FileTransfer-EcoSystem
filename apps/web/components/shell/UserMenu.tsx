'use client';

import Link from '../ui/link';
import { ChevronDown, LogOut, Settings, UserRound } from 'lucide-react';
import { useT } from '../../lib/i18n/provider';
import { useSession } from '../../lib/session/session';
import { roleLabel } from '../case/labels';
import {
  Avatar,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  buttonVariants,
} from '../ui';

/**
 * Who is signed in, and the two things they do about it.
 *
 * The role is shown under the name because this application's authorisation is
 * role-shaped and invisible otherwise: a receiving-side doctor who cannot see
 * the patient index needs to know that is their account and not a fault. It is
 * rendered through `roleLabel`, which names the corridor SIDE rather than the
 * role (§4.3).
 */
export function UserMenu(): React.JSX.Element {
  const t = useT();
  const { status, user, role, signOut } = useSession();

  if (status !== 'authenticated' || user === null || role === null) {
    return (
      <Link
        href="/login"
        className={buttonVariants({ variant: 'default', size: 'sm' })}
        data-testid="sign-in-link"
      >
        {t.navSignIn}
      </Link>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        data-testid="current-user"
        className="flex h-9 items-center gap-2 rounded-md border border-input bg-card px-2 text-sm shadow-sm transition-colors hover:border-primary"
      >
        <Avatar name={user.displayName} size="sm" />
        {/* The name is redundant on a phone, where the avatar is enough to say
            "you are signed in" and the menu carries the detail. */}
        <span className="hidden max-w-32 truncate sm:inline">{user.displayName}</span>
        <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden="true" />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuLabel className="py-2">
          <span className="block truncate text-sm font-semibold text-foreground">
            {user.displayName}
          </span>
          <span className="block truncate">{roleLabel(t, role)}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        <DropdownMenuItem asChild>
          <Link href="/profile" data-testid="menu-profile">
            <UserRound aria-hidden="true" />
            {t.navProfile}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings" data-testid="menu-settings">
            <Settings aria-hidden="true" />
            {t.navSettings}
          </Link>
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuItem data-testid="sign-out" onSelect={() => void signOut()}>
          <LogOut aria-hidden="true" />
          {t.navSignOut}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
