'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { previewDiscountCode } from '@/lib/api';
import { QueryState } from '@/components/ui/QueryState';
import { formatMoneyCents } from '@/lib/format';
import type { AppLocale } from '@/i18n/routing';
import type { DiscountPreviewRequest } from '@/types/contract';
import type { ConfigBody } from './discount-config';

/**
 * Carrito de ejemplo de «Así lo verá el cliente» (1..5 líneas, §DSC.7 `sampleLines`): una carta suelta, un sellado y
 * dos accesorios, para que los filtros por tipo y el reparto se vean. Precios exhibidos con IVA.
 */
export const PREVIEW_SAMPLE_LINES: DiscountPreviewRequest['sampleLines'] = [
  { scope: 'raw', priceCents: 120000, quantity: 1 },
  { scope: 'sealed', priceCents: 250000, quantity: 1 },
  { scope: 'accessory', priceCents: 15000, quantity: 2 },
];

/** Espera tras la última tecla antes de pedir la vista previa (no un `POST` por carácter). */
export const PREVIEW_DEBOUNCE_MS = 300;

/**
 * «Así lo verá el cliente» (DESIGN_SYSTEM §DSC-UX.5; contrato §DSC.7 v1.110.1 `POST /admin/discount-codes/preview`).
 * ⛔ Ninguna cuenta aquí: el descuento, el nominal y si llegó al tope los devuelve el servidor (`discountOf`/
 * `allocateDiscount`); el front pinta las líneas de ejemplo tal cual y la cifra que llega.
 * `config` = el cuerpo ya válido del formulario (`toConfig`); sin él, se pide completar.
 */
export function DiscountPreview({ config }: { config: ConfigBody | undefined }) {
  const t = useTranslations('admin.discounts');
  const locale = useLocale() as AppLocale;
  const money = (c: number) => formatMoneyCents(c, locale);
  const [debounced, setDebounced] = useState<ConfigBody | undefined>(config);
  const key = JSON.stringify(config ?? null);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(config), PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // `key` resume `config` (objeto nuevo en cada render del formulario).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const preview = useQuery({
    queryKey: ['admin-discount-preview', JSON.stringify(debounced ?? null)],
    queryFn: () => previewDiscountCode({ ...debounced!, sampleLines: PREVIEW_SAMPLE_LINES }),
    enabled: !!debounced,
  });

  return (
    <section aria-labelledby="dsc-preview-title" data-testid="discount-preview" className="border border-border p-5">
      <h2 id="dsc-preview-title" className="eyebrow text-text">
        {t('preview.title')}
      </h2>
      <p className="mt-1 text-xs text-muted">{t('preview.sample')}</p>
      <ul className="mt-3 grid gap-1 text-sm">
        {PREVIEW_SAMPLE_LINES.map((l) => (
          <li key={l.scope} className="tabular text-text">
            {t('preview.line', { scope: t(`form.scope.${l.scope}`), qty: l.quantity, price: money(l.priceCents) })}
          </li>
        ))}
      </ul>
      <div className="mt-4 border-t border-border pt-3" aria-live="polite">
        {!config ? (
          <p className="text-sm text-muted">{t('preview.incomplete')}</p>
        ) : (
          <QueryState isLoading={preview.isLoading} isError={preview.isError} error={preview.error} onRetry={() => preview.refetch()}>
            {preview.data &&
              (config.kind === 'free_shipping' ? (
                <p className="text-sm text-text">{t('preview.shipping')}</p>
              ) : preview.data.discountCents > 0 ? (
                <>
                  <p data-testid="discount-preview-amount" className="tabular border-l-2 border-success pl-3 text-sm font-semibold text-text">
                    {t('preview.discount', { amount: money(preview.data.discountCents) })}
                  </p>
                  {preview.data.capped && <p className="mt-2 text-xs text-muted">{t('preview.capped')}</p>}
                </>
              ) : (
                <p className="text-sm text-muted">{t('preview.none')}</p>
              ))}
          </QueryState>
        )}
      </div>
      <p className="mt-4 font-mono text-[11px] text-muted">{t('preview.note')}</p>
    </section>
  );
}
