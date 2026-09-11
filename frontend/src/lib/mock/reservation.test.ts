import { describe, it, expect, beforeEach } from 'vitest';
import {
  MOCK_FIXTURE_PENDING_ORDER_ID,
  MOCK_PI_STATE_KEY,
  commitMockSession,
  decideMockSession,
  liveMockReservations,
  mockOrderSuperseded,
  mockReservationFor,
  mockReservedByOthers,
  resetMockReservations,
  settleMockReservation,
  type MockCaller,
} from './reservation';

/**
 * El simulador de §4-R reproduce la TABLA DE DECISIÓN del contrato (v1.68, §4-R.2/§4-R.3) — las
 * cinco filas — y sus reglas observables: reuso sin escritura nueva, sustitución que libera lo
 * propio, `PAYMENT_IN_PROGRESS` con cero escritura, y el invitado que solo reclama con token.
 */
const C: MockCaller = { kind: 'customer', userId: 'u-c' };
const D: MockCaller = { kind: 'customer', userId: 'u-d' };

function create(caller: MockCaller, ids: string[], token: string | null = null, email: string | null = null) {
  const decision = decideMockSession(ids, caller);
  const orderId = `o-${Math.random().toString(36).slice(2, 7)}`;
  const created = commitMockSession(decision, {
    orderId,
    orderNumber: `TCG-${orderId}`,
    inventoryItemIds: ids,
    paymentIntentId: `pi_${orderId}`,
    userId: caller.kind === 'customer' ? caller.userId : null,
    checkoutToken: token,
    guestEmail: email,
  });
  return { decision, created };
}

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
  resetMockReservations();
});

describe('lib/mock/reservation · tabla de §4-R.2 (cuenta)', () => {
  it('sin reserva propia ⇒ new; mismo carrito ⇒ reuse con la MISMA orden y PI y TTL renovado', () => {
    const first = create(C, ['x']);
    expect(first.decision.kind).toBe('new');
    const again = decideMockSession(['x'], C);
    expect(again.kind).toBe('reuse');
    if (again.kind !== 'reuse') return;
    expect(again.reservation.orderId).toBe(first.created!.orderId);
    expect(again.reservation.paymentIntentId).toBe(first.created!.paymentIntentId);
    const before = first.created!.reservedUntil;
    const renewed = commitMockSession(again, null, Date.now() + 5 * 60_000);
    expect(new Date(renewed!.reservedUntil).getTime()).toBeGreaterThan(new Date(before).getTime());
    // Una sola orden pending de C.
    expect(liveMockReservations().filter((r) => r.userId === 'u-c' && !r.fixture)).toHaveLength(1);
  });

  it('carrito distinto ⇒ supersede: la vieja se libera y queda `failed`; la nueva reserva ambas piezas', () => {
    const o1 = create(C, ['x']).created!;
    const second = create(C, ['x', 'y']);
    expect(second.decision.kind).toBe('supersede');
    if (second.decision.kind !== 'supersede') return;
    expect(second.decision.superseded.map((r) => r.orderId)).toEqual([o1.orderId]);
    expect(mockOrderSuperseded(o1.orderId)).toBe(true);
    const live = liveMockReservations().filter((r) => !r.fixture);
    expect(live).toHaveLength(1);
    expect(live[0].inventoryItemIds).toEqual(['x', 'y']);
  });

  it('PI viejo no cancelable (dial `processing`) ⇒ payment_in_progress con la orden vieja y CERO escritura', () => {
    const o1 = create(C, ['x']).created!;
    window.localStorage.setItem(MOCK_PI_STATE_KEY, 'processing');
    const d = decideMockSession(['x', 'y'], C);
    expect(d.kind).toBe('payment_in_progress');
    if (d.kind !== 'payment_in_progress') return;
    expect(d.order.orderId).toBe(o1.orderId);
    expect(liveMockReservations().filter((r) => !r.fixture)).toHaveLength(1);
    expect(mockOrderSuperseded(o1.orderId)).toBe(false);
    // Y el reuso exacto sigue funcionando aunque el dial esté puesto (no hay nada que cancelar).
    expect(decideMockSession(['x'], C).kind).toBe('reuse');
  });

  it('reserva AJENA ⇒ unavailable para D (R-1) y el quote de D la lista como no disponible', () => {
    create(C, ['x']);
    const d = decideMockSession(['x'], D);
    expect(d.kind).toBe('unavailable');
    if (d.kind !== 'unavailable') return;
    expect(d.inventoryItemIds).toEqual(['x']);
    expect(mockReservedByOthers(['x', 'z'], D)).toEqual(['x']);
    expect(mockReservedByOthers(['x'], C)).toEqual([]);
  });

  it('el pedido pending de fixtures se siembra como reserva propia de la cuenta y NO bloquea a terceros', () => {
    const own = mockReservationFor(MOCK_FIXTURE_PENDING_ORDER_ID, 'u-c');
    expect(own?.fixture).toBe(true);
    expect(own?.inventoryItemIds).toEqual(['inv-1002']);
    // Reanudar: C vuelve con exactamente esas piezas ⇒ reuse del pedido de fixtures.
    const d = decideMockSession(['inv-1002'], C);
    expect(d.kind).toBe('reuse');
    if (d.kind === 'reuse') expect(d.reservation.orderId).toBe(MOCK_FIXTURE_PENDING_ORDER_ID);
    // …pero un invitado o D no la ven como ajena (fidelidad acotada, documentada en el módulo).
    expect(mockReservedByOthers(['inv-1002'], { kind: 'guest', email: 'x@y.z' })).toEqual([]);
    expect(decideMockSession(['inv-1002'], D).kind).toBe('new');
  });

  it('settle: tras pagar, la reserva deja de ser viva', () => {
    const o1 = create(C, ['x']).created!;
    settleMockReservation(o1.orderId);
    expect(decideMockSession(['x'], C).kind).toBe('new');
  });
});

describe('lib/mock/reservation · invitado (§4-R.3, R-7)', () => {
  const G = (token?: string, email = 'g@x.mx'): MockCaller => ({ kind: 'guest', email, retryOfCheckoutToken: token });

  it('reclama SOLO con su token y su correo; sin token o con otro correo ⇒ unavailable', () => {
    create(G(), ['x'], 'tok-1', 'g@x.mx');
    expect(decideMockSession(['x'], G('tok-1')).kind).toBe('reuse');
    expect(decideMockSession(['x'], G()).kind).toBe('unavailable');
    expect(decideMockSession(['x'], G('tok-otro')).kind).toBe('unavailable');
    expect(decideMockSession(['x'], G('tok-1', 'otra@x.mx')).kind).toBe('unavailable');
    // Y una cuenta tampoco puede reclamar la reserva del invitado.
    expect(decideMockSession(['x'], C).kind).toBe('unavailable');
  });

  it('el reuso registra el token nuevo como llave vigente (rotate: false ⇒ el viejo deja de reclamar en el simulador)', () => {
    create(G(), ['x'], 'tok-1', 'g@x.mx');
    const d = decideMockSession(['x'], G('tok-1'));
    expect(d.kind).toBe('reuse');
    const r = commitMockSession(d, {
      orderId: 'ignored',
      orderNumber: 'ignored',
      inventoryItemIds: ['x'],
      paymentIntentId: 'ignored',
      userId: null,
      checkoutToken: 'tok-2',
      guestEmail: 'g@x.mx',
    });
    expect(r?.checkoutToken).toBe('tok-2');
    expect(decideMockSession(['x'], G('tok-2')).kind).toBe('reuse');
  });
});
