/**
 * 💰 v1.80.8.6 (M-62, API_CONTRACT §M4-SHIP.18.12) — unitarias del «reembolso por revisar» y candados por ausencia.
 *
 *  - Paridad predicado ↔ `where` (`isRefundReviewPending` / `REFUND_REVIEW_PENDING_WHERE`) sobre las 4 combinaciones:
 *    «una sola función + su `where`, ⛔ nunca dos redacciones».
 *  - Proyección `FullRefundReviewDTO` (`null` sin sello; `pending` = el predicado).
 *  - SRF-13 por ausencia (criterio 253): ⛔ ningún correo nuevo (censo de plantillas) y ⛔ la máquina de envíos igual.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ShippedRefundReason } from '@prisma/client';
import {
  isRefundReviewPending,
  REFUND_REVIEW_PENDING_WHERE,
  toFullRefundReviewDTO,
} from '../src/modules/payments/refunds/refund-review';
import { stripComments } from './helpers/strip-comments';

/** Evalúa el `where` plano (igualdades) contra una fila, como lo haría Postgres. */
function matches(where: Record<string, unknown>, row: Record<string, unknown>): boolean {
  return Object.entries(where).every(([k, v]) => row[k] === v);
}

describe('«reembolso por revisar» — un predicado, dos formas, la MISMA respuesta', () => {
  const combos: { fullRefundAfterShipment: boolean; shippedRefundReason: ShippedRefundReason | null }[] = [];
  for (const after of [false, true]) for (const reason of [null, 'not_arrived', 'arrived_damaged'] as const) combos.push({ fullRefundAfterShipment: after, shippedRefundReason: reason });

  it.each(combos)('afterShipment=$fullRefundAfterShipment reason=$shippedRefundReason', (row) => {
    expect(matches(REFUND_REVIEW_PENDING_WHERE, row)).toBe(isRefundReviewPending(row));
  });

  it('solo `afterShipment ∧ sin motivo` está por revisar', () => {
    expect(combos.filter(isRefundReviewPending)).toEqual([{ fullRefundAfterShipment: true, shippedRefundReason: null }]);
  });

  it('el `where` tiene exactamente las dos columnas del predicado', () => {
    expect(REFUND_REVIEW_PENDING_WHERE).toEqual({ fullRefundAfterShipment: true, shippedRefundReason: null });
  });
});

describe('FullRefundReviewDTO', () => {
  const base = {
    fullRefundClosedAt: new Date('2026-10-04T10:00:00Z'),
    fullRefundAfterShipment: true,
    shippedRefundReason: null,
    shippedRefundNote: null,
    shippedRefundReasonAt: null,
    shippedRefundReasonBy: null,
  };
  it('sin sello ⇒ null', () => {
    expect(toFullRefundReviewDTO({ ...base, fullRefundClosedAt: null })).toBeNull();
  });
  it('por revisar', () => {
    expect(toFullRefundReviewDTO(base)).toEqual({ afterShipment: true, pending: true, reason: null, note: null, recordedAt: null, recordedBy: null });
  });
  it('registrado', () => {
    const at = new Date('2026-10-04T11:00:00Z');
    expect(
      toFullRefundReviewDTO({ ...base, shippedRefundReason: 'arrived_damaged', shippedRefundNote: 'n', shippedRefundReasonAt: at, shippedRefundReasonBy: { id: 'u1', name: 'Admin' } }),
    ).toEqual({ afterShipment: true, pending: false, reason: 'arrived_damaged', note: 'n', recordedAt: at.toISOString(), recordedBy: { id: 'u1', name: 'Admin' } });
  });
  it('cerrada sin salir ⇒ afterShipment false, no pendiente', () => {
    expect(toFullRefundReviewDTO({ ...base, fullRefundAfterShipment: false })).toMatchObject({ afterShipment: false, pending: false });
  });
});

describe('SRF-13 — por ausencia (criterio 253)', () => {
  const SRC = join(__dirname, '..', 'src');
  const files: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.ts') && !p.endsWith('.spec.ts')) files.push(p);
    }
  };
  walk(SRC);

  it('⛔ ningún correo nuevo: el censo de plantillas es el de antes de v1.80.8.6 (AV-3 sigue siendo el único aviso del reembolso total)', () => {
    const names = files
      .flatMap((f) => [...stripComments(readFileSync(f, 'utf8')).matchAll(/export (?:async )?function (\w+Template)\b/g)].map((m) => m[1]))
      .sort();
    expect(names).toEqual([
      'clabeChangedTemplate',
      'disputeRejectedTemplate',
      'disputeRepurchaseTemplate',
      'emailVerificationTemplate',
      'guestOrderConfirmationTemplate',
      'guestTrackingLinkTemplate',
      'kycRejectedTemplate',
      'manualRefundAnnouncedTemplate',
      'manualRefundPaidTemplate',
      'orderRefundedTemplate',
      'orderSettledTemplate',
      'passwordLockAlertTemplate',
      'passwordResetTemplate',
      'refundNoticeTemplate',
      'replacementPendingTemplate',
      'sellGuideTemplate',
      'sellItemRejectedTemplate',
      'sellOfferCancelledTemplate',
      'sellOfferReminderTemplate',
      'sellOfferTemplate',
      'sellPaidTemplate',
      'sellReceivedTemplate',
      'sellRequestExpiredTemplate',
      'sellRequestNotPursuedTemplate',
      'shipmentCancelledTemplate',
      'shipmentGuideTemplate',
      'shipmentShippedTemplate',
    ]);
  });

  it('⛔ la máquina de envíos no gana estados ni transiciones', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { ShipmentsService } = require('../src/modules/shipments/shipments.service');
    expect((ShipmentsService as unknown as { TRANSITIONS: unknown }).TRANSITIONS).toEqual({
      solicitado: ['picking', 'cancelado'],
      picking: ['guia'],
      guia: ['enviado'],
      enviado: ['entregado'],
      entregado: [],
      cancelado: [],
    });
  });

  it('⛔ el verbo nuevo no habla con Stripe, ni mueve piezas, ni manda correo (lectura del cuerpo)', () => {
    const src = readFileSync(join(SRC, 'modules/orders/order-refund.service.ts'), 'utf8');
    const body = stripComments(src.slice(src.indexOf('async recordShippedRefundReason('), src.indexOf('/** §M4-SHIP.18.10')));
    expect(body).not.toMatch(/executeRefund|createRows|stripe|inventoryItem|inventoryMovement|mail|notify/i);
  });
});
