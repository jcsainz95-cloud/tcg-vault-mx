import type { HoldingDTO, WithdrawableReason } from '@/types/contract';

/**
 * MOCK de la regla ÚNICA de elegibilidad de `GET /vault/holdings` (contrato §3, ⭐ v1.80.7): `withdrawable`
 * y `withdrawableReason` salen del MISMO cuerpo, evaluado en este orden (la primera condición que falla
 * nombra el motivo), como en `vault.service`:
 *
 *   `pending` ⇔ `ownershipStatus ≠ 'settled'` · `replacing` ⇔ `status ≠ 'in_custody'` ∧ caso abierto ·
 *   `not_in_custody` ⇔ `status ≠ 'in_custody'` sin caso · `in_withdrawal` ⇔ `shipmentState ≠ null` ·
 *   `origin_refunded` ⇔ la compra de origen se está reembolsando.
 *
 * Invariante (candado unitario): **`withdrawable === (withdrawableReason === null)`**. ⛔ Es la proyección de
 * los rechazos de `classifyItems`, no una segunda regla — por eso hay UNA función y no dos.
 */
export interface WithdrawabilityInput {
  ownershipStatus: HoldingDTO['ownershipStatus'];
  status: HoldingDTO['status'];
  shipmentState: HoldingDTO['shipmentState'];
  /** Caso «Por reponer» ABIERTO sobre la pieza (`replacement.status === 'open'`). */
  replacementOpen: boolean;
  /** Fila `order_full` viva (`requested|submitted`) sobre la compra de origen (SEC-SHIP-A5 (b)). */
  originRefunded: boolean;
}

export function withdrawableReasonOf(i: WithdrawabilityInput): WithdrawableReason {
  if (i.ownershipStatus !== 'settled') return 'pending';
  if (i.status !== 'in_custody') return i.replacementOpen ? 'replacing' : 'not_in_custody';
  if (i.shipmentState !== null) return 'in_withdrawal';
  if (i.originRefunded) return 'origin_refunded';
  return null;
}

export function withdrawabilityOf(i: WithdrawabilityInput): Pick<HoldingDTO, 'withdrawable' | 'withdrawableReason'> {
  const withdrawableReason = withdrawableReasonOf(i);
  return { withdrawable: withdrawableReason === null, withdrawableReason };
}
