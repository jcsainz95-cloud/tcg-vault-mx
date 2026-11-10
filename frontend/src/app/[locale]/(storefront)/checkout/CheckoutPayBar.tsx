'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import { useStickyBottomBar } from '@/hooks/useStickyBottomBar';

export interface CheckoutPayBarProps {
  /** Línea T3a (invitado) / T3b (cuenta) con los importes YA formateados desde el quote. */
  summaryLine: string;
  /** Bloqueo por condición (§15.9): sustituye la línea 1 y describe a PAGAR (`aria-describedby`). */
  blockedReason?: string | null;
  /** N1: la salida del bloqueo (p. ej. «Elegir envío a domicilio»), a un toque junto a su explicación. */
  blockedAction?: { label: string; onClick: () => void };
  /** Importe de «TOTAL», ya formateado (cotización antes de la sesión; F-SP-5). */
  totalLabel: string;
  /** Texto del botón (`Pagar` / `Preparando…`). */
  payLabel: string;
  loading: boolean;
  disabled: boolean;
  onPay: () => void;
  /** El `AmountBreakdown` completo: única copia en el DOM en <lg. */
  breakdown: React.ReactNode;
}

/** Controles en los que el teclado del móvil está abierto: la barra se esconde mientras tanto. */
function isTextEntry(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  if (el instanceof HTMLInputElement) {
    return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image', 'hidden'].includes(el.type);
  }
  return el instanceof HTMLElement && el.isContentEditable;
}

/**
 * Barra fija de pago en móvil (DESIGN_SYSTEM §CHK-MOVIL.2.4, opción A). Dos filas, ≤ 120 px:
 *  (1) botón de 44 px con la línea T3 y «Ver desglose» (T6, `aria-expanded`) — o, si hay un bloqueo por
 *      condición, su explicación (§15.9) y su salida;
 *  (2) «TOTAL» + importe tabular y PAGAR `accent` (48 px, ≥ 120 px). Con bloqueo, «TOTAL» + importe es el
 *      disclosure del desglose (mismo `aria-expanded`/región/Esc): en <lg no hay otra copia del desglose, y la fila 1
 *      no tiene sitio para un tercer control de 44 px sin pasar de 120 px (medido: 119.5 px a 320/360, ES y EN).
 * Publica su alto en `--sticky-bottom-h` (`useStickyBottomBar`, MKT2-UX.5) y desaparece con un campo de texto
 * enfocado (teclado abierto ⇒ la variable vale 0). El desglose abre hacia ARRIBA en una región (no `dialog`);
 * `Esc` lo cierra y devuelve el foco. ⛔ Ningún importe se calcula aquí: todo llega formateado del quote.
 */
