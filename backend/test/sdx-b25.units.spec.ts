/**
 * sdx-b25.units.spec.ts — errata v1.80.12.16 (API_CONTRACT §M4-SHIP.19.35), lado CUERPO de B-2 y B-3, y las dos notas de ux-ui
 * N-SDX-4 / N-SDX-5 (DESIGN_SYSTEM §43.22.10, contra §41.2, §41.4 y §41.7). Propiedad: backend.
 *
 *  - B-2 (§19.35.2/.3, PS-89 corregida y ampliada): `toCustomerTimeline` — la secuencia completa CON `shippedAt` son **7**; una
 *    guía Skydropx marcada `entregado` a mano ⇒ `delivered` con `at = deliveredAt`; con evento `delivered` ⇒ el del evento;
 *    ⛔ nunca dos `delivered`.
 *  - B-3 (§19.35.5 fila 1, PS-173 lado cuerpo): `countLabelAlerts` cuenta con `labelAlertOf` (el cuerpo del DTO) y nada más.
 *  - N-SDX-4: el CTA de `AV-4`/`AV-5` lleva el rótulo SEGÚN DESTINO (§41.4 filas 17/18), el mismo `ctaLabelOf` que AV-17/18/19.
 *  - N-SDX-5: `AV-5` con guía y sin paquetería ⇒ `Guía: <n>` (§41.7 ✏ del 18), sin hueco; los asuntos de `AV-4`/`AV-5` SIN
 *    prefijo de marca (§41.2 filas 17/18 ✏).
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { ShipmentRequest } from '@prisma/client';
import * as tpl from '../src/modules/shipments/mail/shipment-notice.templates';
import { toCustomerTimeline } from '../src/modules/shipments/customer-timeline';
import { countLabelAlerts, labelAlertShipmentIds } from '../src/modules/shipments/shipping-work-queue';
import { labelAlertOf } from '../src/modules/shipments/label-view';
import { T_CANCEL_MS, T_STUCK_MS } from '../src/modules/shipments/label-verify.constants';

// =================================================================================================== B-2
describe('B-2 (§19.35.2/.3) — `toCustomerTimeline`: 7 con `shipped`; `delivered` por `deliveredAt`; nunca dos', () => {
  const T = (m: number) => new Date(Date.UTC(2026, 9, 5, 10, m));
  const ev = (status: string, m: number, extra: Record<string, unknown> = {}) => ({
    status,
    occurredAt: T(m),
    branchName: null,
    providerShipmentId: 'ps-1',
    ...extra,
  });
  const sdx = (over: Record<string, unknown> = {}) =>
    ({ labelSource: 'skydropx', providerShipmentId: 'ps-1', shippedAt: null, deliveredAt: null, ...over }) as any;
  const SEQ = [ev('created', 1), ev('picked_up', 3), ev('last_mile', 4), ev('delivery_attempt', 5), ev('delivered_to_branch', 6, { branchName: 'Centro' }), ev('delivered', 7)];

  it('PS-89 (§19.35.2): la secuencia de 6 eventos con `shippedAt` puesto ⇒ 7 entradas, en orden de `at`', () => {
    const tl = toCustomerTimeline(SEQ as any, sdx({ shippedAt: T(2), deliveredAt: T(9) }));
    expect(tl).toHaveLength(7);
    expect(tl.map((x) => x.kind)).toEqual(['label_created', 'shipped', 'in_transit', 'out_for_delivery', 'delivery_attempt', 'at_branch', 'delivered']);
    // `deliveredAt` (la de la tienda, T9) NO añade otra: manda la del transportista (T7).
    expect(tl[6]).toEqual({ kind: 'delivered', at: T(7).toISOString() });
  });

  it('PS-89 amplía (§19.35.3 (2)): Skydropx con `created`, `in_transit` y `entregado` a mano ⇒ última `delivered` con `at = deliveredAt`', () => {
    const tl = toCustomerTimeline([ev('created', 1), ev('in_transit', 3)] as any, sdx({ shippedAt: T(2), deliveredAt: T(20) }));
    expect(tl.map((x) => x.kind)).toEqual(['label_created', 'shipped', 'in_transit', 'delivered']);
    expect(tl[tl.length - 1]).toEqual({ kind: 'delivered', at: T(20).toISOString() });
  });

  it('⛔ nunca dos: evento `delivered` + `deliveredAt` (la carrera de PS-75 (b)) ⇒ UNA, la del evento', () => {
    const tl = toCustomerTimeline([ev('in_transit', 3), ev('delivered', 5)] as any, sdx({ deliveredAt: T(8) }));
    expect(tl.filter((x) => x.kind === 'delivered')).toEqual([{ kind: 'delivered', at: T(5).toISOString() }]);
  });

  it('⛔ nunca dos: dos eventos `delivered` de la guía vigente ⇒ UNA, la primera', () => {
    const tl = toCustomerTimeline([ev('delivered', 5), ev('delivered', 6)] as any, sdx({ deliveredAt: T(8) }));
    expect(tl).toEqual([{ kind: 'delivered', at: T(5).toISOString() }]);
  });

  it('el `delivered` de una guía CANCELADA (otra `providerShipmentId`) no cuenta: la vigente sin evento ⇒ `deliveredAt`', () => {
    const tl = toCustomerTimeline([ev('delivered', 5, { providerShipmentId: 'ps-old' })] as any, sdx({ deliveredAt: T(8) }));
    expect(tl).toEqual([{ kind: 'delivered', at: T(8).toISOString() }]);
  });

  it('sin `deliveredAt` ni evento ⇒ sin `delivered` (no se inventa)', () => {
    expect(toCustomerTimeline([ev('in_transit', 3)] as any, sdx()).map((x) => x.kind)).toEqual(['in_transit']);
  });
});

// =================================================================================================== B-3
describe('B-3 (§19.35.5 fila 1) — `withLabelAlert` cuenta con `labelAlertOf` (el cuerpo del DTO), ⛔ ninguna segunda condición', () => {
  const now = new Date('2026-10-05T12:00:00Z');
  const t = now.getTime();
  const tUnknownMs = 15 * 60_000;
  const base = {
    status: 'guia',
    labelSource: 'skydropx',
    providerShipmentId: 'ps',
    providerCanceledAt: null,
    providerCancelConfirmedAt: null,
    labelProcessingSince: null,
    trackingNumber: 'T',
    carrierStatus: null,
    carrierStatusAt: null,
    labelPurchasedAt: null,
    rateChosenAt: null,
  };
  const rows: Record<string, Partial<ShipmentRequest>> = {
    live_on_cancelled: { ...base, status: 'cancelado' } as any,
    orphan: { ...base } as any,
    cancel_failed: { ...base, providerCanceledAt: new Date(t - T_CANCEL_MS) } as any,
    cancel_young: { ...base, providerCanceledAt: new Date(t - T_CANCEL_MS + 1000) } as any,
    unknown: { ...base, providerShipmentId: null, trackingNumber: null, labelProcessingSince: new Date(t - tUnknownMs) } as any,
    unknown_young: { ...base, providerShipmentId: null, trackingNumber: null, labelProcessingSince: new Date(t - tUnknownMs + 1000) } as any,
    stuck: { ...base, trackingNumber: null, labelProcessingSince: new Date(t - T_STUCK_MS) } as any,
    stuck_young: { ...base, trackingNumber: null, labelProcessingSince: new Date(t - T_STUCK_MS + 1000) } as any,
    stuck_and_carrier: { ...base, trackingNumber: null, labelProcessingSince: new Date(t - T_STUCK_MS), carrierStatus: 'exception' } as any,
    quiet: { ...base } as any,
  };
  const fakeDb = () => {
    const findMany = jest.fn(async () => Object.entries(rows).map(([id, r]) => ({ id, ...r })));
    const audit = jest.fn(async () => [
      { entityId: 'orphan', createdAt: new Date(t - 60_000) },
      { entityId: 'orphan', createdAt: new Date(t - 120_000) },
    ]);
    return { db: { shipmentRequest: { findMany }, auditLog: { findMany: audit } } as any, findMany, audit };
  };

  it('el juego con cada `LabelAlertKind`, uno justo por debajo de cada umbral y uno con las dos alertas ⇒ = filas con `labelAlertOf ≠ null`', async () => {
    const { db } = fakeDb();
    const ids = await labelAlertShipmentIds(db, now, tUnknownMs);
    expect(ids.sort()).toEqual(['cancel_failed', 'live_on_cancelled', 'orphan', 'stuck', 'stuck_and_carrier', 'unknown']);
    expect(await countLabelAlerts(db, now, tUnknownMs)).toBe(6);
    // Y es exactamente lo que dice el cuerpo del DTO, fila a fila.
    const orphanSince = new Map([['orphan', new Date(t - 60_000)]]);
    const byBody = Object.entries(rows)
      .filter(([id, r]) => labelAlertOf({ id, ...r } as any, now, null, { tUnknownMs, orphanSince: orphanSince.get(id) ?? null }) !== null)
      .map(([id]) => id)
      .sort();
    expect(ids.sort()).toEqual(byBody);
  });

  it('el reloj y `tUnknownMs` son los que se le pasan (un segundo después, los «jóvenes» entran)', async () => {
    const { db } = fakeDb();
    expect(await countLabelAlerts(db, new Date(t + 1000), tUnknownMs)).toBe(9);
  });

  it('las huérfanas se buscan en la ventana de 7 días del DTO, con la acción `shipment.label_orphan`', async () => {
    const { db, audit } = fakeDb();
    await countLabelAlerts(db, now, tUnknownMs);
    const arg = (audit.mock.calls[0] as any[])[0];
    expect(arg.where.action).toBe('shipment.label_orphan');
    expect(arg.where.createdAt.gt.getTime()).toBe(t - 7 * 24 * 3_600_000);
  });

  it('censo: `shipping-work-queue.ts` cuenta con `labelAlertOf` y ⛔ no importa umbrales propios', () => {
    const src = readFileSync(join(__dirname, '..', 'src', 'modules', 'shipments', 'shipping-work-queue.ts'), 'utf8');
    expect(src).toMatch(/labelAlertOf\(/);
    expect(src).not.toMatch(/T_UNKNOWN_MS|T_STUCK_MS|T_CANCEL_MS/);
  });
});

// =================================================================================================== N-SDX-4 / N-SDX-5
describe('N-SDX-4 / N-SDX-5 (DESIGN_SYSTEM §43.22.10) — `AV-4`/`AV-5`: rótulo según destino, sin hueco, asunto sin marca', () => {
  const saved = process.env.APP_PUBLIC_URL;
  beforeAll(() => {
    process.env.APP_PUBLIC_URL = 'https://app.test';
  });
  afterAll(() => {
    if (saved === undefined) delete process.env.APP_PUBLIC_URL;
    else process.env.APP_PUBLIC_URL = saved;
  });
  const order = { shipmentId: 'shp-1', orderNumber: 'TCG-000123', orderId: 'ord-1' };
  const vault = { shipmentId: 'shp-1', orderNumber: null };
  const guest = { ...order, customerUrl: 'https://app.test/es/pedido?token=abc' };
  const guide = (p: any, l: 'es' | 'en') => tpl.shipmentGuideTemplate({ ...p, carrier: 'Estafeta', trackingNumber: 'EST123' }, l);
  const shipped = (p: any, l: 'es' | 'en') => tpl.shipmentShippedTemplate(p, l);

  it.each([
    ['AV-4', 'es', guide, order, 'VER MI PEDIDO'],
    ['AV-4', 'en', guide, order, 'SEE MY ORDER'],
    ['AV-4', 'es', guide, guest, 'VER MI PEDIDO'],
    ['AV-4', 'es', guide, vault, 'VER MI ENVÍO'],
    ['AV-4', 'en', guide, vault, 'SEE MY SHIPMENT'],
    ['AV-5', 'es', shipped, order, 'VER MI PEDIDO'],
    ['AV-5', 'en', shipped, order, 'SEE MY ORDER'],
    ['AV-5', 'es', shipped, guest, 'VER MI PEDIDO'],
    ['AV-5', 'es', shipped, vault, 'VER MI ENVÍO'],
    ['AV-5', 'en', shipped, vault, 'SEE MY SHIPMENT'],
  ] as const)('N-SDX-4 [%s %s] el CTA dice el destino', (_av, l, render, p, label) => {
    const m = render(p as any, l);
    expect(m.text).toMatch(/https:\/\/app\.test\//); // hay CTA (con su URL de respaldo)
    expect(m.html).toContain(label);
    const other = label.includes('PEDIDO') || label.includes('ORDER') ? (l === 'en' ? 'SEE MY SHIPMENT' : 'VER MI ENVÍO') : l === 'en' ? 'SEE MY ORDER' : 'VER MI PEDIDO';
    expect(m.html).not.toContain(other);
  });

  it.each(['es', 'en'] as const)('N-SDX-5 [%s] AV-5 con guía y SIN paquetería ⇒ solo `Guía: <n>`, sin hueco', (l) => {
    const m = shipped({ ...order, carrier: null, trackingNumber: 'EST123' }, l);
    const want = l === 'en' ? 'Tracking: EST123' : 'Guía: EST123';
    for (const part of [m.html, m.text ?? '']) {
      expect(part).toContain(want);
      expect(part).not.toMatch(/Paqueter[ií]a:\s*·|Carrier:\s*·|Paqueter[ií]a:\s+·|Carrier:\s+·/);
      expect(part).not.toMatch(/Paqueter[ií]a:|Carrier:/);
    }
  });

  it.each(['es', 'en'] as const)('N-SDX-5 [%s] AV-5 con paquetería y guía ⇒ la línea completa, igual que antes', (l) => {
    const m = shipped({ ...order, carrier: 'Estafeta', trackingNumber: 'EST123' }, l);
    expect(m.text).toContain(l === 'en' ? 'Carrier: Estafeta · Tracking: EST123' : 'Paquetería: Estafeta · Guía: EST123');
  });

  it.each([
    ['es', 'Tu guía de envío', 'Tu paquete va en camino'],
    ['en', 'Your tracking number', 'Your package is on its way'],
  ] as const)('N-SDX-5 [%s] asuntos de AV-4/AV-5 SIN prefijo de marca (§41.2 filas 17/18)', (l, s4, s5) => {
    expect(guide(order, l).subject).toBe(s4);
    expect(shipped(order, l).subject).toBe(s5);
  });
});
