'use client';

import { useTranslations } from 'next-intl';
import { Construction } from 'lucide-react';

/** Placeholder de módulo pendiente (documentado como TODO en FRONTEND_NOTES). */
export function ModuleTodo({ moduleKey }: { moduleKey: string }) {
  const t = useTranslations('admin.modules');
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-h1 font-bold">{t(moduleKey)}</h1>
      <div className="flex items-center gap-3 rounded-lg border border-dashed border-border bg-surface p-6 text-muted">
        <Construction size={22} />
        <p className="text-sm">
          TODO — endpoints del contrato definidos; UI pendiente en esta iteración. Ver
          docs/FRONTEND_NOTES.md.
        </p>
      </div>
    </div>
  );
}
