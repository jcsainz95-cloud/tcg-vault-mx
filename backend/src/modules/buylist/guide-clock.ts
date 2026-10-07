/**
 * guide-clock.ts — 💰 rev BSD-1 (API_CONTRACT §BSD.7 reglas 8 y 9, §BSD.5 `guideDueAt`/`guideDueSoon`, §BSD.15 C-8): **el reloj
 * del cierre de una `aceptada` SIN guía**, en UN fichero.
 *
 * ### Qué mide
 * Una solicitud aceptada que en N días NATURALES (`buylist_guide_close_calendar_days`, 7) no tiene guía se cierra sola
 * (`expirada`/`not_continued`, sin culpa). El ANCLA es `coalesce(inboundGuideClockStartedAt, acceptedAt)`: la columna nueva la
 * escriben solo `M-72` (las abiertas al desplegar, P-BSD-2) y la re-emisión de una guía de entrada (§BSD.4.6). Ancla nula ⇒
 * ⛔ no corre (fail-closed). ⛔ Días NATURALES: milisegundos, nunca `business-days` (sábado y domingo cuentan).
 *
 * ### «Sin guía» (glosario §BSD.0) — UN predicado, dos formas
 * `status='aceptada' ∧ closedAt IS NULL ∧ guideSentAt IS NULL ∧ shipmentTrackingNumber IS NULL ∧ sellerShippedDeclaredAt IS NULL
 * ∧ shipmentConfirmedAt IS NULL ∧ (sin fila de entrada ∨ (fila.labelProcessingSince IS NULL ∧ (fila.providerShipmentId IS NULL ∨
 * fila.providerCanceledAt IS NOT NULL)))`.
 *  - `guideClockRunningWhere()` — la forma Prisma: la LEEN y la ESCRIBEN el barrido (reglas 8 y 9) y el contador del tablero.
 *  - `guideClockRunning(sr, fila)` — la forma JS: la usa el DTO (`guideDueAt`), que ya tiene las dos filas en la mano.
 * Las dos se afirman iguales sobre la misma tabla de casos (`test/bsd.b3-guide-clock.spec.ts`).
 *
 * Fichero LIGERO (solo Prisma): lo importan `jobs/buylist-sweep.service.ts` y `buylist.service.ts`.
 */
import { Prisma, SellRequestStatus } from '@prisma/client';

/** Un día natural en milisegundos (§BSD.7.1: `now − ancla` en ms). */
export const GUIDE_DAY_MS = 24 * 60 * 60 * 1000;

/** Los dos diales de §BSD.9, CRUDOS (tal como los devuelve `SettingsService`). */
export interface GuideClockDials {
  /** `buylist_guide_close_calendar_days` (1..60). */
  readonly closeDays: number;
  /** `buylist_guide_warn_days_before_close` (0..30; `0` = sin aviso). */
  readonly warnDays: number;
}

/** §BSD.7.2: el aviso efectivo es `min(warn, close − 1)` (nunca antes del día 1, nunca negativo). */
export function effectiveWarnDays(d: GuideClockDials): number {
  return Math.max(0, Math.min(d.warnDays, d.closeDays - 1));
}

/** Lo que el reloj lee de la solicitud. */
export interface GuideClockSellRequest {
  readonly status: SellRequestStatus;
  readonly closedAt: Date | null;
  readonly guideSentAt: Date | null;
  readonly shipmentTrackingNumber: string | null;
  readonly sellerShippedDeclaredAt: Date | null;
  readonly shipmentConfirmedAt: Date | null;
  readonly inboundGuideClockStartedAt: Date | null;
  readonly acceptedAt: Date | null;
}

/** Lo que el reloj lee de la fila de entrada (o `null` si la solicitud no tiene). */
export interface GuideClockInbound {
  readonly labelProcessingSince: Date | null;
  readonly providerShipmentId: string | null;
  readonly providerCanceledAt: Date | null;
}

/** El ancla del cierre: `coalesce(inboundGuideClockStartedAt, acceptedAt)` (§BSD.0). */
export function guideAnchorOf(sr: Pick<GuideClockSellRequest, 'inboundGuideClockStartedAt' | 'acceptedAt'>): Date | null {
  return sr.inboundGuideClockStartedAt ?? sr.acceptedAt ?? null;
}

/** «Sin guía» en JS (la MISMA regla que `guideClockRunningWhere`). Sin ancla ⇒ `false` (fail-closed). */
export function guideClockRunning(sr: GuideClockSellRequest, inbound: GuideClockInbound | null | undefined): boolean {
  if (sr.status !== 'aceptada' || sr.closedAt != null) return false;
  if (sr.guideSentAt != null || sr.shipmentTrackingNumber != null) return false;
  if (sr.sellerShippedDeclaredAt != null || sr.shipmentConfirmedAt != null) return false;
  if (guideAnchorOf(sr) == null) return false;
  if (inbound) {
    if (inbound.labelProcessingSince != null) return false;
    if (inbound.providerShipmentId != null && inbound.providerCanceledAt == null) return false;
  }
  return true;
}

