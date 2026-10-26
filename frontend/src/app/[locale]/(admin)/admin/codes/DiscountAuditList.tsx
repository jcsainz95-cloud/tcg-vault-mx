'use client';

import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { getDiscountAudit } from '@/lib/api';
import { QueryState } from '@/components/ui/QueryState';
import { formatDateTimeMx, formatMoneyCents } from '@/lib/format';
import type { AppLocale } from '@/i18n/routing';
import { DISCOUNT_AUDIT_ACTIONS } from '@/types/contract';

/**
 * Rótulo de una `action` de la bitácora (§DSC.7 v1.110.2, lista cerrada): `discount.code.created` ⇒
 * `audit.action.code.created`. Un valor fuera de la lista ⇒ el texto genérico, ⛔ nunca la cadena cruda.
 */
export function discountAuditActionKey(action: string): string {
  return (DISCOUNT_AUDIT_ACTIONS as readonly string[]).includes(action) ? `audit.action.${action.slice('discount.'.length)}` : 'audit.action.unknown';
}

export const discountAuditQueryKey = (kind: 'code' | 'batch', id: string) => ['admin-discount-audit', kind, id] as const;

/**
 * «Cambios» de un código o de un lote (DESIGN_SYSTEM §DSC-UX.5 «Auditoría visible a un costado: fecha · quién · antes →
 * después»; contrato §DSC.7 v1.110.2 `GET …/:id/audit`; `actor: null` ⇒ «Sistema»). El diff va en mono, una línea por campo (§21.5c), nunca un JSON.
 * Los valores se FORMATEAN (pesos para `…Cents`, fecha para `…At`), no se calculan.
 */
export function DiscountAuditList({ kind, id }: { kind: 'code' | 'batch'; id: string }) {
  const t = useTranslations('admin.discounts');
  const locale = useLocale() as AppLocale;
  const audit = useQuery({ queryKey: discountAuditQueryKey(kind, id), queryFn: () => getDiscountAudit({ kind, id }) });

  const value = (field: string, v: unknown): string => {
    if (v === null || v === undefined) return t('audit.none');
    if (Array.isArray(v)) return v.length ? v.join(', ') : '[]';
    if (typeof v === 'number' && field.endsWith('Cents')) return formatMoneyCents(v, locale);
    if (typeof v === 'string' && field.endsWith('At')) return formatDateTimeMx(v, locale) || v;
    return String(v);
  };

  return (
    <section aria-labelledby={`dsc-audit-${kind}`} data-testid="discount-audit" className="border border-border p-5">
      <h2 id={`dsc-audit-${kind}`} className="eyebrow text-text">
        {t('audit.title')}
      </h2>
      <div className="mt-3">
        <QueryState isLoading={audit.isLoading} isError={audit.isError} error={audit.error} onRetry={() => audit.refetch()}>
          {audit.data &&
            (audit.data.data.length === 0 ? (
              <p className="text-sm text-muted">{t('audit.empty')}</p>
            ) : (
              <ol className="grid gap-4">
                {audit.data.data.map((e, i) => (
                  <li key={`${e.at}-${i}`} data-testid="discount-audit-entry" className="min-w-0">
                    <p className="text-xs text-muted">
                      {t('audit.meta', { at: formatDateTimeMx(e.at, locale), name: e.actor === null ? t('audit.system') : e.actor.name || t('audit.none') })} ·{' '}
                      <span className="text-text">{t(discountAuditActionKey(e.action))}</span>
                    </p>
                    <ul className="mt-1 grid gap-0.5 font-mono text-[11px] text-text [overflow-wrap:anywhere]">
                      {e.changes.map((c) => (
                        <li key={c.field}>
                          {c.field} · {value(c.field, c.before)} → {value(c.field, c.after)}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ol>
            ))}
        </QueryState>
      </div>
    </section>
  );
}