export function CheckoutPayBar({
  summaryLine,
  blockedReason,
  blockedAction,
  totalLabel,
  payLabel,
  loading,
  disabled,
  onPay,
  breakdown,
}: CheckoutPayBarProps) {
  const t = useTranslations('checkout');
  const barRef = useStickyBottomBar<HTMLDivElement>();
  const [open, setOpen] = useState(false);
  // Entrar o salir del bloqueo cierra el desglose (ajuste en render, sin efecto: ni un pintado con la región
  // abierta en el otro modo). Antes `open` sobrevivía al bloqueo y reaparecía abierto al salir.
  const blocked = !!blockedReason;
  const [wasBlocked, setWasBlocked] = useState(blocked);
  if (wasBlocked !== blocked) {
    setWasBlocked(blocked);
    setOpen(false);
  }
  const [typing, setTyping] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const regionId = useId();
  const blockedId = useId();

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Un toque que SACA el foco de un campo (p. ej. sobre la casilla de abajo) no debe ver aparecer la barra entre
    // su `pointerdown` y su `click`: el `click` caería sobre la barra y no sobre lo tocado. Ocultar es inmediato;
    // MOSTRAR espera a que no haya puntero abajo (medido: con `sync()` inmediato en `focusin`, 10/10 rellenados del
    // formulario a 360×740 fallaron así —la casilla del correo quedaba justo bajo la barra—; a 320/390/414, 0/30).
    let pointerDown = false;
    const sync = () => setTyping(isTextEntry(document.activeElement));
    const later = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (!pointerDown) sync();
      }, 0);
    };
    const onIn = () => {
      if (timer) clearTimeout(timer);
      if (isTextEntry(document.activeElement)) sync();
      else later();
    };
    // Al saltar de un campo a otro, `focusout` llega antes que `focusin` con `body` activo: se espera un tick
    // para no hacer parpadear la barra entre dos campos.
    const onOut = () => later();
    const onDown = () => {
      pointerDown = true;
    };
    const onUp = () => {
      pointerDown = false;
      later();
    };
    document.addEventListener('focusin', onIn);
    document.addEventListener('focusout', onOut);
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('pointerup', onUp, true);
    document.addEventListener('pointercancel', onUp, true);
    sync();
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener('focusin', onIn);
      document.removeEventListener('focusout', onOut);
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('pointerup', onUp, true);
      document.removeEventListener('pointercancel', onUp, true);
    };
  }, []);

  const onToggleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && open) {
      e.stopPropagation();
      setOpen(false);
    }
  };

  // Con el teclado abierto la barra no se pinta: se desmonta y el registro publica 0 (MKT2-UX.5).
  if (typing) return null;

  return (
    <div
      ref={barRef}
      data-testid="checkout-pay-bar"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border-strong bg-bg px-5 pt-2"
      style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}
    >
      {open && (
        <div
          id={regionId}
          role="region"
          aria-label={t('summary')}
          data-testid="checkout-pay-bar-breakdown"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              setOpen(false);
              toggleRef.current?.focus();
            }
          }}
          className="absolute inset-x-0 bottom-full max-h-[60vh] overflow-y-auto border-t border-border-strong bg-bg px-5 pb-4 pt-5"
        >
          {breakdown}
        </div>
      )}
      {blockedReason ? (
        <div className="flex min-h-[44px] items-center gap-2">
          <p id={blockedId} className="min-w-0 flex-1 font-mono text-[11px] leading-[1.5] text-muted">
            {blockedReason}
          </p>
          {blockedAction && (
            <button
              type="button"
              onClick={blockedAction.onClick}
              // Angosta a propósito (dos renglones): la explicación conserva ≤ 2 renglones y la barra ≤ 120 px a 320.
              className="inline-flex min-h-[44px] w-[92px] shrink-0 items-center text-left font-mono text-[11px] leading-[1.3] text-text underline underline-offset-4"
            >
              {blockedAction.label}
            </button>
          )}
        </div>
      ) : (
        <button
          ref={toggleRef}
          type="button"
          aria-expanded={open}
          aria-controls={open ? regionId : undefined}
          onClick={() => setOpen((o) => !o)}
          onKeyDown={onToggleKeyDown}
          className="block min-h-[44px] w-full text-left font-mono text-[11px] leading-[1.5] text-muted"
        >
          {summaryLine && (
            <>
              <span data-testid="checkout-pay-bar-summary">{summaryLine}</span>
              {' · '}
            </>
          )}
          <span className="text-text underline underline-offset-4">{open ? t('bar.hideBreakdown') : t('bar.showBreakdown')}</span>
        </button>
      )}
      <div className="mt-1 flex items-center justify-between gap-3">
        {blocked ? (
          <button
            ref={toggleRef}
            type="button"
            aria-expanded={open}
            aria-controls={open ? regionId : undefined}
            onClick={() => setOpen((o) => !o)}
            onKeyDown={onToggleKeyDown}
            data-testid="checkout-pay-bar-total-toggle"
            className="block min-h-[44px] min-w-0 text-left"
          >
            <span className="eyebrow flex items-center gap-1">
              {t('bar.total')}
              {open ? <ChevronDown size={12} aria-hidden /> : <ChevronUp size={12} aria-hidden />}
            </span>
            <span
              className="tabular block text-[22px] font-medium leading-tight text-text underline underline-offset-4"
              data-testid="checkout-pay-bar-total"
            >
              {totalLabel}
            </span>
            <span className="sr-only">{open ? t('bar.hideBreakdown') : t('bar.showBreakdown')}</span>
          </button>
        ) : (
          <div className="min-w-0">
            <p className="eyebrow">{t('bar.total')}</p>
            <p className="tabular text-[22px] font-medium leading-tight text-text" data-testid="checkout-pay-bar-total">
              {totalLabel}
            </p>
          </div>
        )}
        <Button
          variant="accent"
          loading={loading}
          disabled={disabled}
          aria-describedby={blockedReason ? blockedId : undefined}
          onClick={onPay}
          // Menor del informe N1: apagado no solo por color — regla discontinua además del cursor (§15.9).
          className={cn('min-h-[48px] min-w-[120px] shrink-0 tracking-eyebrow', disabled && !loading && 'border-dashed')}
        >
          {payLabel}
        </Button>
      </div>
    </div>
  );
}
