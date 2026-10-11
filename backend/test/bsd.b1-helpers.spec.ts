/**
 * bsd.b1-helpers.spec.ts — 💰 rev BSD-1, paso B-1 (API_CONTRACT §BSD.3, §BSD.4.7, §BSD.4.8): las tres piezas que B-2 y B-3
 * usan como costura, probadas en unidad con un doble de Prisma que respeta la semántica del `where`.
 *
 *  - `labelSubjectOf` (§BSD.3): la política por clase, fail-closed ante un `kind` desconocido.
 *  - `closeInboundShipment` (§BSD.4.8, I-BSD-1): orden de candados (I-BSD-4), `close` vs `shipped`, y su resultado.
 *  - `needsGuideCancelTask` (§BSD.4.8 / §BSD.7.3): la tarea SOLO con guía manual o `live`.
 *  - `writeSellRequestGuide` (§BSD.4.7): la guarda en el `WHERE`, el plazo solo si era nulo, el sello por valor y la guarda
 *    extra de `source='skydropx'`.
 */
import { addBusinessDays } from '../src/common/business-days';
import { closeInboundShipment, needsGuideCancelTask } from '../src/modules/shipments/inbound-close';
import { OUTBOUND_ONLY, isBuylistInbound, labelSubjectOf, outboundOnlySql } from '../src/modules/shipments/label-subject';
import { writeSellRequestGuide } from '../src/modules/buylist/sell-request-guide';
import { matchesWhere } from './helpers/prisma-where';

type Row = Record<string, any>;

/** Un `tx` de Prisma mínimo sobre UNA solicitud y (opcional) UNA fila de entrada; registra el orden de los candados. */
function world(sr: Row, ship: Row | null) {
  const locks: string[] = [];
  const tx: any = {
    $queryRaw: jest.fn(async (strings: TemplateStringsArray, ...vals: unknown[]) => {
      const sql = strings.join('?');
      if (/FROM "SellRequest" WHERE id = \? FOR UPDATE/.test(sql)) {
        locks.push(`SellRequest:${String(vals[0])}`);
        return [{ id: sr.id }];
      }
      if (/FROM "ShipmentRequest" WHERE "sellRequestId" = \? FOR UPDATE/.test(sql)) {
        locks.push(`ShipmentRequest:sr=${String(vals[0])}`);
        return ship && ship.sellRequestId === vals[0] ? [{ id: ship.id }] : [];
      }
      throw new Error(`SQL no esperado: ${sql}`);
    }),
    sellRequest: {
      findUnique: jest.fn(async ({ where }: any) => (where.id === sr.id ? { ...sr } : null)),
      updateMany: jest.fn(async ({ where, data }: any) => {
        if (!matchesWhere(sr, where)) return { count: 0 };
        Object.assign(sr, data);
        return { count: 1 };
      }),
    },
    shipmentRequest: {
      findUnique: jest.fn(async ({ where }: any) => (ship && where.id === ship.id ? { ...ship } : null)),
      updateMany: jest.fn(async ({ where, data }: any) => {
        if (!ship || !matchesWhere(ship, where)) return { count: 0 };
        Object.assign(ship, data);
        return { count: 1 };
      }),
    },
  };
  return { tx, locks };
}

const inbound = (over: Row = {}): Row => ({
  id: 'shp-1',
  kind: 'buylist_inbound',
  sellRequestId: 'sr-1',
  status: 'solicitado',
  labelSource: null,
  providerShipmentId: null,
  providerCanceledAt: null,
  providerCancelReason: null,
  carrierStatus: null,
  labelProcessingSince: null,
  ...over,
});
const liveGuide = { status: 'guia', labelSource: 'skydropx', providerShipmentId: 'sdx-9', carrierStatus: 'created' };

describe('label-subject (§BSD.3) — la política por clase', () => {
  it('outbound: picking → guia → (re-emisión) picking; AV-4; AG-1/AG-10/sondeo sí; sin candado de la solicitud', () => {
    const s = labelSubjectOf({ kind: 'outbound', sellRequestId: null });
    expect(s).toMatchObject({ openStatus: 'picking', labeledStatus: 'guia', closedStatus: 'cancelado', reissueStatus: 'picking' });
    expect(s).toMatchObject({ locksSellRequestFirst: false, labelNotice: 'AV-4', alertsAfterAddressFix: true, inTrackingPoll: true, labelNotShippedWatch: true });
  });

  it('buylist_inbound: solicitado → guia → (re-emisión) solicitado; AV-7; ⛔ AG-1/AG-10/sondeo; candado SR→ShR', () => {
    const s = labelSubjectOf({ kind: 'buylist_inbound', sellRequestId: 'sr-1' });
    expect(s).toMatchObject({ sellRequestId: 'sr-1', openStatus: 'solicitado', labeledStatus: 'guia', closedStatus: 'cancelado', reissueStatus: 'solicitado' });
    expect(s).toMatchObject({ locksSellRequestFirst: true, labelNotice: 'AV-7', alertsAfterAddressFix: false, inTrackingPoll: false, labelNotShippedWatch: false });
    expect(isBuylistInbound({ kind: 'buylist_inbound' })).toBe(true);
    expect(isBuylistInbound({ kind: 'outbound' })).toBe(false);
  });

  it('fail-closed: un kind desconocido o una entrada sin solicitud LANZAN (⛔ nunca caen en la rama de salida)', () => {
    expect(() => labelSubjectOf({ kind: 'zzz' as never, sellRequestId: null })).toThrow(/kind desconocido/);
    expect(() => labelSubjectOf({ kind: 'buylist_inbound', sellRequestId: null })).toThrow(/sin sellRequestId/);
  });

  it('OUTBOUND_ONLY / outboundOnlySql: el filtro de los lectores del censo BSD-B23', () => {
    expect(OUTBOUND_ONLY).toEqual({ kind: 'outbound' });
    expect(outboundOnlySql().sql).toBe(`"kind"::text = 'outbound'`);
    expect(outboundOnlySql('s').sql).toBe(`s."kind"::text = 'outbound'`);
  });
});

