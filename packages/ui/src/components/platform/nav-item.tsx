import { cva } from 'class-variance-authority'

/** A navigation entry: at least 44px tall, equal width in the bottom bar, full width in the side rail. */
export const navItemVariants = cva(
  'flex min-h-11 flex-1 items-center justify-center gap-2 px-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring lg:flex-none lg:justify-start lg:rounded-md',
  {
    variants: {
      active: {
        true: 'text-primary lg:bg-accent lg:text-accent-foreground',
        false: 'text-muted-foreground hover:text-foreground lg:hover:bg-accent/50',
      },
    },
    defaultVariants: { active: false },
  },
)
