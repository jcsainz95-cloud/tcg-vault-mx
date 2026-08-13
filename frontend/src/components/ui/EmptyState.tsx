import { PackageOpen } from 'lucide-react';

export interface EmptyStateProps {
  title: string;
  body?: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
  tone?: 'neutral' | 'positive';
}

/** Estado vacío (DESIGN_SYSTEM §8.1). */
export function EmptyState({ title, body, action, icon, tone = 'neutral' }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-surface p-10 text-center">
      <span className={tone === 'positive' ? 'text-success' : 'text-subtle'}>
        {icon ?? <PackageOpen size={40} />}
      </span>
      <h3 className="text-h3 font-semibold text-text">{title}</h3>
      {body && <p className="max-w-sm text-sm text-muted">{body}</p>}
      {action}
    </div>
  );
}