describe('closeInboundShipment (§BSD.4.8, I-BSD-1)', () => {
  const sr = (): Row => ({ id: 'sr-1', status: 'expirada' });

  it('sin fila de entrada ⇒ none, y aun así toma el candado de la solicitud ANTES de buscar la fila (I-BSD-4)', async () => {
    const { tx, locks } = world(sr(), null);
    await expect(closeInboundShipment(tx, 'sr-1', 'close')).resolves.toEqual({ shipmentId: null, outcome: 'none', liveSkydropxGuide: false, rowCancelled: false });
    expect(locks).toEqual(['SellRequest:sr-1', 'ShipmentRequest:sr=sr-1']);
  });

  it("close + fila en solicitado sin guía ⇒ cancelado, outcome none", async () => {
    const ship = inbound();
    const { tx, locks } = world(sr(), ship);
    const r = await closeInboundShipment(tx, 'sr-1', 'close');
    expect(r).toEqual({ shipmentId: 'shp-1', outcome: 'none', liveSkydropxGuide: false, rowCancelled: true });
    expect(ship.status).toBe('cancelado');
    expect(locks[0]).toBe('SellRequest:sr-1');
  });

  it("close + guía viva de Skydropx sin movimiento ⇒ cancelado y sellada `auto_close` (el MISMO cuerpo de los reembolsos)", async () => {
    const ship = inbound(liveGuide);
    const now = new Date('2026-10-06T12:00:00Z');
    const { tx } = world(sr(), ship);
    const r = await closeInboundShipment(tx, 'sr-1', 'close', now);
    expect(r).toEqual({ shipmentId: 'shp-1', outcome: 'sealed', liveSkydropxGuide: true, rowCancelled: true });
    expect(ship).toMatchObject({ status: 'cancelado', providerCanceledAt: now, providerCancelReason: 'auto_close' });
  });

  it("close + paquete ya en movimiento ⇒ live (⛔ no se sella)", async () => {
    const ship = inbound({ ...liveGuide, carrierStatus: 'in_transit' });
    const { tx } = world(sr(), ship);
    const r = await closeInboundShipment(tx, 'sr-1', 'close');
    expect(r.outcome).toBe('live');
    expect(ship.providerCanceledAt).toBeNull();
  });

  it("close + compra en vuelo ⇒ cancelado, outcome in_flight (lo resuelve casZero rama 3)", async () => {
    const ship = inbound({ labelProcessingSince: new Date() });
    const { tx } = world(sr(), ship);
    const r = await closeInboundShipment(tx, 'sr-1', 'close');
    expect(r).toMatchObject({ outcome: 'in_flight', rowCancelled: true });
    expect(ship.status).toBe('cancelado');
  });

  it("shipped + fila en solicitado ⇒ cancelado; shipped + guía ⇒ ⛔ no se toca (es la que viaja)", async () => {
    const a = inbound();
    const w1 = world(sr(), a);
    expect(await closeInboundShipment(w1.tx, 'sr-1', 'shipped')).toMatchObject({ outcome: 'none', rowCancelled: true });
    expect(a.status).toBe('cancelado');

    const b = inbound(liveGuide);
    const w2 = world(sr(), b);
    expect(await closeInboundShipment(w2.tx, 'sr-1', 'shipped')).toEqual({ shipmentId: 'shp-1', outcome: 'none', liveSkydropxGuide: true, rowCancelled: false });
    expect(b.status).toBe('guia');
    expect(b.providerCanceledAt).toBeNull();
  });

  it("shipped + compra en vuelo ⇒ cancelado, in_flight", async () => {
    const ship = inbound({ labelProcessingSince: new Date() });
    const { tx } = world(sr(), ship);
    expect(await closeInboundShipment(tx, 'sr-1', 'shipped')).toMatchObject({ outcome: 'in_flight', rowCancelled: true });
  });
});

