'use client';

import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

/**
 * Diálogo del panel (§7.6; *bottom sheet* en móvil): `aria-modal`, título como `aria-labelledby`, foco atrapado y
 * foco de regreso al disparador al cerrar. A diferencia de `components/ui/Modal`, admite `dismissible={false}`: el
 * diálogo de la llave nueva NO se cierra con `Esc` ni con clic fuera (MKT-UX.10: perder la llave no tiene vuelta).
 * Local al panel para no tocar la pieza compartida.
 */
export function MktDialog({
  open,
  onClose,
  title,
  children,
  footer,
  dismissible = true,
  initialFocusRef,
  testId,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  dismissible?: boolean;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  testId?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const returnTo = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const dismissRef = useRef(dismissible);
  dismissRef.current = dismissible;

  useEffect(() => {
    if (!open) return;
    returnTo.current = (document.activeElement as HTMLElement | null) ?? null;
    const target = initialFocusRef?.current ?? firstFocusable(ref.current) ?? ref.current;
    target?.focus();
    return () => {
      const back = returnTo.current;
      if (back && document.contains(back)) back.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (dismissRef.current) onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !ref.current) return;
      const items = focusables(ref.current);
      if (items.length === 0) return;
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(26,26,24,.55)] sm:items-center sm:p-4"
      onClick={() => dismissible && onClose()}
    >
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid={testId}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[100dvh] w-full max-w-lg flex-col border-t border-border bg-bg p-5 outline-none sm:max-h-[90vh] sm:border"
      >
        <div className="mb-4 flex shrink-0 items-center justify-between gap-3">
          <h2 id={titleId} className="font-serif text-xl text-text">
            {title}
          </h2>
          {dismissible && (
            <button type="button" onClick={onClose} aria-label="Close" className="min-h-[44px] min-w-[44px] p-1 text-muted hover:text-text">
              <X size={20} aria-hidden />
            </button>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto text-sm text-text">{children}</div>
        {footer && <div className="sticky bottom-0 mt-5 flex shrink-0 flex-wrap justify-end gap-2 bg-bg">{footer}</div>}
      </div>
    </div>
  );
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
}
function firstFocusable(root: HTMLElement | null): HTMLElement | null {
  if (!root) return null;
  // El primer CAMPO, no el botón de cerrar (§MKT-UX.8: «foco al primer campo»).
  return root.querySelector<HTMLElement>('input:not([disabled]), select:not([disabled]), textarea:not([disabled])') ?? focusables(root)[0] ?? null;
}