/** `AdminBuylistDTO.guideDueAt` (§BSD.5): ancla + close × 24 h, solo con el reloj corriendo; si no, `null`. */
export function guideDueAtOf(sr: GuideClockSellRequest, inbound: GuideClockInbound | null | undefined, d: GuideClockDials): Date | null {
  if (!guideClockRunning(sr, inbound)) return null;
  return new Date(guideAnchorOf(sr)!.getTime() + d.closeDays * GUIDE_DAY_MS);
}

/** `guideDueSoon` (§BSD.5): `now ≥ guideDueAt − warn × 24 h` con el aviso EFECTIVO. */
export function guideDueSoonOf(dueAt: Date | null, now: Date, d: GuideClockDials): boolean {
  if (dueAt == null) return false;
  return now.getTime() >= dueAt.getTime() - effectiveWarnDays(d) * GUIDE_DAY_MS;
}

/** BSD-1.1 C-8 `guideDueInDays`: `ceil((guideDueAt − now) / 24 h)`, mínimo 0, solo con `guideDueSoon`; si no, `null`. */
export function guideDueInDaysOf(dueAt: Date | null, now: Date, soon: boolean): number | null {
  if (!soon || dueAt == null) return null;
  return Math.max(0, Math.ceil((dueAt.getTime() - now.getTime()) / GUIDE_DAY_MS));
}

/** Los cuatro derivados del DTO de un golpe (⛔ ninguno se persiste). */
export function guideDueFieldsOf(
  sr: GuideClockSellRequest,
  inbound: GuideClockInbound | null | undefined,
  now: Date,
  d: GuideClockDials,
): { guideDueAt: Date | null; guideDueSoon: boolean; guideDueInDays: number | null } {
  const guideDueAt = guideDueAtOf(sr, inbound, d);
  const guideDueSoon = guideDueSoonOf(guideDueAt, now, d);
  return { guideDueAt, guideDueSoon, guideDueInDays: guideDueInDaysOf(guideDueAt, now, guideDueSoon) };
}

// ===================================================================================== la forma Prisma

/** «Sin guía» en Prisma, SIN la parte de tiempo (la añade quien la usa). */
export function guideClockRunningWhere(): Prisma.SellRequestWhereInput {
  return {
    status: 'aceptada',
    closedAt: null,
    guideSentAt: null,
    shipmentTrackingNumber: null,
    sellerShippedDeclaredAt: null,
    shipmentConfirmedAt: null,
    AND: [
      {
        OR: [
          { inboundShipment: { is: null } },
          {
            inboundShipment: {
              is: { labelProcessingSince: null, OR: [{ providerShipmentId: null }, { providerCanceledAt: { not: null } }] },
            },
          },
        ],
      },
    ],
  };
}

/** `lte ≥ coalesce(ancla) (> gt)` — el ancla con su `coalesce`, en Prisma. Ancla nula ⇒ no casa (fail-closed). */
export function guideAnchorWindowWhere(lte: Date, gt?: Date): Prisma.SellRequestWhereInput {
  const range: Prisma.DateTimeNullableFilter = { not: null, lte, ...(gt ? { gt } : {}) };
  return {
    OR: [
      { inboundGuideClockStartedAt: range },
      { inboundGuideClockStartedAt: null, acceptedAt: range },
    ],
  };
}

/** Regla 8 (§BSD.7.1): sin guía ∧ `ancla + close × 24 h ≤ now`. El MISMO objeto lee y escribe. */
export function guideCloseDueWhere(now: Date, d: GuideClockDials): Prisma.SellRequestWhereInput {
  return { AND: [guideClockRunningWhere(), guideAnchorWindowWhere(new Date(now.getTime() - d.closeDays * GUIDE_DAY_MS))] };
}

/**
 * Regla 9 (§BSD.7.2): sin guía ∧ `ancla + (close − warn) × 24 h ≤ now < ancla + close × 24 h`. `null` con el aviso efectivo en
 * `0` (sin aviso).
 */
export function guideWarnDueWhere(now: Date, d: GuideClockDials): Prisma.SellRequestWhereInput | null {
  const warn = effectiveWarnDays(d);
  if (warn <= 0) return null;
  const t = now.getTime();
  return {
    AND: [
      guideClockRunningWhere(),
      guideAnchorWindowWhere(new Date(t - (d.closeDays - warn) * GUIDE_DAY_MS), new Date(t - d.closeDays * GUIDE_DAY_MS)),
    ],
  };
}

/**
 * BSD-1.1 C-3 — `workQueue.buylistGuideDueSoon`: las solicitudes con `guideDueSoon = true` (sin guía ∧ `now ≥ guideDueAt − warn`,
 * incluidas las ya vencidas que el barrido cerrará en su próxima pasada). Es la forma Prisma de `guideDueSoonOf`.
 */
export function guideDueSoonWhere(now: Date, d: GuideClockDials): Prisma.SellRequestWhereInput {
  const warn = effectiveWarnDays(d);
  return { AND: [guideClockRunningWhere(), guideAnchorWindowWhere(new Date(now.getTime() - (d.closeDays - warn) * GUIDE_DAY_MS))] };
}
