import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'glass rounded-2xl border border-line/70',
        'shadow-[0_1px_2px_rgba(20,25,26,0.05),0_16px_40px_-24px_rgba(var(--shadow-tint),0.35)]',
        className
      )}
      {...props}
    />
  );
}

export function CardPad({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-5', className)} {...props} />;
}
