'use client';

import { useT } from '../../lib/i18n/provider';
import { Button } from './index';

/** Previous / Next under a paged table, with "26–45 / 45". Renders nothing for one page. */
export function Pager({
  page,
  pages,
  from,
  to,
  total,
  onPage,
}: {
  page: number;
  pages: number;
  from: number;
  to: number;
  total: number;
  onPage: (page: number) => void;
}): React.JSX.Element | null {
  const t = useT();
  if (pages <= 1) return null;
  return (
    <nav
      aria-label={t.pagerLabel}
      className="flex flex-wrap items-center justify-between gap-3 pt-3 text-sm text-muted-foreground"
      data-testid="pager"
    >
      <span className="tabular-nums">
        <bdi>{`${from}–${to} / ${total}`}</bdi>
      </span>
      <div className="flex gap-2">
        <Button size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)} data-testid="pager-prev">
          {t.pagerPrev}
        </Button>
        <Button size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)} data-testid="pager-next">
          {t.pagerNext}
        </Button>
      </div>
    </nav>
  );
}
