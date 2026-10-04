/**
 * sale-queue-publish-all-sweep.e2e-spec.ts — 💰 v1.80.8.9 (API_CONTRACT §M2 «v1.80.8.9», ancla `M2-VQ9`;
 * ARCHITECTURE §4.36.5 (c-quinquies)). Propiedad: backend; la ejecuta QA. Postgres real, app Nest completa.
 *
 *  VQ-10 «Publicar todo» SIN filtro termina con el barrido VQ entero (rama `null` + rama `premium_at_floor`).
 *  VQ-11 (a) el replay por `batchKey` no barre; (b) un barrido que lanza no cambia el `200` (un `logger.error`);
 *        (c) con `setId` de OTRO set también barre (el predicado del barrido es global).
 *  VQ-12 la reconciliación de `price-ingest` abre/cierra con la clave de cola ENTERA (`saleQueueKeyOf`, con
 *        `cardProductId`).
 *  VQ-13 `context` entra a la clave de dedupe de `escalatePending`: cada eje su fila; idempotencia intacta.
 *  VQ-14 el deep-link de M1 (`pendingPriceEntryId` de `pending-publish`) apunta a la fila de VENTA.
 *
 * Deterministas (contrato: N=1 por corrida es medida). Mutaciones en `BACKEND_NOTES` §20, sobre COPIA del árbol
 * entero (⛔ nunca aquí).
 *
 * ⚠️ VQ-10 llama a `publish-all` SIN filtro (lo que pide el contrato): publica también piezas vendibles que otras
 * suites hayan dejado. Se PRESTAN y se DEVUELVEN: las piezas ajenas que el lote pase a `listed` vuelven a su
 * `status` al terminar (la regla de la casa: una suite no deja el estado global distinto de como lo encontró).
 * ⚠️ El dial `premium_floor_sale_publish` es fila COMPARTIDA: se fija al seed y se restaura.
 */
import { Logger } from '@nestjs/common';
import { E2EHarness } from './helpers/e2e-app';
import { E2E_USERS } from '../../prisma/e2e-fixtures';
import { PriceSyncJobService } from '../../src/jobs/price-sync.service';
import { PricingService } from '../../src/modules/pricing/pricing.service';
import { PriceIngestService } from '../../src/modules/pricing/price-ingest.service';

const SET_A = 'e2e-vq10-set';
const SET_B = 'e2e-vq10-otro';
const card = (slug: string) => `e2e-vq10-${slug}`;
const DIAL_KEY = 'premium_floor_sale_publish';
const SEED_DIAL = { mode: 'only', rarities: ['Double Rare', 'Rare Holo EX'] };
const GOOD_MARKET = 200_000;
const PROMO = 424242;

interface Counts {
  no_market: number;
  premium_at_floor: number;
  unknown: number;
}

const CARDS: [string, string, string][] = [
  // slug, rarity, set
  ['c1', 'Common', SET_A], // (i) cliente
  ['c2', 'Common', SET_A], // (ii) vendida
  ['c3', 'Common', SET_A], // (iii) plataforma con precio manual
  ['c4', 'Common', SET_A], // (iv) cardProductId distinto
  ['c5', 'Sealed', SET_A], // (v) clave 'sealed' sin pieza
  ['c6', 'Common', SET_A], // (vi) plataforma vendible sin mercado
  ['c7', 'Common', SET_A], // (vii) context buylist
  ['c8', 'Double Rare', SET_A], // (viii) premium_at_floor de rareza que el dial publica
  ['c9', 'Special Illustration Rare', SET_A], // (ix) premium_at_floor de rareza que el dial NO publica
  ['r1', 'Common', SET_A], // VQ-11 (a)
  ['r2', 'Common', SET_A], // VQ-11 (b)
  ['r3', 'Common', SET_A], // VQ-11 (c)
  ['p1', 'Common', SET_A], // VQ-12 (A)
  ['p2', 'Common', SET_A], // VQ-12 (B)
  ['k1', 'Common', SET_A], // VQ-13 (A)
  ['k2', 'Common', SET_A], // VQ-13 (B)
  ['k3', 'Common', SET_A], // VQ-13 (C)
  ['d1', 'Common', SET_B], // VQ-14 (set propio: el GET de pending-publish va acotado a SET_B)
];

