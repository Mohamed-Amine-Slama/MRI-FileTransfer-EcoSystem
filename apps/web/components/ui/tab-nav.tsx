'use client';

import Link from './link';
import { usePathname } from 'next/navigation';
import { cn } from '../../lib/utils';

/**
 * Tabs that are routes.
 *
 * NOT a Radix tablist. Settings sections are worth linking to, bookmarking,
 * and landing on from an email — "open your notification settings" should be a
 * URL, not an instruction to click twice. Nested routes give that for free,
 * survive a reload, and need no JavaScript to switch.
 *
 * The trade is that these are links and announce as links, so the container is
 * a `<nav>` and not a `tablist`. That is the honest description of what they
 * are; borrowing tab semantics for things that navigate is what makes a screen
 * reader promise a panel change that is really a page load.
 */

export interface TabItem {
  href: string;
  label: string;
  testId?: string;
}

export function TabNav({
  items,
  label,
}: {
  items: readonly TabItem[];
  label: string;
}): React.JSX.Element {
  const pathname = usePathname();

  return (
    <nav aria-label={label} className="-mb-px overflow-x-auto">
      <ul className="flex min-w-max gap-1 border-b">
        {items.map((item) => {
          // Exact match: a settings index and its children are siblings here,
          // so a prefix match would light up two tabs at once.
          const current = pathname === item.href;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                data-testid={item.testId}
                aria-current={current ? 'page' : undefined}
                className={cn(
                  'inline-flex min-h-11 items-center whitespace-nowrap border-b-2 px-3 text-sm font-medium transition-colors',
                  current
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground',
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
