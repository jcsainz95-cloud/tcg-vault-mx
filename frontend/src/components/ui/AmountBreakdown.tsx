'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { BreakdownDTO } from '@/types/contract';
import type { AppLocale } from '@/i18n/routing';
import { formatMoneyCents } from '@/lib/format';

/**
 * ⚠️⚠️ **POR QUÉ ESTE COMPONENTE NO EXIGE LA CONVENCIÓN, Y ES UN HUECO DEL CONTRATO, NO UNA
 * RELAJACIÓN MÍA.**
 *
 * Cinco de las seis superficies que cuelgan de aquí reciben un `BreakdownDTO` **del servidor**, con
 * `priceConvention` e `ivaIncluded` dentro (§M10-IVA.4). La sexta —el **rastreo de un retiro**
 * (`ShipmentDetailView`)— **compone el desglose en el cliente** a partir de los montos sueltos de
 * `ShipmentDTO` (contrato §5), y **`ShipmentDTO` ⛔ no trae la convención**.
 *
 * ⛔ **La salida que NO se toma: rellenarla.** Poner `'IVA_EXCLUSIVE'` a mano sería correcto hoy y
 * **una mentira el día que la convención se encienda**, sin que nada fallara — exactamente la clase
 * de defecto que §M10-IVA.3 evita renombrando `salePriceCents`. Poner `'IVA_INCLUSIVE'` sería la
 * mentira simétrica sobre los retiros ya cobrados (criterio **190**).
 *
 * ⇒ **Se declara opcional, y cuando falta la pantalla NO AFIRMA NINGUNA CONVENCIÓN**: el renglón
 * de IVA se pinta como hoy, sin rótulo de «incluido» y sin marcarse como informativo. Es la misma
 * regla de `IvaLabel`: *un rótulo de impuesto adivinado es peor que ningún rótulo*.
 *
 * ⚠️ **SOLICITUD AL ARQUITECTO** (anotada en `docs/FRONTEND_NOTES.md`): `ShipmentDTO` de
 * `GET /shipments/:id` necesita `priceConvention` (o `ivaIncluded`), como ya lo tiene
 * `BreakdownDTO`. Sin él, el rastreo de un retiro es la única superficie de dinero del cliente que
 * no puede rotular su propio impuesto.
 */
export type BreakdownView = Omit<BreakdownDTO, 'priceConvention' | 'ivaIncluded'> &
  Partial<Pick<BreakdownDTO, 'priceConvention' | 'ivaIncluded'>>;

export interface AmountBreakdownProps {
  breakdown: BreakdownView;
  /** en retiros, subtotalCents = tarifa de envío (contrato §5) */
  variant?: 'purchase' | 'shipment';
}

function Line({
  label,
  amount,
  hint,
  locale,
  informative = false,
}: {
  label: string;
  amount: number;
  hint?: string;
  locale: AppLocale;
  /**
   * ⭐⭐ §M10-IVA.4 — **el renglón INFORMA, no suma.** Bajo `IVA_INCLUSIVE` el IVA ya está dentro
   * de `subtotalCents` y de `shippingFeeCents`, así que **no es un sumando del total**. Se rotula
   * en `muted` y marcado con `data-informative`, ⛔ **no se le pone un signo `−`** (no se resta) ni
   * se esconde (el cliente tiene derecho a ver el impuesto que pagó, criterio **192**).
   */
  informative?: boolean;
}) {
  return (
    <div
      data-informative={informative ? 'true' : undefined}
      className={
        informative
          ? 'flex items-center justify-between py-3 text-sm text-muted'
          : 'flex items-center justify-between py-3 text-sm text-text'
      }
    >
      {hint ? (
        // Sin icono de ayuda: la explicación cuelga del propio concepto, marcada
        // con subrayado punteado (el diseño no admite iconos decorativos).
        <span
          title={hint}
          aria-label={`${label}. ${hint}`}
          className="cursor-help underline decoration-dotted underline-offset-4"
        >
          {label}
        </span>
      ) : (
        <span>{label}</span>
      )}
      <span className="tabular">{formatMoneyCents(amount, locale)}</span>
    </div>
  );
}

