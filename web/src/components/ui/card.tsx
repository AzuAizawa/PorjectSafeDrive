import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'glass rounded-2xl border border-line/70',
        'shadow-[0_1px_2px_rgba(20,25,26,0.06),0_20px_48px_-22px_rgba(var(--glow-tint),0.4)]',
        className
      )}
      {...props}
    />
  );
}

export function CardPad({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-5', className)} {...props} />;
}
