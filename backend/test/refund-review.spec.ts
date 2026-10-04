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
import { ShipmentStatus, ShippedRefundReason } from '@prisma/client';
import {
  isRefundReviewPending,
  isShippedOut,
  lockShipmentsOfOrder,
  REFUND_REVIEW_PENDING_WHERE,
  SHIPPED_OUT_STATUSES,
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

/**
 * Techlead C-1 (2026-10-04) — «ya salió» es UNA regla: `SHIPPED_OUT_STATUSES` + `isShippedOut` + `lockShipmentsOfOrder`
 * en `refund-review.ts`, leídos por M3 tx1, `onFullRefund` (rama directo) y el detalle de M3. Si M3 y `onFullRefund`
 * leyeran listas distintas, M3 dejaría de pedir el motivo o la invariante de `onFullRefund` daría 500.
 */
describe('C-1 — «ya salió»: un predicado, un helper de candado, tres lectores', () => {
  it('`isShippedOut` sobre TODOS los estados del schema ⇒ solo enviado|entregado', () => {
    const all = Object.values(ShipmentStatus);
    expect(all.filter(isShippedOut).sort()).toEqual(['entregado', 'enviado']);
    expect([...SHIPPED_OUT_STATUSES].sort()).toEqual(all.filter(isShippedOut).sort());
  });

  const SRC = join(__dirname, '..', 'src');
  const READERS = ['modules/orders/order-refund.service.ts', 'modules/payments/refunds/full-refund.service.ts', 'modules/orders/admin-orders.controller.ts'];

  it.each(READERS)('%s usa `isShippedOut` y ⛔ no escribe la lista a mano (ni literal ni copia)', (rel) => {
    const code = stripComments(readFileSync(join(SRC, rel), 'utf8'));
    expect(code).toMatch(/\bisShippedOut\b/);
    expect(code).not.toMatch(/['"](?:enviado|entregado)['"]/);
    expect(code).not.toMatch(/SHIPPED_OUT_STATUSES\s*[:=]/); // usarla sí; ⛔ definir otra
  });

  it('M3 tx1 y `onFullRefund` bloquean los envíos de la orden con el MISMO helper; ⛔ ninguno importa la regla de un servicio', () => {
    for (const rel of READERS.slice(0, 2)) expect(stripComments(readFileSync(join(SRC, rel), 'utf8'))).toMatch(/\blockShipmentsOfOrder\(/);
    for (const rel of READERS) expect(readFileSync(join(SRC, rel), 'utf8')).not.toMatch(/import[^;]*\b(?:isShippedOut|SHIPPED_OUT_STATUSES|lockShipmentsOfOrder)\b[^;]*from '[^']*\.service'/);
  });

  it('`lockShipmentsOfOrder`: ids de la orden (id asc., salvo `exceptIds`), `FOR UPDATE`, y el estado leído BAJO el candado', async () => {
    const findMany = jest.fn(async () => [{ id: 'b' }, { id: 'c' }]);
    const queryRaw = jest.fn(async () => [
      { id: 'b', status: 'enviado' },
      { id: 'c', status: 'guia' },
    ]);
    const out = await lockShipmentsOfOrder({ shipmentRequest: { findMany }, $queryRaw: queryRaw } as never, 'o1', ['a']);
    expect(findMany).toHaveBeenCalledWith({ where: { orderId: 'o1', id: { notIn: ['a'] } }, select: { id: true }, orderBy: { id: 'asc' } });
    const [strings, ids] = queryRaw.mock.calls[0] as unknown as [TemplateStringsArray, string[]];
    expect(strings.join('?')).toMatch(/FROM "ShipmentRequest" WHERE id = ANY\(\?::text\[\]\) ORDER BY id FOR UPDATE/);
    expect(ids).toEqual(['b', 'c']);
    expect(out).toEqual([
      { id: 'b', status: 'enviado' },
      { id: 'c', status: 'guia' },
    ]);
  });

  it('`lockShipmentsOfOrder` sin envíos ⇒ [] y ⛔ ningún `FOR UPDATE`; sin `exceptIds` ⇒ toda la orden', async () => {
    const findMany = jest.fn(async () => []);
    const queryRaw = jest.fn();
    expect(await lockShipmentsOfOrder({ shipmentRequest: { findMany }, $queryRaw: queryRaw } as never, 'o1')).toEqual([]);
    expect(findMany).toHaveBeenCalledWith({ where: { orderId: 'o1' }, select: { id: true }, orderBy: { id: 'asc' } });
    expect(queryRaw).not.toHaveBeenCalled();
  });
});
