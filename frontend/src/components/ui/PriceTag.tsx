'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { PriceInfo } from '@/types/contract';
import type { AppLocale } from '@/i18n/routing';
import { formatMoneyCents, formatDate } from '@/lib/format';
import { cn } from '@/lib/cn';
import { IvaLabel } from '@/components/ui/IvaLabel';

export interface PriceTagProps {
  /** valor de referencia de mercado (PriceInfo del contrato) */
  reference: PriceInfo;
  /**
   * ⭐⭐ §M10-IVA.3 — **`P`: la cifra que se pinta y la que se suma. YA LLEVA EL IVA DENTRO.**
   * Sustituye a `salePriceCents`, que **desapareció** de la superficie pública (el rename es
   * deliberado: con el mismo nombre, un front sin migrar habría seguido pintando la mentira sin
   * que nada fallara). ⛔ **Este componente no multiplica ni divide nada.**
   */
  displayPriceCents?: number;
  /**
   * ⭐⭐ §M10-IVA.3 — **gobierna el rótulo de la letra chica**, y por eso es OBLIGATORIO cuando hay
   * cifra de venta: un importe sin su convención es un número sin unidad.
   * - `true`  ⇒ «IVA {ivaRatePct} % incluido»
   * - `false` ⇒ «sin IVA» (conducta histórica, criterio **190**: un precio `IVA_EXCLUSIVE` ⛔ no se
   *   reinterpreta solo)
   *
   * ⛔ **No tiene default.** Un `ivaIncluded = true` por omisión rotularía «IVA incluido» sobre
   * cifras que no lo llevan, que es exactamente la mentira que §M10-IVA existe para evitar.
   */
  ivaIncluded?: boolean;
  /** §M10-IVA.3 — la **TASA** (16), para el rótulo. ⛔ NO es el dial de traslación, que ⛔ no viaja a superficie de cliente (criterio **209**). */
  ivaRatePct?: number;
  /** 'sale' resalta el precio de venta; 'reference' resalta el valor de mercado */
  mode?: 'sale' | 'reference';
  /** 'lg' para la ficha de detalle; 'md' para retículas y renglones */
  size?: 'md' | 'lg';
}

/**
 * PriceTag (DESIGN_SYSTEM §7.3): distingue valor de mercado (referencia) del
 * precio de venta. Estado "precio pendiente" explícito, nunca $0.
 *
 * Dirección 5a: la cifra manda —Archivo, tabular, sin decorar— y la letra chica
 * baja a mono. El pendiente es la única excepción que conserva una caja, con
 * regla bermellón, porque debe frenar la lectura.
 */
export function PriceTag({
  reference,
  displayPriceCents,
  ivaIncluded,
  ivaRatePct,
  mode = 'sale',
  size = 'md',
}: PriceTagProps) {
  const locale = useLocale() as AppLocale;
  const t = useTranslations();
  const amountClass = cn(
    'tabular font-medium leading-none text-text',
    size === 'lg' ? 'text-3xl' : 'text-lg',
  );

  if (reference.status === 'pending' && displayPriceCents == null) {
    return (
      <div className="flex flex-col items-start gap-1.5">
        <span className="border border-accent px-2.5 py-1.5 font-mono text-[11px] uppercase leading-none tracking-[0.06em] text-accent">
          {t('price.pendingLabel')}
        </span>
        <span className="font-mono text-[11px] leading-relaxed text-muted">{t('price.pendingHint')}</span>
      </div>
    );
  }

  // Solo el modo `reference` fecha la referencia; en venta el diseño cierra en
  // dos renglones y la fecha vive en la ficha de detalle.
  const captured = reference.capturedDate ? formatDate(reference.capturedDate, locale) : null;

  if (mode === 'reference' || displayPriceCents == null) {
    return (
      <div className="flex flex-col gap-2">
        <span className={amountClass}>
          {reference.referenceMxnCents != null
            ? formatMoneyCents(reference.referenceMxnCents, locale)
            : '—'}
        </span>
        <span className="font-mono text-[11px] leading-relaxed text-muted">
          {t('catalog.marketValue')}
          {captured ? ` · ${t('price.capturedOn', { date: captured })}` : ''}
        </span>
      </div>
    );
  }

  // §21.8f (enmienda a §7.3): la segunda línea «Valor de mercado» queda RETIRADA del modo venta.
  // Tejas y listados NO muestran valor de mercado y no van a mostrarlo: el mercado vive
  // EXCLUSIVAMENTE en la ficha, y ahí solo cuando `priceBasis === 'market'` (§21.8a). En
  // bóveda/portafolio el PriceTag sigue igual (mode='reference': ahí la cifra ES la referencia y no
  // depende de `priceBasis`).
  /*
   * ⭐⭐ **EL RÓTULO LO DICE EL DATO, NO LA PANTALLA** (§M10-IVA.3/.4, criterio **190**), y lo pinta
   * `IvaLabel`, que es **el único sitio del repositorio que rotula una convención de IVA**. El
   * porqué de ese punto único —y por qué no tiene default— está escrito en ese componente.
   */
  return (
    <div className="flex flex-col gap-1.5">
      <span className={amountClass}>{formatMoneyCents(displayPriceCents, locale)}</span>
      <IvaLabel ivaIncluded={ivaIncluded} ivaRatePct={ivaRatePct} />
    </div>
  );
}
