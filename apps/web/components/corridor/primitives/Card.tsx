import Link from '../../ui/link';
import type { ReactNode } from 'react';

export type CardVariant = 'lime' | 'teal' | 'glass' | 'image';

/**
 * The page's card — spec 2026-09-10 §6.
 *
 * Tall, 24px corners: an index and a light title at the top, a label and a
 * circular arrow at the foot. With `href` the WHOLE card is one link and the
 * arrow is its affordance; without it the card is an <article> and has no
 * arrow — an arrow that goes nowhere is a promise the page does not keep.
 */
export function Card({
  variant,
  title,
  titleAs = 'h3',
  titleId,
  index,
  label,
  href,
  testId,
  image,
  onPointerEnter,
  className = '',
  children,
}: {
  variant: CardVariant;
  title: string;
  titleAs?: 'h2' | 'h3';
  titleId?: string;
  /** A small ordinal above the title, e.g. "02". Decorative. */
  index?: string;
  label?: string;
  href?: string;
  testId?: string;
  /** The picture behind an `image` card. Ignored by the other variants. */
  image?: { src: string; width: number; height: number };
  onPointerEnter?: () => void;
  className?: string;
  children?: ReactNode;
}): React.JSX.Element {
  const Title = titleAs;
  const classes = `card card--${variant} ${className}`.trim();

  const inner = (
    <>
      {variant === 'image' && image !== undefined ? (
        <>
          <img
            className="card-image"
            src={image.src}
            alt=""
            width={image.width}
            height={image.height}
            loading="lazy"
            decoding="async"
          />
          <span className="card-scrim" aria-hidden="true" />
        </>
      ) : null}
      <div className="card-top">
        {index === undefined ? null : (
          <span className="card-index" aria-hidden="true">
            {index}
          </span>
        )}
        <Title id={titleId} className="card-title">
          {title}
        </Title>
      </div>
      {children === undefined ? null : <div className="card-body">{children}</div>}
      {label === undefined && href === undefined ? null : (
        <div className="card-foot">
          {label === undefined ? null : <span className="card-label">{label}</span>}
          {href === undefined ? null : <ArrowCircle />}
        </div>
      )}
    </>
  );

  if (href !== undefined) {
    return (
      <Link href={href} className={classes} data-testid={testId} onPointerEnter={onPointerEnter}>
        {inner}
      </Link>
    );
  }
  return (
    <article className={classes} data-testid={testId} onPointerEnter={onPointerEnter}>
      {inner}
    </article>
  );
}

/** The outlined circle with a diagonal arrow. Mirrored under RTL by CSS. */
export function ArrowCircle({ className = '' }: { className?: string }): React.JSX.Element {
  return (
    <span className={`arrow-circle ${className}`.trim()} aria-hidden="true">
      <svg viewBox="0 0 20 20" className="arrow-glyph" focusable="false">
        <path d="M5.5 14.5 14.5 5.5M7.5 5.5h7v7" />
      </svg>
    </span>
  );
}
