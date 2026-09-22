import type { ButtonHTMLAttributes } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

/**
 * Base button. Pages use the compatibility `Button` in index.tsx; this file
 * also exports `buttonVariants` so links can be styled as buttons without
 * nesting an anchor in a button.
 */
export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-55 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90',
        // The landing page's lime, as its `.btn--secondary`: the positive
        // alternative beside a teal primary. The border keeps it from
        // dissolving into a white card; hover deepens to the edge tone rather
        // than going translucent, because lime thinned over mint turns muddy.
        highlight:
          'border border-highlight-edge bg-highlight text-highlight-foreground shadow-sm hover:bg-highlight-edge',
        outline:
          'border border-input bg-card text-foreground shadow-sm hover:border-primary hover:text-primary',
        destructive: 'border border-danger/40 bg-danger-surface text-danger hover:border-danger',
        ghost: 'hover:bg-muted',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-8 rounded-sm px-3',
        lg: 'h-11 px-6',
        icon: 'size-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface BaseButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function BaseButton({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: BaseButtonProps): React.JSX.Element {
  const Comp = asChild ? Slot : 'button';
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
