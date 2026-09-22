import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from 'react';
import { Check, CircleAlert, CircleCheck, Info, Loader2, TriangleAlert } from 'lucide-react';
import { cn } from '../../lib/utils';
import { BaseButton } from './button';
import { CardContent, CardHeader, CardRoot, CardTitle } from './card';

/**
 * Shared UI primitives.
 *
 * The component API is deliberately the one the pages already speak —
 * `variant="primary"`, `tone="warning"`, `testId` — reimplemented on the
 * Tailwind design system, so a page conversion is a markup change and never
 * an API hunt. Every visual decision is a token from globals.css; RTL safety
 * comes from logical utilities only, enforced by lint (D4).
 */

type Tone = 'info' | 'warning' | 'danger' | 'success';

// Re-exports: pages and new screens compose these directly.
export { buttonVariants } from './button';
export { CardContent, CardDescription, CardHeader, CardRoot, CardTitle } from './card';
export { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './table';
export { Skeleton } from './skeleton';
export { Progress } from './progress';
export { Breadcrumbs, type Crumb } from './breadcrumb';
export {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './dropdown-menu';
export { Sheet, SheetClose, SheetContent, SheetTrigger } from './sheet';
export { OtpInput, OTP_LENGTH } from './otp-input';
export { Switch } from './switch';
export { Segmented, type SegmentedOption } from './segmented';
export { Avatar, initialsOf } from './avatar';
export { Separator } from './separator';
export { Meter } from './meter';
export { StatTile, StatGrid, SectionHeading } from './stat';
export { TabNav, type TabItem } from './tab-nav';
export { Dropzone } from './dropzone';

// ---------------------------------------------------------------------------

export function Button({
  variant = 'default',
  size,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  /**
   * `secondary` is the landing page's lime: the positive alternative BESIDE a
   * `primary`, never on its own and never on a refusal. Decline, Cancel and
   * Reject stay `default` or `danger` — lime is the most eye-catching colour
   * on the screen, and it must not pull the eye towards the wrong answer.
   */
  variant?: 'default' | 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm';
}): React.JSX.Element {
  const mapped =
    variant === 'primary'
      ? 'default'
      : variant === 'secondary'
        ? 'highlight'
        : variant === 'danger'
          ? 'destructive'
          : variant === 'ghost'
            ? 'ghost'
            : 'outline';
  // type defaults to "submit" inside a form, which turns an unrelated button
  // into an accidental submit. Callers opt in to submitting explicitly.
  return (
    <BaseButton
      type="button"
      variant={mapped}
      size={size ?? 'default'}
      className={className}
      {...rest}
    />
  );
}

// ---------------------------------------------------------------------------

export function Card({
  title,
  children,
  actions,
  className,
}: {
  title?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <CardRoot className={className}>
      {(title !== undefined || actions !== undefined) && (
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
          {title !== undefined && <CardTitle>{title}</CardTitle>}
          {actions}
        </CardHeader>
      )}
      <CardContent className="space-y-3">{children}</CardContent>
    </CardRoot>
  );
}

// ---------------------------------------------------------------------------

/**
 * A labelled control.
 *
 * The label WRAPS the input rather than using htmlFor/id. Generated ids are a
 * recurring source of hydration mismatches in Next, and a wrapping label is
 * associated natively with no id at all.
 */
export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold">{label}</span>
      {children}
      {hint !== undefined && error == null && (
        <span className="mt-1.5 block text-sm text-muted-foreground">{hint}</span>
      )}
      {error != null && (
        <span className="mt-1.5 block text-sm font-medium text-danger" role="alert">
          {error}
        </span>
      )}
    </label>
  );
}

const controlClasses =
  'block h-10 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground shadow-sm transition-colors placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-55';

export function Input({
  invalid,
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }): React.JSX.Element {
  return (
    <input
      {...rest}
      className={cn(controlClasses, invalid === true && 'border-danger', className)}
      aria-invalid={invalid === true ? 'true' : undefined}
    />
  );
}

