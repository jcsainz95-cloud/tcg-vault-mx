/**
 * label-spend.ts — 💰 TG-1 y TG-2: UN cuerpo para las dos comprobaciones, para `labelOptions.limit` y para la tarjeta del
 * tablero (API_CONTRACT §M4-SHIP.19.29.4 con §19.30.4, C-22). `HECHOS.md:62` («Acepto todos»): tope de MX$2,500 en guías por
 * persona en 24 h (al pasarlo solo el dueño compra); una sola recompra de guía por pedido (la tercera la compra el dueño).
 *
 *  spendOfPaidLabel(p) = p.cancelledAt ? (p.unrefundedCents ?? p.chargedCents) : p.chargedCents   — C-22: reembolso
 *                        desconocido ⇒ cuenta ENTERA (falla cerrado; el P&L conserva su supuesto).
 *  spendOfAttempt(a)   = Σ guías pagadas del intento; sin guía: `pending`/`released_unverified` ⇒ `expectedChargeCents`;
 *                        `not_charged` (incl. `not_sent`) ⇒ 0.
 *  labelSpend24h       = Σ spendOfAttempt de los intentos del ACTOR con `since > now − 24 h` (estricto; ⛔ nunca al actor de
 *                        sistema: el intento es de quien reclamó).
 *  paidLabelsOf(S)     = guías pagadas de S (respuesta, adoptadas, huérfanas, duplicados; canceladas incluidas)
 *                        + intentos `pending`/`released_unverified` de S sin guía.
 *  checkLabelLimits    = dueño ⇒ null; paidLabelsOf ≥ 1 + dial de recompras ⇒ 'reissue'; spend24h + precio > tope ⇒ 'daily_spend'.
 */
import { LabelAttemptOutcome, Prisma, ShipmentPaidLabel } from '@prisma/client';
import { isOwnerAccount, OwnerCandidate } from '../spend-alerts/owner';

export const SPEND_WINDOW_MS = 24 * 60 * 60 * 1000;

type Db = Pick<Prisma.TransactionClient, 'shipmentLabelAttempt' | 'shipmentPaidLabel'>;

export function spendOfPaidLabel(p: Pick<ShipmentPaidLabel, 'cancelledAt' | 'unrefundedCents' | 'chargedCents'>): number {
  return p.cancelledAt ? (p.unrefundedCents ?? p.chargedCents) : p.chargedCents;
}

export function spendOfAttempt(a: {
  outcome: LabelAttemptOutcome;
  expectedChargeCents: number;
  paidLabels: Pick<ShipmentPaidLabel, 'cancelledAt' | 'unrefundedCents' | 'chargedCents'>[];
}): number {
  if (a.paidLabels.length > 0) return a.paidLabels.reduce((s, p) => s + spendOfPaidLabel(p), 0);
  return a.outcome === 'pending' || a.outcome === 'released_unverified' ? a.expectedChargeCents : 0;
}

export async function labelSpend24h(db: Db, userId: string, now: Date): Promise<number> {
  const attempts = await db.shipmentLabelAttempt.findMany({
    where: { actorUserId: userId, since: { gt: new Date(now.getTime() - SPEND_WINDOW_MS) } },
    select: { outcome: true, expectedChargeCents: true, paidLabels: { select: { cancelledAt: true, unrefundedCents: true, chargedCents: true } } },
  });
  return attempts.reduce((s, a) => s + spendOfAttempt(a), 0);
}

export async function paidLabelsOf(db: Db, shipmentId: string): Promise<number> {
  const [paid, open] = await Promise.all([
    db.shipmentPaidLabel.count({ where: { shipmentRequestId: shipmentId } }),
    db.shipmentLabelAttempt.count({
      where: { shipmentRequestId: shipmentId, outcome: { in: ['pending', 'released_unverified'] }, paidLabels: { none: {} } },
    }),
  ]);
  return paid + open;
}

export type LabelLimit = 'reissue' | 'daily_spend';

export interface LabelLimitDials {
  capCents: number;
  reissueMax: number;
}

export interface LabelLimitVerdict {
  limit: LabelLimit | null;
  usedCents: number;
  paidLabels: number;
}

/** UN cuerpo (paso 2 de lectura y paso 7 que manda, bajo el candado consultivo). El dueño se lee de la BASE. */
export async function checkLabelLimits(
  db: Db,
  actorRow: OwnerCandidate,
  actorUserId: string,
  shipmentId: string,
  priceCents: number,
  now: Date,
  dials: LabelLimitDials,
): Promise<LabelLimitVerdict> {
  if (isOwnerAccount(actorRow)) return { limit: null, usedCents: 0, paidLabels: 0 };
  const paidLabels = await paidLabelsOf(db, shipmentId);
  if (paidLabels >= 1 + dials.reissueMax) return { limit: 'reissue', usedCents: 0, paidLabels };
  const usedCents = await labelSpend24h(db, actorUserId, now);
  if (usedCents + priceCents > dials.capCents) return { limit: 'daily_spend', usedCents, paidLabels };
  return { limit: null, usedCents, paidLabels };
}
