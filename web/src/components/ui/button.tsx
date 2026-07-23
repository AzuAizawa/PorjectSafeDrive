import { type ButtonHTMLAttributes, forwardRef } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 rounded-xl font-semibold whitespace-nowrap active:scale-[0.97] disabled:opacity-45 disabled:cursor-not-allowed disabled:active:scale-100',
  {
    variants: {
      variant: {
        primary:
          'btn-gradient-accent text-white shadow-[0_1px_1px_rgba(0,0,0,0.08),0_10px_26px_-10px_rgba(var(--glow-tint),0.65)] hover:shadow-[0_1px_1px_rgba(0,0,0,0.08),0_16px_36px_-10px_rgba(var(--glow-tint),0.8)] hover:brightness-[1.06] hover:-translate-y-px',
        secondary: 'bg-surface/90 text-ink border border-line hover:bg-surface-2 hover:-translate-y-px',
        ghost: 'bg-transparent text-muted hover:bg-surface-2 hover:text-ink',
        danger: 'bg-surface/90 text-bad border border-bad hover:bg-bad-soft',
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
