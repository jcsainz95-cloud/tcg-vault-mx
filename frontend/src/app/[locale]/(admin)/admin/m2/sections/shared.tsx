'use client';

import { useEffect, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { cn } from '@/lib/cn';
import type {
  BuylistRuleMode,
  SalesRuleMode,
  SealedSubtype,
  Finish,
} from '@/types/contract';
import { ApiClientError } from '@/lib/api-client';

export const RULE_MODES: BuylistRuleMode[] = ['fixed', 'pct'];
export const SALES_RULE_MODES: SalesRuleMode[] = ['fixed', 'pct'];
// P-33: `PRICE_PROVIDERS` (dial del proveedor de respaldo) se retiró junto con PriceProviderSection.
// v1.23-sealed-sales: presentaciones del sellado con spread editable (§M2 sealed-spreads).
export const SEALED_SUBTYPES: SealedSubtype[] = ['box', 'etb', 'bundle', 'tin', 'blister'];
// v1.29 (§4.28d): acabados que tienen su PROPIO eje de regla (finishRules). `normal` NO lleva
// finish-rule (usa la rareza), por eso queda fuera. Reemplazan las viejas keys sintéticas
// "Holo"/"Reverse Holo" del mapa plano (parche INV-1 retirado).
export const FINISH_RULE_KEYS: Finish[] = ['reverse_holo', 'holofoil', 'first_edition_holofoil'];

/** Convierte pesos (texto) a centavos enteros. */
export function pesosToCents(value: string): number {
  const n = Number(value.replace(/,/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/**
 * S-P1-1 (money-safe): sanea entrada monetaria a dígitos + UN SOLO punto decimal. Un
 * `replace(/[^0-9.]/g,'')` deja pasar "1.2.3"/"12..5", que luego castean a NaN→0 y listarían
 * cartas a MX$0. Aquí se conserva solo el PRIMER punto y se descartan los siguientes.
 */
export function sanitizeDecimalInput(value: string): string {
  const cleaned = value.replace(/[^0-9.]/g, '');
  const firstDot = cleaned.indexOf('.');
  if (firstDot === -1) return cleaned;
  return cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '');
}

/**
 * S-P1-1 (money-safe): un valor CRUDO de regla es guardable solo si NO está vacío y parsea a un
 * número finito. Vacío ("") o mal formado (".", "1.2.3") NO deben guardarse como 0 (regalo).
 */
export function isSaveableRuleValue(raw: string): boolean {
  const trimmed = raw.trim();
  if (trimmed === '') return false;
  return Number.isFinite(Number(trimmed));
}

/**
 * El endpoint `sync-all` puede no existir aún en el backend (contrato v1.3, condicional).
 * Un 404/405 se trata como "no disponible" (warning); cualquier otro error real (rate limit,
 * timeout, 5xx) se muestra como error con su código/mensaje.
 */
export function isEndpointMissing(error: unknown): boolean {
  return error instanceof ApiClientError && (error.status === 404 || error.status === 405);
}

/**
 * Barra de progreso del barrido de catálogo (sync-all). Mientras corre pinta done/total en
 * SETS y avisa —honestamente— que sigue en segundo plano; al terminar muestra el éxito.
 * `role="status"` + `aria-live` para que un lector de pantalla anuncie el avance.
 */
export function SyncProgress({
  running,
  done,
  total,
  labels,
}: {
  running: boolean;
  done: number;
  total: number;
  labels: { running: string; runningHint: string; done: string };
}) {
  const pct = total > 0 ? Math.min(100, Math.round((Math.min(done, total) / total) * 100)) : 0;
  const value = running ? pct : 100;
  return (
    // FE-9: semántica de progreso REAL (`role="progressbar"` con `aria-value*`) en la propia
    // barra, en vez de un `role="status"` verboso que re-anunciaba el bloque completo cada ~3 s.
    // El lector de pantalla anuncia el cambio de `aria-valuenow` de forma nativa y moderada.
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">{running ? labels.running : labels.done}</span>
        {running && <span className="tabular text-muted">{pct}%</span>}
      </div>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-border"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        aria-valuetext={running ? `${labels.running} ${pct}%` : labels.done}
        aria-label={running ? labels.running : labels.done}
      >
        <div
          className={`h-full rounded-full transition-all ${running ? 'bg-accent' : 'bg-success'}`}
          style={{ width: `${value}%` }}
        />
      </div>
      {running && <p className="text-xs text-muted">{labels.runningHint}</p>}
    </div>
  );
}

/**
 * §19.4 / §19.9: menú «Más ▾» por-fila que esconde la acción AVANZADA H («Sync completo») fuera del
 * renglón principal para no invitarla por default. Accesible: disparador `aria-haspopup="menu"` +
 * `aria-expanded`; el panel es `role="menu"` con `menuitem`s; `Esc` cierra y devuelve el foco al
 * disparador; un clic fuera también cierra. El icono del kebab es el ÚNICO icono con `aria-label`.
 */
export function RowMoreMenu({
  triggerLabel,
  disabled,
  children,
}: {
  triggerLabel: string;
  disabled?: boolean;
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const close = () => setOpen(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={triggerLabel}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'inline-flex min-h-[44px] items-center justify-center px-2 text-text transition-colors hover:text-accent sm:min-h-0 sm:py-2',
          'disabled:cursor-not-allowed disabled:text-muted',
        )}
      >
        <MoreHorizontal size={18} aria-hidden />
      </button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          className="absolute right-0 z-10 mt-1 flex min-w-[12rem] flex-col rounded-lg border border-border bg-surface p-1 shadow-md"
        >
          {children(close)}
        </div>
      )}
    </div>
  );
}
