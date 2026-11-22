import type { SellItemPickupMethod, SellItemRejectionCode, SellItemRevisionState } from '@prisma/client';
import { BUYLIST_REVISION_RESPONSE_DAYS, rejectDeadlines } from './buylist-reject.constants';

/**
 * §BUYLIST-FLUJO F2c (docs/API_CONTRACT_BUYLIST_FLUJO.md §1, §3, §5) — proyecciones PURAS de la baja de precio y del recoger.
 * Sin Prisma, sin reloj propio: las comparten el DTO admin, el del vendedor, la cola `rejected-items` y el barrido.
 */

const DAY_MS = 24 * 3600 * 1000;

/** Los campos de la linea que estas proyecciones leen (todos opcionales: filas de mocks / lecturas parciales). */
export interface FlujoItemFields {
  itemStatus: string;
  offeredPriceCents?: number | null;
  approvedPriceCents?: number | null;
  rejectedAt?: Date | null;
  rejectionCode?: SellItemRejectionCode | null;
  revisionState?: SellItemRevisionState | null;
  revisedPriceCents?: number | null;
  revisionProposedAt?: Date | null;
  revisionRespondedAt?: Date | null;
  revisionReasonCode?: SellItemRejectionCode | null;
  revisionNote?: string | null;
  pickupMethod?: SellItemPickupMethod | null;
  pickupChosenAt?: Date | null;
  pickupDoneAt?: Date | null;
}

/** Vencimiento de una baja: `revisionProposedAt` + 7 d. Se DERIVA, no se guarda. */
export function revisionExpiresAt(proposedAt: Date): Date {
  return new Date(proposedAt.getTime() + BUYLIST_REVISION_RESPONSE_DAYS * DAY_MS);
}

/** El instante limite del barrido: una baja propuesta en o antes de esto ya vencio. UN solo calculo para lectura y escritura. */
export function revisionCutoff(now: Date): Date {
  return new Date(now.getTime() - BUYLIST_REVISION_RESPONSE_DAYS * DAY_MS);
}

/** Precio pactado FINAL de una linea: `approvedPriceCents` si hubo baja aceptada; si no, lo ofertado (DECISIONES.8c). */
export function agreedPriceCentsOf(i: FlujoItemFields): number | null {
  if (i.revisionState === 'accepted' && i.approvedPriceCents != null) return i.approvedPriceCents;
  return i.offeredPriceCents ?? null;
}

/** Texto de la causa para el VENDEDOR (nunca el codigo interno), en su idioma. */
export function revisionReasonText(code: SellItemRejectionCode | null | undefined, note: string | null | undefined, locale: string | null | undefined): string | null {
  const en = locale === 'en';
  if (code === 'condition_mismatch') {
    return en ? 'The card arrived in a different condition than declared' : 'La carta llegó en una condición distinta a la declarada';
  }
  if (code === 'wrong_card') {
    return en ? 'A different card than the declared one arrived' : 'Llegó una carta distinta a la declarada';
  }
  if (code === 'other') return note ?? null;
  return null;
}

export interface AdminRevisionDTO {
  state: SellItemRevisionState;
  proposedCents: number | null;
  previousCents: number | null;
  reasonCode: SellItemRejectionCode | null;
  note: string | null;
  proposedAt: Date | null;
  expiresAt: Date | null;
  respondedAt: Date | null;
}

export interface ClientRevisionDTO {
  state: SellItemRevisionState;
  proposedCents: number | null;
  previousCents: number | null;
  reasonText: string | null;
  proposedAt: Date | null;
  expiresAt: Date | null;
}

/** `revision` por linea (anexo §1). `null` si nunca hubo baja. El vendedor NO recibe `reasonCode` interno: solo `reasonText`. */
export function revisionDTOOf(
  i: FlujoItemFields,
  audience: 'admin' | 'client',
  opts: { locale?: string | null; redactMoney?: boolean } = {},
): AdminRevisionDTO | ClientRevisionDTO | null {
  if (!i.revisionState) return null;
  const money = (v: number | null | undefined) => (opts.redactMoney ? null : (v ?? null));
  const proposedAt = i.revisionProposedAt ?? null;
  const common = {
    state: i.revisionState,
    proposedCents: money(i.revisedPriceCents),
    previousCents: money(i.offeredPriceCents),
    proposedAt,
    expiresAt: proposedAt ? revisionExpiresAt(proposedAt) : null,
  };
  if (audience === 'admin') {
    return { ...common, reasonCode: i.revisionReasonCode ?? null, note: i.revisionNote ?? null, respondedAt: i.revisionRespondedAt ?? null };
  }
  return { ...common, reasonText: revisionReasonText(i.revisionReasonCode, i.revisionNote, opts.locale) };
}

export interface PickupDTO {
  method: SellItemPickupMethod | null;
  chosenAt: Date | null;
  doneAt: Date | null;
  returnDeadlineAt: Date | null;
  abandonDeadlineAt: Date | null;
}

/** `pickup` por linea (anexo §1): solo lineas `rechazada`, y `null` si `not_received` (la carta nunca llego). */
export function pickupDTOOf(i: FlujoItemFields): PickupDTO | null {
  if (i.itemStatus !== 'rechazada' || i.rejectionCode === 'not_received') return null;
  return {
    method: i.pickupMethod ?? null,
    chosenAt: i.pickupChosenAt ?? null,
    doneAt: i.pickupDoneAt ?? null,
    ...rejectDeadlines(i.rejectedAt),
  };
}
