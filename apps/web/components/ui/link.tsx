import NextLink from 'next/link';
import type { ComponentProps } from 'react';

/**
 * next/link with prefetch OFF by default.
 *
 * Next prefetches every link that scrolls into view — an RSC payload plus the
 * target page's JS chunk each. /login alone fired ten such requests for pages
 * nobody opened. Navigation now fetches on click; pass `prefetch` explicitly
 * where a link is almost always followed. Lint bans importing next/link
 * anywhere else, so new links inherit this.
 */
export default function Link(props: ComponentProps<typeof NextLink>): React.JSX.Element {
  return <NextLink prefetch={false} {...props} />;
}
