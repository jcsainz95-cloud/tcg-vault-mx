'use client';

import type { ReactNode } from 'react';
import { Banner } from '@/components/ui/Banner';
import { verdictRole, verdictTone, type Verdict, type VerdictTone } from '@/lib/verdict';

/**
 * ⭐⭐ **El aviso de resultado del sistema** — `DESIGN_SYSTEM §32.4a`, **transversal**.
 *
 * `lib/verdict.ts` calcula QUÉ se puede afirmar; este componente es CÓMO se pinta, y vive en
 * `components/ui/` por la misma razón por la que la norma no es de M2: *el aviso de resultado de
 * cualquier acción, en cualquier panel*. Mientras la forma vivía dentro de `CatalogSyncSection`,
 * adoptar la norma en otro panel costaba copiar-pegar — y lo que se copia-pega, se degrada.
 *
 * Las tres reglas de forma que encapsula (§32.4a/§32.10), para no volver a discutirlas por panel:
 *
 *  1. **La versalita va primera y DENTRO de la región viva** (`role="status"`/`"alert"`): es el
 *     portador del veredicto y lo primero que se anuncia. ⛔ Nunca se trunca.
 *  2. **El color es el segundo canal, jamás el primero** — sale de `verdictTone`, no del `isSuccess`
 *     de ninguna mutación (H10).
 *  3. **Los ids técnicos no van en la frase** que lee el dueño (§32.4c): van plegados al pie.
 */
export function VerdictNotice({
  label,
  tone,
  role,
  children,
  technical,
  action,
  className,
}: {
  /** La VERSALITA. Normalmente `t(`common.verdict.${verdict}`)`; se admite override cuando una
   *  acción tiene un desenlace con nombre propio (p. ej. «falta la segunda mitad», §32.5b). */
  label: string;
  tone: VerdictTone;
  role: 'status' | 'alert';
  children: ReactNode;
  /** `{ label, value }` del `<details>` plegado con ids crudos. Ausente ⇒ no se pinta. */
  technical?: { label: string; value: ReactNode };
  action?: ReactNode;
  className?: string;
}) {
  return (
    <Banner variant={tone} role={role} action={action} className={className}>
      {/* §32.9: en móvil la versalita ocupa su propia línea; en ancho normal va en la misma. */}
      <span className="block font-mono text-xs uppercase tracking-[0.18em] text-text sm:inline">
        {label}
      </span>{' '}
      <span>{children}</span>
      {technical != null && (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer">{technical.label}</summary>
          <div className="mt-1 break-all font-mono text-muted">{technical.value}</div>
        </details>
      )}
    </Banner>
  );
}

/**
 * Atajo para el caso común: el tono y el `role` salen del **veredicto**, no de la vista. Un panel
 * que use esto **no tiene de dónde sacar un verde que no venga de una cifra** — que es justo lo que
 * `lib/verdict.ts` existe para impedir (H10).
 */
export function VerdictBanner({
  verdict,
  label,
  children,
  technical,
  action,
}: {
  verdict: Verdict;
  label: string;
  children: ReactNode;
  technical?: { label: string; value: ReactNode };
  action?: ReactNode;
}) {
  return (
    <VerdictNotice
      label={label}
      tone={verdictTone(verdict)}
      role={verdictRole(verdict)}
      technical={technical}
      action={action}
    >
      {children}
    </VerdictNotice>
  );
}
