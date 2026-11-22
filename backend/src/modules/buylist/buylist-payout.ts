/**
 * §BUYLIST-FLUJO F1 (docs/API_CONTRACT_BUYLIST_FLUJO.md §1-§2) — funciones PURAS del neto a transferir y del reloj de estado.
 *
 * `computePayoutNetCents` es la UNICA fuente del neto: la leen el DTO de admin (`payout`) y `paySpei` (lo que sella en
 * `payoutNetCents`). Dos copias de la resta serian el defecto que este modulo ya pago caro (criterio 207).
 * Centavos enteros MXN; `net = max(0, bruto - envio)`; envio = `offerShippingFeeCents ?? 0` (filas pre-M-46: 0, D25);
 * bruto = `brutoConsumado` (approved ?? offerGross ?? quoted ?? 0).
 */
import { brutoConsumado } from '../../common/buylist-aml';

export interface PayoutMoneyRow {
  approvedTotalCents: number | null;
  offerGrossCents: number | null;
  quotedTotalCents: number | null;
  offerShippingFeeCents: number | null;
}

export interface PayoutAmounts {
  grossCents: number;
  shippingFeeCents: number;
  netCents: number;
}

export function computePayoutNetCents(r: {
  approvedTotalCents?: number | null;
  offerGrossCents?: number | null;
  quotedTotalCents?: number | null;
  offerShippingFeeCents?: number | null;
}): PayoutAmounts {
  const grossCents = brutoConsumado({
    approvedTotalCents: r.approvedTotalCents ?? null,
    offerGrossCents: r.offerGrossCents ?? null,
    quotedTotalCents: r.quotedTotalCents ?? null,
  });
  const shippingFeeCents = r.offerShippingFeeCents ?? 0;
  return { grossCents, shippingFeeCents, netCents: Math.max(0, grossCents - shippingFeeCents) };
}

export interface PayoutDTO extends PayoutAmounts {
  isFinal: boolean;
  clabeOnFile: boolean;
}

/**
 * `AdminBuylistDTO.payout`: proyeccion en `verificacion`/`aprobada`; en `pagada` lo SELLADO (`payoutNetCents`); resto `null`.
 * `clabeOnFile` es un booleano (nunca la CLABE).
 */
export function payoutDTOOf(
  r: PayoutMoneyRow & { status: string; payoutNetCents?: number | null },
  o: { lines: readonly ProjectionLine[]; clabeOnFile: boolean },
): PayoutDTO | null {
  if (r.status === 'verificacion' || r.status === 'aprobada') {
    // §3.1: la MISMA proyeccion que la vista previa y `netIfAcceptedCents` (rechazadas fuera, sin decidir al pactado, bajas a su propuesta).
    return { ...projectPayoutNetCents({ lines: o.lines, offerShippingFeeCents: r.offerShippingFeeCents, legacy: r }), clabeOnFile: o.clabeOnFile };
  }
  if (r.status === 'pagada') {
    const base = computePayoutNetCents(r);
    return { ...base, netCents: r.payoutNetCents ?? base.netCents, isFinal: true, clabeOnFile: o.clabeOnFile };
  }
  return null;
}

const DAY_MS = 86_400_000;
/** Abandono de la solicitud recibida: `receivedAt` + 30 d (politica existente, `buylist-reject.constants`). */
const REQUEST_ABANDON_DAYS = 30;

export interface StatusClockRow {
  status: string;
  createdAt: Date;
  offerSentAt?: Date | null;
  acceptedAt?: Date | null;
  shipmentConfirmedAt?: Date | null;
  receivedAt?: Date | null;
  verifiedAt?: Date | null;
  approvedAt?: Date | null;
  offerAcceptDeadlineAt?: Date | null;
  shipDeadlineAt?: Date | null;
  guideDueAt?: Date | null;
  paidAt?: Date | null;
  closedAt?: Date | null;
}

/**
 * `statusClock` (§1): `since` = marca que ya existe; `dueAt` = plazo existente del estado (sin umbrales nuevos);
 * `overdue = dueAt != null && now > dueAt`; `waitingDays` = dias naturales enteros (>= 0).
 */