export function Select({
  children,
  className,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>): React.JSX.Element {
  // Native select, on purpose: it works on old clinic browsers, costs no
  // JavaScript, and Playwright's selectOption keeps working.
  return (
    <select {...rest} className={cn(controlClasses, className)}>
      {children}
    </select>
  );
}

// ---------------------------------------------------------------------------

const alertTones: Record<Tone, { classes: string; Icon: typeof Info }> = {
  info: { classes: 'bg-info-surface text-info', Icon: Info },
  warning: { classes: 'bg-warning-surface text-warning', Icon: TriangleAlert },
  danger: { classes: 'bg-danger-surface text-danger', Icon: CircleAlert },
  success: { classes: 'bg-success-surface text-success', Icon: CircleCheck },
};

export function Alert({
  tone = 'info',
  children,
  testId,
}: {
  tone?: Tone;
  children: ReactNode;
  testId?: string;
}): React.JSX.Element {
  const { classes, Icon } = alertTones[tone];
  return (
    <div
      // Logical border, so the accent bar sits on the correct side under RTL.
      className={cn('flex gap-2.5 rounded-md border-s-4 border-current px-4 py-3 text-sm', classes)}
      data-testid={testId}
      // Errors must be announced; informational text must not interrupt.
      role={tone === 'danger' ? 'alert' : undefined}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 [overflow-wrap:anywhere]">{children}</div>
    </div>
  );
}

const badgeTones: Record<Tone, string> = {
  info: 'bg-info-surface text-info',
  warning: 'bg-warning-surface text-warning',
  danger: 'bg-danger-surface text-danger',
  success: 'bg-success-surface text-success',
};

export function Badge({
  tone,
  children,
  testId,
}: {
  tone?: Tone;
  children: ReactNode;
  testId?: string;
}): React.JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold',
        tone === undefined ? 'border bg-muted text-muted-foreground' : badgeTones[tone],
      )}
      data-testid={testId}
    >
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------

export function Spinner({ label }: { label: string }): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-2" role="status">
      <Loader2 className="size-4 animate-spin text-primary" aria-hidden="true" />
      <span className="text-sm text-muted-foreground">{label}</span>
    </span>
  );
}

export function EmptyState({
  children,
  testId,
}: {
  children: ReactNode;
  testId?: string;
}): React.JSX.Element {
  return (
    <div
      className="rounded-lg border border-dashed px-4 py-10 text-center text-sm text-muted-foreground"
      data-testid={testId}
    >
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}): React.JSX.Element {
  return (
    <header className="mb-6 space-y-1">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-normal tracking-tight">{title}</h1>
        {actions !== undefined && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {description !== undefined && <p className="text-sm text-muted-foreground">{description}</p>}
    </header>
  );
}


// ---------------------------------------------------------------------------

/**
 * Page container. Prose-shaped pages keep a reading-width cap; worklists and
 * the viewer opt into the full width with `wide`, so there is one place that
 * knows the measure.
 */
export function Main({
  wide = false,
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLElement> & { wide?: boolean }): React.JSX.Element {
  return (
    <main
      className={cn(
        'mx-auto w-full space-y-4 px-4 py-6 sm:px-6',
        wide ? 'max-w-7xl' : 'max-w-3xl',
        className,
      )}
      {...rest}
    >
      {children}
    </main>
  );
}

/** Progress indicator for the multi-step booking flow. */
export function Steps({
  steps,
  current,
}: {
  steps: string[];
  current: number;
}): React.JSX.Element {
  return (
    <ol className="flex flex-wrap items-center gap-2 text-sm" data-testid="steps">
      {steps.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li
            key={label}
            className="flex items-center gap-2"
            data-done={done ? 'true' : 'false'}
            aria-current={active ? 'step' : undefined}
          >
            {i > 0 && <span aria-hidden="true" className="block h-px w-4 bg-border" />}
            <span
              aria-hidden="true"
              className={cn(
                'flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                done && 'bg-success-surface text-success',
                active && 'bg-primary text-primary-foreground',
                !done && !active && 'border bg-card text-muted-foreground',
              )}
            >
              {done ? <Check className="size-3.5" /> : i + 1}
            </span>
            <span
              className={cn(
                done && 'text-success',
                active && 'font-semibold text-foreground',
                !done && !active && 'text-muted-foreground',
              )}
            >
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