describe('needsGuideCancelTask (§BSD.4.8 / §BSD.7.3) — la tarea «cancelar guía no usada»', () => {
  it('guía MANUAL (número en la solicitud, sin guía viva de entrada) ⇒ tarea, como hoy (criterio 549)', () => {
    expect(needsGuideCancelTask({ shipmentTrackingNumber: 'MAN-1' }, { outcome: 'none', liveSkydropxGuide: false })).toBe(true);
  });
  it('guía de Skydropx sellada ⇒ ⛔ sin tarea (la cancela el post-commit)', () => {
    expect(needsGuideCancelTask({ shipmentTrackingNumber: 'SDX-1' }, { outcome: 'sealed', liveSkydropxGuide: true })).toBe(false);
  });
  it("resultado `live` ⇒ tarea", () => {
    expect(needsGuideCancelTask({ shipmentTrackingNumber: 'SDX-1' }, { outcome: 'live', liveSkydropxGuide: true })).toBe(true);
  });
  it('sin número y sin guía ⇒ sin tarea; tarea ya hecha ⇒ sin tarea', () => {
    expect(needsGuideCancelTask({ shipmentTrackingNumber: null }, { outcome: 'none', liveSkydropxGuide: false })).toBe(false);
    expect(needsGuideCancelTask({ shipmentTrackingNumber: 'MAN-1', guideCancellationDoneAt: new Date() }, { outcome: 'live', liveSkydropxGuide: false })).toBe(false);
  });
});

describe('writeSellRequestGuide (§BSD.4.7) — UN cuerpo, extraído de adminGuide', () => {
  const NOW = new Date('2026-10-05T15:00:00Z'); // lunes
  const base = (over: Row = {}): Row => ({
    id: 'sr-1',
    status: 'aceptada',
    closedAt: null,
    shipmentCarrier: null,
    shipmentTrackingNumber: null,
    guideSentAt: null,
    shipDeadlineAt: null,
    guideNoticeSentAt: null,
    ...over,
  });

  it('primera guía: escribe par, guideSentAt, plazo = addBusinessDays(now, días) y limpia el sello', async () => {
    const sr = base({ guideNoticeSentAt: new Date('2026-10-01') });
    const { tx } = world(sr, null);
    expect(await writeSellRequestGuide(tx, 'sr-1', ' DHL ', ' 123 ', NOW, 'manual', 3)).toEqual({ count: 1 });
    expect(sr).toMatchObject({ shipmentCarrier: 'DHL', shipmentTrackingNumber: '123', guideSentAt: NOW, shipDeadlineAt: addBusinessDays(NOW, 3), guideNoticeSentAt: null });
  });

  it('re-captura del MISMO número ⇒ count 1, ⛔ no limpia el sello; número distinto ⇒ limpia; el plazo ya fijado NO se mueve', async () => {
    const deadline = new Date('2026-10-08T15:00:00Z');
    const seal = new Date('2026-10-05T16:00:00Z');
    const sr = base({ shipmentCarrier: 'DHL', shipmentTrackingNumber: '123', shipDeadlineAt: deadline, guideNoticeSentAt: seal });
    const { tx } = world(sr, null);
    expect(await writeSellRequestGuide(tx, 'sr-1', 'DHL', '123', NOW, 'manual', 3)).toEqual({ count: 1 });
    expect(sr.guideNoticeSentAt).toBe(seal);
    expect(await writeSellRequestGuide(tx, 'sr-1', 'DHL', '456', NOW, 'manual', 3)).toEqual({ count: 1 });
    expect(sr.guideNoticeSentAt).toBeNull();
    expect(sr.shipDeadlineAt).toBe(deadline);
  });

  it('solicitud fuera de aceptada, cerrada o inexistente ⇒ count 0 y ⛔ cero escritura', async () => {
    for (const over of [{ status: 'en_transito' }, { closedAt: new Date() }]) {
      const sr = base(over);
      const { tx } = world(sr, null);
      expect(await writeSellRequestGuide(tx, 'sr-1', 'DHL', '1', NOW, 'manual', 3)).toEqual({ count: 0 });
      expect(sr.shipmentTrackingNumber).toBeNull();
    }
    const { tx } = world(base(), null);
    expect(await writeSellRequestGuide(tx, 'sr-404', 'DHL', '1', NOW, 'manual', 3)).toEqual({ count: 0 });
  });

  it("source='skydropx' ⛔ no pisa una guía manual (guarda `shipmentTrackingNumber IS NULL`); sobre una sin guía, escribe", async () => {
    const manual = base({ shipmentCarrier: 'DHL', shipmentTrackingNumber: 'MAN-1' });
    const w1 = world(manual, null);
    expect(await writeSellRequestGuide(w1.tx, 'sr-1', 'Estafeta', 'SDX-1', NOW, 'skydropx', 3)).toEqual({ count: 0 });
    expect(manual.shipmentTrackingNumber).toBe('MAN-1');

    const empty = base();
    const w2 = world(empty, null);
    expect(await writeSellRequestGuide(w2.tx, 'sr-1', 'Estafeta', 'SDX-1', NOW, 'skydropx', 3)).toEqual({ count: 1 });
    expect(empty).toMatchObject({ shipmentCarrier: 'Estafeta', shipmentTrackingNumber: 'SDX-1', guideSentAt: NOW, shipDeadlineAt: addBusinessDays(NOW, 3) });
  });
});
