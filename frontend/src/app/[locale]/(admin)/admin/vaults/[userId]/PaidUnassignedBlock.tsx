'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { CardImage } from '@/components/ui/CardImage';
import { cn } from '@/lib/cn';
import { lineCardFacts, reasonKey, type PaidUnassignedLine } from '@/lib/api/vault-unassigned';

const TAG = 'font-mono text-[11px] uppercase tracking-[0.06em]';

/**
 * Dueño 2026-11-26: «Pagadas sin asignar (k)» en «Qué debe haber»: las cartas que el cliente PAGÓ y siguen «Requiere
 * atención» (sin copia igual) no son piezas a su nombre, así que ningún otro grupo las mostraba. Una fila por línea: foto,
 * nombre, set (nombre y clave), número, condición, folio original, pedido (enlace a su detalle) y motivo en frase llana.
 * Datos: `paidUnassigned` de la lectura física del cliente (ASSUMED; ver `PaidUnassignedLine`).
 */
export function PaidUnassignedBlock({ lines }: { lines: PaidUnassignedLine[] }) {
  const t = useTranslations('admin.vaults.physical.paidUnassigned');
  const tr = useTranslations('admin.m3.fulfillment');
  if (lines.length === 0) return null;
  return (
    <section aria-labelledby="paid-unassigned-block" data-testid="paid-unassigned-block" className="flex flex-col gap-3">
      <h3 id="paid-unassigned-block" className={cn(TAG, 'text-accent')}>
        {t('title', { count: lines.length })}
      </h3>
      <p className="text-sm text-muted">{t('help')}</p>
      <ul className="flex flex-col gap-3">
        {lines.map((l) => {
          const f = lineCardFacts({ card: l.card, folio: l.folio, imageUrl: l.imageUrl, finish: l.finish, setKey: (l.card as { setKey?: string } | null)?.setKey });
          return (
            <li key={l.orderItemId} className="flex items-start gap-3 border-l-2 border-l-accent pl-3 text-sm text-text" data-testid={`paid-unassigned-${l.orderItemId}`}>
              <CardImage src={f.imageUrl} alt="" className="w-12 shrink-0" />
              <span className="flex min-w-0 flex-col gap-1">
                <span lang="en" className="font-medium">{f.name ?? '—'}</span>
                <span className="font-mono text-xs text-muted">
                  {[f.setName ? (f.setCode ? `${f.setName} (${f.setCode})` : f.setName) : null, f.number ? `#${f.number}` : null, f.condition, f.finish, f.folio]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                <span className="text-xs text-accent">{tr('attention', { reason: tr(`reason.${reasonKey(l.reason)}`) })}</span>
                <Link
                  href={`/admin/m3/${l.orderId}`}
                  className="inline-flex min-h-[44px] items-center self-start text-xs text-text underline underline-offset-4 hover:text-accent focus-visible:shadow-focus focus-visible:outline-none"
                >
                  {t('order', { n: l.orderNumber ?? l.orderId })}
                </Link>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
