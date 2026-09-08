'use client';

import { cn } from '@/lib/cn';

export interface Step {
  key: string;
  label: string;
}

export interface PipelineStepperProps {
  steps: Step[];
  /** key del paso actual */
  current: string;
  /** true si el flujo terminó en rama de error (rechazada/fallida) */
  errored?: boolean;
  /**
   * `'auto'` (default) = comportamiento histórico: apilado en móvil, en fila desde `sm`.
   *
   * `'vertical'` = **siempre** de arriba abajo, incluso en escritorio. Lo exige
   * DESIGN_SYSTEM §23.2b para el **portal del vendedor**, y no es una concesión de espacio:
   * *«el vendedor no está leyendo un pipeline, está leyendo el historial de su venta, y ese
   * objeto se lee de arriba abajo como un rastreo de paquetería»*.
   */
  orientation?: 'auto' | 'vertical';
  /**
   * Sello de tiempo por paso (`key` → texto **ya formateado**), §23.2b: la vertical los muestra
   * bajo la etiqueta.
   *
   * ⚠️ **Un paso sin sello no pinta nada** — ni `—`, ni un hueco reservado, ni una fecha
   * derivada de otro paso. Hoy la proyección de cliente solo sella algunos hitos
   * (`createdAt`, `offer.sentAt`, `offer.acceptedAt`), y **rellenar los demás con la fecha más
   * cercana sería inventar el historial de una venta**. Ausencia de dato ⇒ ausencia de línea.
   */
  timestamps?: Partial<Record<string, string | null | undefined>>;
}

/**
 * PipelineStepper (DESIGN_SYSTEM §7.9, ampliado por §23.2): <ol> con aria-current en el actual.
 *
 * Dirección 5a: deja de ser una fila de píldoras con círculos y se vuelve una
 * línea de tiempo tipográfica — folio mono 01…05 y una regla superior que se
 * pinta hasta donde llegó el envío (tinta en lo recorrido, bermellón en el paso
 * actual). El estado sigue teniendo texto propio, no solo color.
 *
 * ⚠️ **Lo que sigue PENDIENTE de §23.2d: el CIERRE de la rama terminal.** Una solicitud
 * `rechazada`/`expirada`/`abandonada` no marca ningún paso como actual (los terminales no son
 * pasos) y el stepper **no** cuelga todavía el nodo de cierre con la versalita del motivo. Lo
 * que sí está garantizado es la prohibición que más importa: **ningún paso se pinta como
 * fallido ni se tacha** — en `no_offer` el vendedor no falló nada y una cadena de cruces le
 * imputaría un incumplimiento que el correo 4 tiene prohibido decir con palabras.
 */
export function PipelineStepper({
  steps,
  current,
  errored,
  orientation = 'auto',
  timestamps,
}: PipelineStepperProps) {
  const currentIdx = steps.findIndex((s) => s.key === current);
  const vertical = orientation === 'vertical';

  return (
    <ol className={cn('flex flex-col border-t border-border', !vertical && 'sm:flex-row sm:border-t-0')}>
      {steps.map((step, i) => {
        const done = i < currentIdx;
        const isCurrent = i === currentIdx;
        const reached = done || isCurrent;
        const at = timestamps?.[step.key];
        return (
          <li
            key={step.key}
            aria-current={isCurrent ? 'step' : undefined}
            className={cn(
              'flex items-baseline gap-3 border-b border-border py-4',
              !vertical &&
                'sm:-mt-px sm:flex-1 sm:flex-col sm:items-stretch sm:gap-2 sm:border-b-0 sm:border-t sm:border-border sm:pb-4',
              // La regla superior es el progreso: se engrosa donde ya se pasó.
              !vertical && reached && 'sm:border-t-2',
              !vertical && isCurrent && !errored && 'sm:border-t-accent',
              !vertical && isCurrent && errored && 'sm:border-t-accent',
              !vertical && done && 'sm:border-t-text',
            )}
          >
            <span
              className={cn(
                'font-mono text-[10px] leading-none',
                isCurrent ? 'text-accent' : 'text-muted',
              )}
            >
              {String(i + 1).padStart(2, '0')}
            </span>
            <span className="flex min-w-0 flex-col gap-1">
              <span
                className={cn(
                  'text-sm leading-none',
                  isCurrent ? 'font-medium text-text' : reached ? 'text-text' : 'text-muted',
                )}
              >
                {step.label}
              </span>
              {vertical && at && (
                <span className="tabular font-mono text-[11px] leading-none text-muted">{at}</span>
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
