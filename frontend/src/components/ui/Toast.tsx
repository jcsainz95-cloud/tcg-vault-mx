'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, AlertTriangle, X } from 'lucide-react';

/**
 * Toast MÍNIMO y reutilizable (DESIGN_SYSTEM §7.5: efímero, esquina, auto-cierre;
 * confirmaciones no críticas). No había infra global de toasts; este hook + viewport
 * la cubre sin depender de un provider global, para que un solo consumidor (p. ej.
 * el alta de M1) pueda disparar confirmaciones INEQUÍVOCAS por encima de un modal.
 *
 * Estilo 5a: bloque de TINTA sobre papel (scrim §7.2b), texto mono en versalitas,
 * radio 0, sin sombra; el tono (éxito verde / atención bermellón) se cifra en la
 * regla izquierda + el icono, nunca en un relleno de color. El texto es el portador.
 */
export type ToastVariant = 'success' | 'danger' | 'info';

export interface ToastItem {
  id: string;
  variant: ToastVariant;
  title?: string;
  message: string;
  /** ms hasta el auto-cierre; 0 = no se cierra solo. Default 6000. */
  duration?: number;
}

let seq = 0;

/** Estado local de toasts + API push/dismiss con auto-cierre. */
export function useToasts() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const push = useCallback(
    (toast: Omit<ToastItem, 'id'>) => {
      const id = `toast-${++seq}`;
      setToasts((prev) => [...prev, { ...toast, id }]);
      const duration = toast.duration ?? 6000;
      if (duration > 0) {
        const timer = setTimeout(() => dismiss(id), duration);
        timers.current.set(id, timer);
      }
      return id;
    },
    [dismiss],
  );

  // Limpia timers pendientes al desmontar (no dejar setTimeout huérfanos).
  useEffect(() => {
    const map = timers.current;
    return () => {
      map.forEach((t) => clearTimeout(t));
      map.clear();
    };
  }, []);

  return { toasts, push, dismiss };
}

const ruleFor: Record<ToastVariant, string> = {
  success: 'border-l-2 border-success',
  danger: 'border-l-2 border-accent',
  info: 'border-l border-on-ink-rule',
};

function ToastCard({ toast, onDismiss }: { toast: ToastItem; onDismiss: (id: string) => void }) {
  const Icon = toast.variant === 'success' ? Check : toast.variant === 'danger' ? AlertTriangle : null;
  return (
    <div
      // danger = alert/assertive (el operador debe enterarse); el resto status/polite.
      role={toast.variant === 'danger' ? 'alert' : 'status'}
      aria-live={toast.variant === 'danger' ? 'assertive' : 'polite'}
      className={`pointer-events-auto flex w-full max-w-sm items-start gap-3 bg-ink py-3 pl-4 pr-3 ${ruleFor[toast.variant]}`}
    >
      {Icon && <Icon size={16} className="mt-0.5 shrink-0 text-on-ink" aria-hidden />}
      <div className="min-w-0 flex-1">
        {toast.title && (
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-on-ink">
            {toast.title}
          </p>
        )}
        <p className="text-sm leading-snug text-on-ink-muted">{toast.message}</p>
      </div>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Close"
        className="-mr-1 shrink-0 p-1 text-on-ink-nav hover:text-on-ink focus-visible:shadow-focus"
      >
        <X size={16} />
      </button>
    </div>
  );
}

/** Viewport flotante (portal a <body>) — se monta por encima del modal (z-[60]). */
export function Toaster({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return createPortal(
    <div
      className="pointer-events-none fixed bottom-5 right-5 z-[60] flex w-[calc(100vw-2.5rem)] max-w-sm flex-col gap-2"
      aria-label="Notificaciones"
    >
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>,
    document.body,
  );
}
