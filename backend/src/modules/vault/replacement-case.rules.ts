/**
 * §M4-SHIP.15 — reglas PURAS del apartado «Por reponer» (clase L): la identidad exacta de una pieza, el plazo
 * derivado y las constantes normativas. Un solo lugar; cambiar una constante es una línea.
 */
import { Finish, GradingCompany, ProductType, RawCondition, SealedCondition } from '@prisma/client';

/** §M4-SHIP.15.12 — SIETE períodos de 24 h desde la apertura (⛔ no «7 días de calendario»). */
export const REPLACEMENT_CASE_DUE_MS = 7 * 24 * 3600 * 1000;

/** §M4-SHIP.15.5 — más de 2×R exige confirmación reforzada (el `k` del bloqueo es el dial `case_refund_hard_multiplier`). */
export const CASE_REFUND_CONFIRM_MULTIPLIER = 2;

/** §M4-SHIP.17.3 — «CLABE cambiada hace poco»: 72 h. */
export const CLABE_RECENT_CHANGE_MS = 72 * 3600 * 1000;

/**
 * §M4-SHIP.17.4 — códigos de fallo de Stripe que significan «cargo en disputa» (⛔ NO MEDIDO el valor exacto en
 * Stripe MX; se parte del nombre documentado por Stripe y se amplía cuando se mida en modo prueba).
 */
export const REFUND_FAILURE_DISPUTE_CODES: readonly string[] = ['charge_disputed', 'charge_already_refunded_or_disputed'];

/** Los NUEVE campos de la identidad exacta (§M4-SHIP.15.2). ⛔ `certNumber` no entra. */
export interface PieceIdentity {
  cardId: string;
  productType: ProductType;
  finish: Finish;
  cardProductId: number | null;
  rawCondition: RawCondition | null;
  gradingCompany: GradingCompany | null;
  gradeValue: string | null;
  sealedProductId: string | null;
  sealedCondition: SealedCondition | null;
}

export const IDENTITY_FIELDS: readonly (keyof PieceIdentity)[] = [
  'cardId',
  'productType',
  'finish',
  'cardProductId',
  'rawCondition',
  'gradingCompany',
  'gradeValue',
  'sealedProductId',
  'sealedCondition',
];

export function identityOf(p: PieceIdentity): PieceIdentity {
  return {
    cardId: p.cardId,
    productType: p.productType,
    finish: p.finish,
    cardProductId: p.cardProductId ?? null,
    rawCondition: p.rawCondition ?? null,
    gradingCompany: p.gradingCompany ?? null,
    gradeValue: p.gradeValue ?? null,
    sealedProductId: p.sealedProductId ?? null,
    sealedCondition: p.sealedCondition ?? null,
  };
}

/** Los campos que DIFIEREN (`[]` ⇔ misma identidad). `null = null` cuenta como igual. */
export function identityMismatch(a: PieceIdentity, b: PieceIdentity): string[] {
  return IDENTITY_FIELDS.filter((f) => (a[f] ?? null) !== (b[f] ?? null));
}

export function sameIdentity(a: PieceIdentity, b: PieceIdentity): boolean {
  return identityMismatch(a, b).length === 0;
}

/** `dueAt = openedAt + 7×24 h`; `overdue ⇔ status='open' ∧ now ≥ dueAt`. Reloj inyectable. */
export function dueAtOf(openedAt: Date): Date {
  return new Date(openedAt.getTime() + REPLACEMENT_CASE_DUE_MS);
}

export function isOverdue(status: string, openedAt: Date, now: Date): boolean {
  return status === 'open' && now.getTime() >= dueAtOf(openedAt).getTime();
}
