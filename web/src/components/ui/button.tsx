import { type ButtonHTMLAttributes, forwardRef } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 rounded-md font-semibold whitespace-nowrap transition-colors active:translate-y-px disabled:opacity-45 disabled:cursor-not-allowed',
  {
    variants: {
      variant: {
        primary: 'bg-accent text-white hover:bg-accent-strong',
        secondary: 'bg-surface text-ink border border-line hover:bg-surface-2',
        ghost: 'bg-transparent text-muted hover:bg-surface-2 hover:text-ink',
        danger: 'bg-surface text-bad border border-bad hover:bg-bad-soft',
      },
      size: {
        default: 'h-[38px] px-4 text-[13.5px]',
        sm: 'h-8 px-3 text-[12.5px]',
      },
      block: {
        true: 'w-full',
      },
    },
    defaultVariants: { variant: 'primary', size: 'default' },
  }
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, block, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size, block }), className)} {...props} />
  )
);
Button.displayName = 'Button';
