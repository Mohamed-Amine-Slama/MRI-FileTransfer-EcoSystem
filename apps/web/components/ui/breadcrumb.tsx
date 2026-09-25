'use client';

import Link from './link';
import { ChevronRight } from 'lucide-react';
import { Fragment } from 'react';
import { useT } from '../../lib/i18n/provider';

export interface Crumb {
  label: string;
  /** Omit on the final, current-page crumb. */
  href?: string;
}

/**
 * Breadcrumb trail for nested pages. Driven by explicit per-page props —
 * no route parsing. The chevron separator rotates under RTL so it always
 * points "deeper".
 */
export function Breadcrumbs({ items }: { items: Crumb[] }): React.JSX.Element {
  const t = useT();
  return (
    <nav aria-label={t.breadcrumbLabel} className="mb-4">
      <ol className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
        {items.map((item, i) => (
          <Fragment key={`${item.label}-${i}`}>
            {i > 0 && (
              <li aria-hidden="true" className="flex items-center">
                <ChevronRight className="size-3.5 rtl:rotate-180" />
              </li>
            )}
            <li className="flex items-center">
              {item.href !== undefined ? (
                <Link href={item.href} className="rounded-sm transition-colors hover:text-foreground">
                  {item.label}
                </Link>
              ) : (
                <span aria-current="page" className="font-medium text-foreground">
                  {item.label}
                </span>
              )}
            </li>
          </Fragment>
        ))}
      </ol>
    </nav>
  );
}