export function statusClockOf(r: StatusClockRow, now: Date) {
  const since =
    (r.status === 'ofertada' && r.offerSentAt) ||
    (r.status === 'aceptada' && r.acceptedAt) ||
    (r.status === 'en_transito' && r.shipmentConfirmedAt) ||
    (r.status === 'recibida' && r.receivedAt) ||
    (r.status === 'verificacion' && r.verifiedAt) ||
    (r.status === 'aprobada' && r.approvedAt) ||
    (r.status === 'pagada' && r.paidAt) ||
    (['rechazada', 'abandonada', 'expirada'].includes(r.status) && r.closedAt) ||
    (r.createdAt ?? now);
  let dueAt: Date | null = null;
  switch (r.status) {
    case 'ofertada':
      dueAt = r.offerAcceptDeadlineAt ?? null;
      break;
    case 'aceptada':
      dueAt = r.shipDeadlineAt ?? r.guideDueAt ?? null;
      break;
    case 'recibida':
    case 'verificacion':
    case 'aprobada':
      dueAt = r.receivedAt ? new Date(r.receivedAt.getTime() + REQUEST_ABANDON_DAYS * DAY_MS) : null;
      break;
    default:
      dueAt = null;
  }
  const waitingDays = Math.max(0, Math.floor((now.getTime() - since.getTime()) / DAY_MS));
  return {
    since: since.toISOString(),
    waitingDays,
    dueAt: dueAt ? dueAt.toISOString() : null,
    overdue: dueAt != null && now.getTime() > dueAt.getTime(),
  };
}

/** Linea de la solicitud tal como la lee la proyeccion del neto (§3.1). */
export interface ProjectionLine {
  id: string;
  offerDecision?: string | null;
  itemStatus: string;
  offeredPriceCents?: number | null;
  approvedPriceCents?: number | null;
  revisionState?: string | null;
  revisedPriceCents?: number | null;
  rejectionCode?: string | null;
}

/**
 * §BUYLIST-FLUJO §3.2 — INVARIANTE `revisionState='pending' ⇔ itemStatus='ajustada'`: una baja pendiente es SOLO la que cumple las dos.
 * Un `pending` huerfano (linea ya aprobada/rechazada por otra via) no cuenta como baja viva en ningun lector.
 */
export function hasLivePendingRevision(i: { itemStatus: string; revisionState?: string | null }): boolean {
  return i.revisionState === 'pending' && i.itemStatus === 'ajustada';
}

const VERDICT_ITEM_STATUSES = ['aprobada', 'rechazada', 'convertida_inventario', 'pagada'];

export interface ProjectedPayout extends PayoutAmounts {
  isFinal: boolean;
}

/**
 * §BUYLIST-FLUJO §3.1 — **UNA sola funcion** del neto proyectado: vista previa de `revise-price`, `revision.netIfAcceptedCents`
 * (derivado al leer, no guardado) y `payout` en revision/aprobada. ⛔ ninguna otra suma de lineas.
 * Por linea `buy`: rechazada / `skip` / `not_received` ⇒ fuera; aceptada (`aprobada`/`convertida`/`pagada`) ⇒ `approvedPriceCents`;
 * baja viva (`pending ∧ ajustada`) ⇒ `revisedPriceCents`; sin decidir ⇒ `offeredPriceCents` (pactado). `net = max(0, bruto − envio)`.
 * `override` (solo vista previa): esa linea al precio tecleado. `isFinal` ⇔ ninguna linea (las OTRAS, en vista previa) sin decidir
 * ni con baja viva. Solicitud sin ninguna linea `buy` (pre-ciclo): cae a `computePayoutNetCents(legacy)` y `isFinal=true`.
 */
export function projectPayoutNetCents(
  r: { lines: readonly ProjectionLine[]; offerShippingFeeCents?: number | null; legacy?: PayoutMoneyRow | Parameters<typeof computePayoutNetCents>[0] },
  override?: { itemId: string; priceCents: number },
): ProjectedPayout {
  const buys = r.lines.filter((l) => l.offerDecision === 'buy');
  if (buys.length === 0 && !override) {
    return { ...computePayoutNetCents({ ...(r.legacy ?? {}), offerShippingFeeCents: r.offerShippingFeeCents ?? null }), isFinal: true };
  }
  let gross = 0;
  let isFinal = true;
  for (const l of buys) {
    if (override && l.id === override.itemId) {
      gross += override.priceCents;
      continue;
    }
    if (l.itemStatus === 'rechazada' || l.rejectionCode === 'not_received') continue;
    if (VERDICT_ITEM_STATUSES.includes(l.itemStatus)) {
      gross += l.approvedPriceCents ?? l.offeredPriceCents ?? 0;
    } else if (hasLivePendingRevision(l)) {
      gross += l.revisedPriceCents ?? l.offeredPriceCents ?? 0;
      isFinal = false;
    } else {
      gross += l.offeredPriceCents ?? 0;
      isFinal = false;
    }
  }
  if (override && !buys.some((l) => l.id === override.itemId)) gross += override.priceCents;
  const shippingFeeCents = r.offerShippingFeeCents ?? 0;
  return { grossCents: gross, shippingFeeCents, netCents: Math.max(0, gross - shippingFeeCents), isFinal };
}
