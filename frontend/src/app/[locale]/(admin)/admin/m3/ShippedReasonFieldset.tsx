'use client';

import type { Ref } from 'react';
import { useTranslations } from 'next-intl';
import { SHIPPED_REFUND_REASONS, type ShippedRefundReason } from '@/types/contract';

/**
 * 💰 Los DOS motivos de un reembolso total tras el envío (`DESIGN_SYSTEM §40.1`, `API_CONTRACT §M4-SHIP.18.12`, clase
 * R: «solo sería porque no llegó o estaban en mala condición»). Un solo juego de textos para el diálogo de M3 y para
 * el registro posterior del detalle.
 *
 * ⛔ Sin «otro», ⛔ sin texto libre en lugar del motivo, ⛔ **sin opción marcada al abrir** (un valor por defecto es un
 * motivo que nadie eligió). El «(obligatorio)» va EN la `legend`, que admite foco (`tabIndex=-1`) para el `422`.
 */
export function ShippedReasonFieldset({
  name,
  legend,
  legendRef,
  value,
  onChange,
  disabled,
  testId,
  subject = 'cards',
}: {
  name: string;
  legend: string;
  legendRef?: Ref<HTMLLegendElement>;
  value: ShippedRefundReason | null;
  onChange: (v: ShippedRefundReason) => void;
  disabled?: boolean;
  testId?: string;
  /**
   * De qué es el reembolso: `cards` (pedido o carta, el texto de §40.1) o `item` (un renglón de accesorio o paquete,
   * AC-UX.13): la ayuda de «Llegó en mala condición» no habla de cartas cuando lo reembolsado no es una carta.
   */
  subject?: 'cards' | 'item';
}) {
  const t = useTranslations('admin.m3.shippedReason');
  return (
    <fieldset className="flex flex-col gap-2" disabled={disabled} data-testid={testId}>
      <legend ref={legendRef} tabIndex={-1} className="mb-1 font-mono text-[11px] uppercase tracking-[0.06em] text-muted outline-none focus-visible:shadow-focus">
        {legend}
      </legend>
      {SHIPPED_REFUND_REASONS.map((r) => (
        <label key={r} className="flex min-h-[44px] items-start gap-3 text-sm text-text">
          <input type="radio" name={name} value={r} className="mt-0.5 h-5 w-5 accent-text" checked={value === r} onChange={() => onChange(r)} />
          <span>
            {t(r)}
            <span className="block text-muted">{t(subject === 'item' ? `hintItem.${r}` : `hint.${r}`)}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}
