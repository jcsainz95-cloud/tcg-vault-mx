import { cn } from '@/lib/cn';

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse bg-surface-2', className)} aria-hidden />;
}

export function CardSkeleton() {
  return (
    // Dirección 5a: el esqueleto imita la pieza sin caja — pozo del arte y reglas de texto.
    <div className="flex flex-col gap-3">
      <Skeleton className="aspect-[5/7] w-full" />
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-3 w-1/2" />
      <Skeleton className="h-11 w-full" />
    </div>
  );
}
