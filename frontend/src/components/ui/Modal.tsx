'use client';

import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

/** Modal / bottom-sheet (DESIGN_SYSTEM §7.6) con foco y Esc. */
export function Modal({ open, onClose, title, children, footer }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);

  // Foco inicial: SOLO cuando el modal pasa a abierto (dep únicamente `open`). `onClose` es una
  // función nueva en cada render del padre (no memoizada) — si estuviera en este array, cada
  // tecleo dentro del modal (p. ej. el motivo de rechazo de M5) re-dispararía el efecto y
  // robaría el foco de vuelta al wrapper del modal a media escritura (bug: el cursor "salta"
  // del campo en cada carácter).
  useEffect(() => {
    if (!open) return;
    ref.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(26,26,24,.55)] p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        /* Alto acotado + cuerpo scrolleable: un modal largo (p. ej. el drawer de celda de M1)
           desbordaba la ventana y su PIE quedaba fuera de la pantalla — la acción de cierre del
           flujo se volvía invisible. El pie (footer) queda fijo y el contenido scrollea. */
        className="flex max-h-[100dvh] w-full max-w-md flex-col border-t border-border bg-bg p-5 outline-none sm:max-h-[90vh] sm:border"
      >
        <div className="mb-4 flex shrink-0 items-center justify-between">
          <h2 className="font-serif text-xl text-text">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1 text-muted hover:text-text"
          >
            <X size={20} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto text-sm text-text">{children}</div>
        {footer && <div className="mt-5 flex shrink-0 flex-wrap justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}