/**
 * AmountBreakdown (DESIGN_SYSTEM §7.12): subtotal + IVA desglosado + comisión de
 * plataforma + total, en el orden del contrato. El total nunca sin su desglose.
 *
 * Dirección 5a: los renglones se separan con aire, no con reglas, y solo el total
 * lleva regla encima; la cifra final es la pieza tipográfica más grande del bloque.
 *
 * ⚠️ §29 (v3.6) — este componente es el ÚNICO que rotula estas líneas, y de él cuelgan
 * CINCO superficies de cliente: checkout con cuenta, guest checkout, detalle de orden,
 * seguimiento público (`/pedido`) y detalle de envío. La línea de comisión se rotula
 * `checkout.platformFee` y **es una comisión NUESTRA**: la pantalla no nombra al
 * procesador de pago ni declara traslado alguno. El campo del contrato sigue
 * llamándose `processingFeeCents` a propósito (§29.5): es nombre de API, no de rótulo.
 * El candado del copy vive en `src/lib/i18n-parity.test.ts`.
 */
export function AmountBreakdown({ breakdown, variant = 'purchase' }: AmountBreakdownProps) {
  const t = useTranslations('checkout');
  const locale = useLocale() as AppLocale;

  /*
   * ⭐⭐ **LA CONVENCIÓN LA DICE EL DESGLOSE, FILA A FILA** (§M10-IVA.4, criterio **190**).
   *
   * ⛔ **No es un ajuste global y no se puede serlo**: esta misma pantalla puede pintar hoy una
   * orden nueva (`IVA_INCLUSIVE`) y mañana el detalle de una de hace seis meses (`IVA_EXCLUSIVE`).
   * *Un pedido ya cobrado no se reinterpreta solo* — y si esta pantalla leyera el dial vivo en vez
   * del campo de la fila, lo reinterpretaría cada vez que el dueño moviera el dial.
   *
   * ⛔ **No se deriva de `ivaCents === 0`**: bajo `IVA_INCLUSIVE` el IVA ⛔ **nunca es 0**, ni con
   * el dial de traslación en 0 %, así que esa heurística no distingue nada y sí inventa.
   */
  const ivaIncluded = breakdown.ivaIncluded === true;

  return (
    <div data-testid="amount-breakdown" data-price-convention={breakdown.priceConvention}>
      <Line
        label={variant === 'shipment' ? t('shipping') : t('subtotal')}
        amount={breakdown.subtotalCents}
        hint={
          variant === 'shipment'
            ? undefined
            : ivaIncluded
              ? t('subtotalHintIvaIncluded')
              : t('subtotalHint')
        }
        locale={locale}
      />
      {/*
       * v1.21-guest-checkout (ADITIVO): un pedido `direct_ship` (invitado) cobra las cartas
       * y el envío en el MISMO PaymentIntent, así que el desglose trae `shippingFeeCents`
       * como LÍNEA APARTE (contrato §4-G / BreakdownDTO). En compras a bóveda y en retiros
       * el campo no viene y este renglón no se pinta: el desglose queda idéntico a v1.20.
       */}
      {breakdown.shippingFeeCents != null && (
        <Line label={t('shipping')} amount={breakdown.shippingFeeCents} locale={locale} />
      )}
      {/*
       * ⛔⛔ **EL RENGLÓN DE IVA: bajo `IVA_INCLUSIVE` INFORMA, NO SUMA** (criterio **189**,
       * §M10-IVA.4). La identidad del total pasa a ser
       * `total == subtotal + envío + comisión` — **el IVA ya está dentro de los dos primeros**.
       *
       * ⛔ **Ni se oculta ni se convierte en resta.** Ocultarlo incumpliría el criterio **192** (el
       * desglose fiscal no se vacía) y restarlo produciría un total que no es el que se cobra.
       *
       * ⛔ **Cero afirmaciones jurídicas** (criterios **195** y **208**): el rótulo es de
       * **importe** y nada más. */}
      <Line
        label={
          ivaIncluded
            ? t('ivaIncluded', { rate: breakdown.ivaRatePct })
            : t('iva', { rate: breakdown.ivaRatePct })
        }
        amount={breakdown.ivaCents}
        hint={ivaIncluded ? t('ivaIncludedHint') : t('ivaHint')}
        locale={locale}
        informative={ivaIncluded}
      />
      <Line
        label={t('platformFee')}
        amount={breakdown.processingFeeCents}
        hint={t('platformFeeHint')}
        locale={locale}
      />
      <div className="mt-2 flex items-baseline justify-between border-t border-border-strong pt-5">
        <span className="text-[15px] font-medium text-text">{t('total')}</span>
        <span className="tabular text-[28px] font-medium leading-none text-text">
          {formatMoneyCents(breakdown.totalCents, locale)}
        </span>
      </div>
    </div>
  );
}
