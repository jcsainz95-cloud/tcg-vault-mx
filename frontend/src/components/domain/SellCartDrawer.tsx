'use client';

import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

/** Selector de focusables para el trap (suficiente para el contenido del carrito). */
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface SellCartDrawerProps {
  open: boolean;
  onClose: () => void;
  /** `aria-label` del diálogo («Carrito de venta (N)»). */
  ariaLabel: string;
  /** Eyebrow del encabezado (CARRITO DE VENTA). */
  title: string;
  /** Conteo visible junto al título (omitido con carrito vacío). */
  countLabel?: string | null;
  /** `aria-label` del botón cerrar (44px). */
  closeLabel: string;
  /** Al cerrar, el foco REGRESA aquí (el FAB) — §18.4b. */
  returnFocusRef?: React.RefObject<HTMLButtonElement | null>;
  children: React.ReactNode;
}

/**
 * Drawer del carrito de venta (DESIGN_SYSTEM §18.4b, P-16). Contenedor flotante que ENVUELVE
 * el contenido del carrito (el drawer no sabe de líneas ni totales):
 * - `≥ lg`: sheet lateral derecho de 400px (min 360 / max 440), alto completo, papel,
 *   `border-l border-border-strong`, overlay de tinta (mismo scrim del Modal §7.6).
 * - `< lg`: bottom sheet a casi pantalla completa (~92vh), patrón del VariantDrawer §16.4.
 * - Semántica de diálogo completa: `role="dialog"` + `aria-modal` + focus trap + Esc cierra +
 *   clic en overlay cierra + botón cerrar 44px; al cerrar, el foco regresa al FAB.
 * - Orden de tabulación interno: cerrar → contenido (requisitos → líneas → total → CTA → vaciar).
 * - z-50: por encima del FAB (z-40) y de la barra sticky de filtros del binder (z-10).
 */
export function SellCartDrawer({
  open,
  onClose,
  ariaLabel,
  title,
  countLabel,
  closeLabel,
  returnFocusRef,
  children,
}: SellCartDrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Foco inicial al abrir; al cerrar (cleanup), el foco REGRESA al FAB (§18.4b).
  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    const returnTo = returnFocusRef?.current ?? null;
    return () => returnTo?.focus();
    // `returnFocusRef` es un ref estable; solo `open` dispara el efecto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // TL-C2 · Guard de `focusin` a nivel document mientras el diálogo está abierto: si el
  // foco aterriza FUERA del panel (p. ej. Tab desde <body> tras perder el foco, o un focus
  // programático detrás del scrim), se reencauza al panel. El trap de `onKeyDown` solo ve
  // los Tab originados DENTRO del panel; este guard cubre las fugas que aquel no ve.
  useEffect(() => {
    if (!open) return;
    function onFocusIn(e: FocusEvent) {
      const panel = panelRef.current;
      if (!panel || (e.target instanceof Node && panel.contains(e.target))) return;
      panel.focus();
    }
    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, [open]);

  // TL-C2 · Pérdida de foco por DESMONTE: al quitar la última línea o vaciar el carrito,
  // React desmonta el botón enfocado y el foco cae a <body> SIN disparar ningún evento de
  // foco (spec: no hay blur/focusin al remover el nodo activo). Se re-verifica tras CADA
  // commit mientras el diálogo está abierto y, si el foco quedó fuera, se devuelve al panel.
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const active = document.activeElement;
    if (panel && (!active || active === document.body || !panel.contains(active))) {
      panel.focus();
    }
  });

  /** Focus trap: Tab/Shift+Tab ciclan dentro del panel (un solo trap activo, §18.4b). */
  function trapFocus(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'Tab' || !panelRef.current) return;
    const nodes = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    if (nodes.length === 0) {
      e.preventDefault();
      return;
    }
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    const active = document.activeElement;
    if (e.shiftKey) {
      if (active === first || active === panelRef.current) {
        e.preventDefault();
        last.focus();
      }
    } else if (active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(26,26,24,.55)] lg:items-stretch lg:justify-end"
      onClick={onClose}
      data-testid="sell-cart-overlay"
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={trapFocus}
        className="flex max-h-[92vh] w-full flex-col border-t border-border-strong bg-bg outline-none lg:h-full lg:max-h-full lg:w-[400px] lg:min-w-[360px] lg:max-w-[440px] lg:border-l lg:border-t-0"
      >
        {/* Encabezado fijo: eyebrow + conteo + cerrar (44px). El botón cerrar va PRIMERO en
            el orden de foco (los headings no son focusables). */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border py-3 pl-5 pr-3">
          <span className="flex items-baseline gap-3">
            <h2 className="eyebrow">{title}</h2>
            {countLabel ? <span className="eyebrow">{countLabel}</span> : null}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
            className="flex h-11 w-11 shrink-0 items-center justify-center text-muted hover:text-text focus-visible:shadow-focus focus-visible:outline-none"
          >
            <X size={20} aria-hidden />
          </button>
        </div>
        {/* Contenido scrolleable: requisitos → líneas → total → CTA → vaciar. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-8 pt-4">{children}</div>
      </div>
    </div>
  );
}
