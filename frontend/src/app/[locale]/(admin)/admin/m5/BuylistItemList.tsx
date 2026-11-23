'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';

/**
 * Lista ÚNICA de cartas de una solicitud de M5 (dueño, 2026-11-22: «una sola lista que consolide la información»).
 * Antes la ficha pintaba las mismas cartas dos veces (la «mesa de solo lectura» y la lista de partidas). Aquí vive solo
 * el MARCO de la lista (encabezado, cabecera de columnas y grupo plegable de «no compradas»); las filas siguen en M5View
 * porque cuelgan de sus mutaciones. Todo texto y toda cifra vienen del servidor o de i18n: no se calcula dinero.
 */

/** Rejilla de la fila de una carta COMPRADA: carta · cotizado · pactado · estado · acciones (solo escritorio). */
export const ITEM_GRID =
  'lg:grid lg:grid-cols-[minmax(0,2fr)_minmax(0,0.8fr)_minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1.3fr)] lg:items-start lg:gap-4';

/** Título + conteo («20 se compran · 17 no entraron en la oferta») y cabecera de columnas. */
export function ItemListHeader({ requestId, buy, skip }: { requestId: string; buy: number; skip: number }) {
  const t = useTranslations('admin.m5.items');
  return (
    <>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1" data-testid={`m5-items-header-${requestId}`}>
        <h3 className="font-serif text-lg text-text">{t('title')}</h3>
        <p className="text-sm text-muted" data-testid={`m5-items-summary-${requestId}`}>
          {skip > 0 ? t('summarySplit', { buy, skip }) : t('summaryAll', { count: buy })}
        </p>
      </div>
      {buy > 0 && (
        <div aria-hidden="true" className={`hidden border-b border-border-strong pb-2 ${ITEM_GRID}`}>
          {(['colCard', 'colQuoted', 'colAgreed', 'colStatus'] as const).map((k) => (
            <span key={k} className="eyebrow">
              {t(k)}
            </span>
          ))}
          <span />
        </div>
      )}
    </>
  );
}

/** Las NO compradas, plegadas y compactas; la frase que las explica sale UNA vez (no una por carta). */
export function NotBoughtGroup({ requestId, count, children }: { requestId: string; count: number; children: ReactNode }) {
  const t = useTranslations('admin.m5.items');
  return (
    <details className="border border-border" data-testid={`m5-notbought-group-${requestId}`}>
      <summary className="flex cursor-pointer flex-col gap-0.5 px-3 py-2 focus-visible:shadow-focus focus-visible:outline-none">
        <span className="text-sm font-medium">{t('notBoughtGroup', { count })}</span>
        <span className="text-xs text-muted">{t('notBoughtNote')}</span>
      </summary>
      <div className="flex flex-col divide-y divide-border border-t border-border px-3">{children}</div>
    </details>
  );
}
