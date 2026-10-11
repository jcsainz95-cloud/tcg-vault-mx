/**
 * sdx-b6.units.spec.ts — errata v1.80.12.17, B-6 (API_CONTRACT §M4-SHIP.19.36.2 (2)): `shipped.at` de la línea de tiempo del
 * cliente = `min(shippedAt, primer occurredAt de un MOVIMIENTO del transportista en la guía vigente)`. Propiedad: backend.
 * Movimiento = `KIND_OF ∈ {in_transit, out_for_delivery, delivery_attempt, at_branch, delivered}` (⛔ ni `created` ni los no
 * mapeados). Empate ⇒ `shipped` primero. ⛔ `shippedAt` (la entrada) no se toca. Guía manual ⇒ sin cambio.
 */
import { toCustomerTimeline } from '../src/modules/shipments/customer-timeline';

describe('B-6 (§19.36.2 (2)) — `shipped.at` acotado por el primer movimiento del transportista', () => {
  const T0 = Date.UTC(2026, 9, 5, 8, 0);
  const at = (minutes: number) => new Date(T0 + minutes * 60_000);
  const iso = (minutes: number) => at(minutes).toISOString();
  const ev = (status: string, minutes: number, extra: Record<string, unknown> = {}) => ({
    status,
    occurredAt: at(minutes),
    branchName: null,
    providerShipmentId: 'ps-1',
    ...extra,
  });
  const sdx = (over: Record<string, unknown> = {}) =>
    ({ labelSource: 'skydropx', providerShipmentId: 'ps-1', shippedAt: null, deliveredAt: null, ...over }) as any;
  const C = [ev('created', 0), ev('picked_up', 60), ev('delivered_to_branch', 180)];

  it('PS-89 (c): `created` T, `picked_up` T+1h, `delivered_to_branch` T+3h, `shippedAt` T+5h ⇒ shipped T+1h, antes de in_transit', () => {
    const shipment = sdx({ shippedAt: at(300) });
    const tl = toCustomerTimeline(C as any, shipment);
    expect(tl).toEqual([
      { kind: 'label_created', at: iso(0) },
      { kind: 'shipped', at: iso(60) },
      { kind: 'in_transit', at: iso(60) },
      { kind: 'at_branch', at: iso(180) },
    ]);
    // ⛔ La fila no cambia (la leen AV-5, «Salida de hoy» y el P&L).
    expect(shipment.shippedAt).toEqual(at(300));
  });

  it('PS-89 (c): `shippedAt` T+30min (antes del primer movimiento) ⇒ shipped T+30min, sin cambio', () => {
    const tl = toCustomerTimeline(C as any, sdx({ shippedAt: at(30) }));
    expect(tl.map((e) => [e.kind, e.at])).toEqual([
      ['label_created', iso(0)],
      ['shipped', iso(30)],
      ['in_transit', iso(60)],
      ['at_branch', iso(180)],
    ]);
  });

  it('⛔ `created` no es movimiento: solo `created` T y `shippedAt` T+5h ⇒ shipped T+5h', () => {
    const tl = toCustomerTimeline([ev('created', 0)] as any, sdx({ shippedAt: at(300) }));
    expect(tl).toEqual([
      { kind: 'label_created', at: iso(0) },
      { kind: 'shipped', at: iso(300) },
    ]);
  });

  it('⛔ los no mapeados (`exception`, `retained`) no acotan', () => {
    const tl = toCustomerTimeline([ev('created', 0), ev('exception', 10), ev('retained', 20)] as any, sdx({ shippedAt: at(300) }));
    expect(tl.find((e) => e.kind === 'shipped')).toEqual({ kind: 'shipped', at: iso(300) });
  });

  it.each([
    ['last_mile', 'out_for_delivery'],
    ['delivery_attempt', 'delivery_attempt'],
    ['delivered', 'delivered'],
    ['in_transit', 'in_transit'],
    ['delivered_to_branch', 'at_branch'],
  ])('cada movimiento acota: `%s` a T+2h y `shippedAt` T+5h ⇒ shipped T+2h, justo antes de `%s`', (status, kind) => {
    const tl = toCustomerTimeline([ev(status, 120)] as any, sdx({ shippedAt: at(300) }));
    expect(tl.slice(0, 2)).toEqual([
      { kind: 'shipped', at: iso(120) },
      { kind, at: iso(120) },
    ]);
  });

  it('el movimiento de OTRA guía (cancelada) no acota', () => {
    const tl = toCustomerTimeline([ev('picked_up', 60, { providerShipmentId: 'ps-old' })] as any, sdx({ shippedAt: at(300) }));
    expect(tl).toEqual([{ kind: 'shipped', at: iso(300) }]);
  });

  it('guía manual con `shippedAt` y `deliveredAt` ⇒ sin cambio (no hay eventos que lean)', () => {
    const tl = toCustomerTimeline([ev('picked_up', 60)] as any, { labelSource: 'manual', providerShipmentId: null, shippedAt: at(300), deliveredAt: at(600) });
    expect(tl).toEqual([
      { kind: 'shipped', at: iso(300) },
      { kind: 'delivered', at: iso(600) },
    ]);
  });
});