describe('💰 §M2 «v1.80.8.9» (M2-VQ9) — publish-all barre; la cola se escribe por eje y con la clave entera', () => {
  let h: E2EHarness;
  let admin: string;
  let customerId: string;
  let seq = 0;
  let dialBefore: unknown = undefined;
  const RUN = Date.now().toString(36);

  async function cleanup() {
    const ids = CARDS.map(([s]) => card(s));
    const its = await h.prisma.inventoryItem.findMany({ where: { cardId: { in: ids } }, select: { id: true } });
    await h.prisma.inventoryMovement.deleteMany({ where: { itemId: { in: its.map((i) => i.id) } } });
    await h.prisma.inventoryItem.deleteMany({ where: { cardId: { in: ids } } });
    await h.prisma.pendingPriceEntry.deleteMany({ where: { cardId: { in: ids } } });
    await h.prisma.priceReference.deleteMany({ where: { cardId: { in: ids } } });
    await h.prisma.card.deleteMany({ where: { id: { in: ids } } });
    await h.prisma.cardSet.deleteMany({ where: { id: { in: [SET_A, SET_B] } } });
  }

  async function mk(slug: string, data: Record<string, unknown>) {
    seq += 1;
    return h.prisma.inventoryItem.create({
      data: {
        folio: `VQ10-${RUN}-${String(seq).padStart(3, '0')}`,
        cardId: card(slug),
        productType: 'raw',
        rawCondition: 'NM',
        finish: 'normal',
        acquisitionType: 'compra',
        ownerType: 'platform',
        status: 'in_stock',
        ...data,
      } as never,
    });
  }

  const RAW_KEY = { productType: 'raw' as const, gradeKey: 'raw:NM', finish: 'normal' as const };
  async function row(slug: string, o: Record<string, unknown> = {}) {
    return h.prisma.pendingPriceEntry.create({
      data: { ...RAW_KEY, cardId: card(slug), context: 'inventory', status: 'open', reason: null, ...o } as never,
    });
  }
  const get = (id: string) => h.prisma.pendingPriceEntry.findUniqueOrThrow({ where: { id } });

  async function market(slug: string, cents: number) {
    await h.prisma.priceReference.create({
      data: {
        cardId: card(slug),
        ...RAW_KEY,
        source: 'manual',
        priceMxnCents: cents,
        capturedDate: new Date('2026-10-04T00:00:00.000Z'),
        isManualOverride: true,
        refKind: 'market',
      } as never,
    });
  }

  async function counts(): Promise<Counts> {
    const res = await h.api('GET', '/admin/pricing/pending?context=inventory', { token: admin });
    expect(res.status).toBe(200);
    return (res.body as { counts: Counts }).counts;
  }

  const publishAll = (json: Record<string, unknown>) =>
    h.api<any>('POST', '/admin/inventory/publish-all', { token: admin, json });

  beforeAll(async () => {
    h = await E2EHarness.create();
    admin = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    customerId = (await h.prisma.user.findUniqueOrThrow({ where: { email: E2E_USERS.customer.email } })).id;
    const dialRow = await h.prisma.configSetting.findUnique({ where: { key: DIAL_KEY } });
    dialBefore = dialRow ? dialRow.valueJson : undefined;
    const put = await h.api('PUT', '/admin/settings', { token: admin, json: { premiumFloorSalePublish: SEED_DIAL } });
    expect(put.status).toBe(200);
    await cleanup();
    for (const id of [SET_A, SET_B]) await h.prisma.cardSet.create({ data: { id, externalId: id, name: `E2E ${id}` } });
    let n = 0;
    for (const [slug, rarity, setId] of CARDS) {
      n += 1;
      await h.prisma.card.create({
        data: {
          id: card(slug),
          externalId: card(slug),
          setId,
          name: `VQ10 ${slug}`,
          number: String(n),
          rarity,
          rarityCanonical: rarity,
          availableFinishes: ['normal'],
        },
      });
    }
  }, 120000);

  afterAll(async () => {
    if (h) {
      await cleanup();
      if (dialBefore === undefined) await h.prisma.configSetting.deleteMany({ where: { key: DIAL_KEY } });
      else await h.prisma.configSetting.update({ where: { key: DIAL_KEY }, data: { valueJson: dialBefore as object } });
    }
    await h?.close();
  });

  // =============================================================================================== VQ-10
  it('VQ-10 — `publish-all` SIN filtro: (i)–(v) y (viii) `resolved` sin ref; (vi) `no_market`; (vii) y (ix) intactas; unknown=0 e invariante; segunda pulsación ⇒ 0 cierres', async () => {
    await mk('c1', { ownerType: 'customer', ownerUserId: customerId, status: 'in_custody' });
    await mk('c2', { status: 'delivered' });
    await mk('c3', { listPriceCents: 55555 });
    await mk('c4', { cardProductId: null });
    await mk('c6', {});
    const r = {
      i: await row('c1'),
      ii: await row('c2'),
      iii: await row('c3'),
      iv: await row('c4', { cardProductId: PROMO }),
      v: await row('c5', { productType: 'sealed', gradeKey: 'sealed' }),
      vi: await row('c6'),
      vii: await row('c7', { context: 'buylist' }),
      viii: await row('c8', { reason: 'premium_at_floor' }),
      ix: await row('c9', { reason: 'premium_at_floor' }),
    };
    // Piezas ajenas vendibles ANTES del lote sin filtro: se devuelven a su status al terminar.
    const ajenas = await h.prisma.inventoryItem.findMany({
      where: { ownerType: 'platform', status: 'in_stock', card: { setId: { notIn: [SET_A, SET_B] } } },
      select: { id: true },
    });
    const sweep = jest.spyOn(h.app.get(PriceSyncJobService), 'sweepUnreasonedSaleQueue');
    let first: any;
    let second: any;
    try {
      first = await publishAll({});
      expect(first.status).toBe(200);
      const tras1 = await Promise.all(Object.values(r).map((x) => get(x.id)));
      const by = Object.fromEntries(Object.keys(r).map((k, i) => [k, tras1[i]]));
      const corte = (x: any) => [x.status, x.reason, x.resolvedPriceRefId];
      expect({
        i: corte(by.i), ii: corte(by.ii), iii: corte(by.iii), iv: corte(by.iv), v: corte(by.v),
        vi: corte(by.vi), vii: corte(by.vii), viii: corte(by.viii), ix: corte(by.ix),
      }).toEqual({
        i: ['resolved', null, null],
        ii: ['resolved', null, null],
        iii: ['resolved', null, null],
        iv: ['resolved', null, null],
        v: ['resolved', null, null],
        vi: ['open', 'no_market', null],
        vii: ['open', null, null],
        viii: ['resolved', 'premium_at_floor', null],
        ix: ['open', 'premium_at_floor', null],
      });
      const c = await counts();
      expect(c.unknown).toBe(0);
      const open = await h.prisma.pendingPriceEntry.count({ where: { status: 'open', context: 'inventory' } });
      expect(c.no_market + c.premium_at_floor + c.unknown).toBe(open);
      // El barrido corrió UNA vez, desde publish-all, y cerró algo.
      expect(sweep).toHaveBeenCalledTimes(1);
      expect(sweep.mock.calls[0]).toEqual(['publish-all']);

      // Segunda pulsación ⇒ 0 cierres (idempotente).
      const snap = JSON.stringify(await Promise.all(Object.values(r).map((x) => get(x.id))));
      second = await publishAll({});
      expect(second.status).toBe(200);
      expect(sweep).toHaveBeenCalledTimes(2);
      const res2 = await sweep.mock.results[1].value;
      expect([res2.closed, res2.premiumFloorClosed]).toEqual([0, 0]);
      expect(JSON.stringify(await Promise.all(Object.values(r).map((x) => get(x.id))))).toBe(snap);
    } finally {
      sweep.mockRestore();
      // Devolver lo prestado: las ajenas que el lote publicó vuelven a `in_stock`.
      if (ajenas.length > 0)
        await h.prisma.inventoryItem.updateMany({
          where: { id: { in: ajenas.map((a) => a.id) }, status: 'listed' },
          data: { status: 'in_stock' },
        });
    }
  }, 120000);

  // =============================================================================================== VQ-11
  it('VQ-11 (a) — el replay por `batchKey` NO barre: la fila sembrada tras la primera corrida sigue `open` y el barrido tiene 0 invocaciones en el replay', async () => {
    await mk('r1', { ownerType: 'customer', ownerUserId: customerId, status: 'in_custody' });
    const batchKey = `vq11a-${RUN}`;
    const pf = h.app.get(PriceSyncJobService);
    const first = await publishAll({ batchKey, setId: SET_B });
    expect([first.status, first.body.idempotentReplay]).toEqual([200, false]);
    const r = await row('r1');
    const sweep = jest.spyOn(pf, 'sweepUnreasonedSaleQueue');
    try {
      const replay = await publishAll({ batchKey, setId: SET_B });
      expect([replay.status, replay.body.idempotentReplay]).toEqual([200, true]);
      expect(sweep).toHaveBeenCalledTimes(0);
      expect((await get(r.id)).status).toBe('open');
    } finally {
      sweep.mockRestore();
    }
  });

  it('VQ-11 (b) — un barrido que LANZA: `200`, `summary` idéntico al de una corrida sin fallo, y UN `logger.error`', async () => {
    await mk('r2', {}); // vendible sin mercado: pendingPrice 1 en las dos corridas (el estado no cambia entre ellas)
    const pf = h.app.get(PriceSyncJobService);
    const errores: string[] = [];
    const logErr = jest.spyOn(Logger.prototype, 'error').mockImplementation((...a: unknown[]) => {
      errores.push(String(a[0]));
    });
    const sweep = jest.spyOn(pf, 'sweepUnreasonedSaleQueue').mockRejectedValueOnce(new Error('vq11b: barrido roto'));
    let conFallo: any;
    let sinFallo: any;
    try {
      conFallo = await publishAll({ setId: SET_A, productType: 'raw' });
      sinFallo = await publishAll({ setId: SET_A, productType: 'raw' });
    } finally {
      sweep.mockRestore();
      logErr.mockRestore();
    }
    expect([conFallo.status, sinFallo.status]).toEqual([200, 200]);
    expect(conFallo.body.summary).toEqual(sinFallo.body.summary);
    const delBarrido = errores.filter((e) => e.includes('vq11b: barrido roto'));
    expect(delBarrido).toHaveLength(1);
    expect(delBarrido[0]).toContain('publish-all');
  });

  it('VQ-11 (c) — `publish-all` con `setId` de OTRO set también barre: la fila `null` de pieza de cliente queda `resolved`', async () => {
    await mk('r3', { ownerType: 'customer', ownerUserId: customerId, status: 'in_custody' });
    const r = await row('r3');
    const res = await publishAll({ setId: SET_B });
    expect(res.status).toBe(200);
    expect([(await get(r.id)).status, (await get(r.id)).resolvedPriceRefId]).toEqual(['resolved', null]);
  });

  // =============================================================================================== VQ-12
  it('VQ-12 — `reconcilePublishedPrices` usa la clave ENTERA: (A) cierra la fila con `cardProductId=X`; (B) abre la suya con X; ninguna fila con `cardProductId=null`', async () => {
    await mk('p1', { status: 'listed', cardProductId: PROMO });
    await mk('p2', { status: 'listed', cardProductId: PROMO });
    await market('p1', GOOD_MARKET);
    const a = await row('p1', { cardProductId: PROMO, reason: 'no_market' });
    const set = await h.prisma.cardSet.findUniqueOrThrow({ where: { id: SET_A } });
    await (h.app.get(PriceIngestService) as any).reconcilePublishedPrices(set);
    expect((await get(a.id)).status).toBe('resolved');
    const p1 = await h.prisma.pendingPriceEntry.findMany({ where: { cardId: card('p1'), status: 'open' } });
    expect(p1).toEqual([]);
    expect(await h.prisma.pendingPriceEntry.count({ where: { cardId: { in: [card('p1'), card('p2')] }, cardProductId: null } })).toBe(0);
    const p2 = await h.prisma.pendingPriceEntry.findMany({ where: { cardId: card('p2') } });
    expect(p2.map((x) => [x.status, x.reason, x.cardProductId, x.context])).toEqual([['open', 'no_market', PROMO, 'inventory']]);
  });

  // =============================================================================================== VQ-13
  it('VQ-13 — `context` en el dedupe: (A) VENTA no reutiliza la fila de COMPRA; (B) COMPRA no reescribe la de VENTA; (C) idempotencia por eje intacta', async () => {
    const pricing = h.app.get(PricingService);
    const K = (slug: string) => ({ cardId: card(slug), ...RAW_KEY, cardProductId: null, sealedProductId: null });
    // (A)
    const compra = await row('k1', { context: 'buylist', reason: 'premium_at_floor' });
    const idA = await pricing.settlePendingForVariant('no_market', K('k1'), 'inventory');
    expect(idA).toBeDefined();
    expect(idA).not.toBe(compra.id);
    const k1 = await h.prisma.pendingPriceEntry.findMany({ where: { cardId: card('k1'), status: 'open' }, orderBy: { createdAt: 'asc' } });
    expect(k1.map((x) => [x.id, x.context, x.reason])).toEqual([
      [compra.id, 'buylist', 'premium_at_floor'],
      [idA, 'inventory', 'no_market'],
    ]);
    const lista = await h.api<any>('GET', '/admin/pricing/pending?context=inventory&pageSize=100', { token: admin });
    expect(lista.status).toBe(200);
    const ids = (lista.body.data ?? lista.body.items ?? []).map((x: any) => x.id);
    expect(ids).toContain(idA);
    expect(ids).not.toContain(compra.id);
    // (B)
    const venta = await row('k2');
    const idB = await pricing.settlePendingForVariant('premium_at_floor', K('k2'), 'buylist');
    expect(idB).not.toBe(venta.id);
    expect([(await get(venta.id)).status, (await get(venta.id)).reason]).toEqual(['open', null]);
    expect([(await get(idB!)).context, (await get(idB!)).reason]).toEqual(['buylist', 'premium_at_floor']);
    // (C) canario de no-sobrecorrección
    const c1 = await pricing.settlePendingForVariant('no_market', K('k3'), 'inventory');
    const c2 = await pricing.settlePendingForVariant('no_market', K('k3'), 'inventory');
    expect(c2).toBe(c1);
    expect(await h.prisma.pendingPriceEntry.count({ where: { cardId: card('k3'), status: 'open' } })).toBe(1);
  });

  // =============================================================================================== VQ-14
  it('VQ-14 — deep-link de M1: con fila de COMPRA (más antigua) y de VENTA (más nueva) en la misma clave, `pendingPriceEntryId` = la de VENTA', async () => {
    const it0 = await mk('d1', { locationId: null });
    const compra = await row('d1', { context: 'buylist', reason: 'premium_at_floor', createdAt: new Date(Date.now() - 60_000) });
    const venta = await row('d1', { reason: 'no_market' });
    const res = await h.api<any>('GET', `/admin/inventory/pending-publish?setId=${SET_B}&pageSize=100`, { token: admin });
    expect(res.status).toBe(200);
    const fila = res.body.data.find((d: any) => d.inventoryItemId === it0.id);
    expect(fila).toBeDefined();
    expect(fila.pendingPriceEntryId).toBe(venta.id);
    expect(fila.pendingPriceEntryId).not.toBe(compra.id);
  });
});
