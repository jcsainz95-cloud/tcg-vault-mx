/**
 * su8-alta-publica.e2e-spec.ts — ⭐ SU-B7…SU-B12 (API_CONTRACT §M1-SU, SU.8; ARCHITECTURE §4.65 (h)) contra Postgres
 * REAL y por HTTP. Propiedad: backend; la ejecuta QA.
 *
 * Con SU-1 la ubicación dejó de ser requisito para publicar, y con ella desapareció el disparador que el dueño usaba
 * de hecho (el `move` a un cajón). SU.8: las tres altas del servidor —(A) `POST …/items`, (B) `POST …/items/batch` y
 * (C) `POST …/adjustments` `encontrada`— llaman, tras el commit, al MISMO cuerpo (`reevaluateForPublication`) con los
 * ids que crearon. Best-effort (un fallo del disparo no cambia la respuesta del alta) y nunca en el replay.
 *
 * | # | Qué fija |
 * |---|---|
 * | SU-B7  | (A) sin cajón y con precio que resuelve (raw / graded / sellado sin producto) ⇒ `201 listed` en respuesta y BD |
 * | SU-B8  | (A) raw `compra` sin precio ni referencia ⇒ `in_stock`, en la cola con `["price"]` y `pendingPriceEntryId` |
 * | SU-B9  | (B) una llamada al cuerpo con exactamente los ids `ok:true`; la con precio `listed`, la sin precio en la cola |
 * | SU-B10 | (B) replay tras retirar de la venta: la pieza sigue `in_stock`, el cuerpo no se llama (*canario*) |
 * | SU-B11 | (C) `encontrada` raw con referencia ⇒ piezas `listed` |
 * | SU-B12 | (A) y (B) con el cuerpo que lanza ⇒ el alta responde igual y la pieza queda `in_stock` (*canario*) |
 *
 * El cuerpo se observa con `jest.spyOn` sobre la instancia REAL de `InventoryService` (el controlador y el servicio
 * comparten la instancia, y el disparo es `this.reevaluateForPublication(…)`): la implementación corre de verdad.
 */
import { randomBytes } from 'crypto';
import { E2EHarness } from './helpers/e2e-app';
import { E2E_CARDS, E2E_USERS } from '../../prisma/e2e-fixtures';
import { InventoryService } from '../../src/modules/inventory/inventory.service';
import { PricingService } from '../../src/modules/pricing/pricing.service';

jest.setTimeout(120_000);

const RUN = `su8${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
/**
 * Carta PROPIA sin referencia ni cola: la `nopref` del fixture ya tiene una `PendingPriceEntry` abierta (la siembra su
 * pieza `E2E-STK-0001`), y la fila de `pending-publish` toma el `pendingPriceEntryId` de cualquier entrada abierta de
 * la clave — con ella SU-B8 saldría verde sin que el alta escale. Con una carta virgen, el id solo puede venir de SU.8.
 */
const FRESH_CARD = `e2e-su8-nopref-${RUN}`;

describe('E2E — SU.8: el alta dispara la publicación (§M1-SU, SU-B7…SU-B12)', () => {
  let h: E2EHarness;
  let admin: string;
  let svc: InventoryService;
  let pricing: PricingService;
  const card: Record<'common' | 'nopref' | 'graded', string> = { common: '', nopref: '', graded: '' };
  const created: string[] = [];
  const batchKeys: string[] = [];
  const sealedProducts: string[] = [];

  const status = async (id: string) =>
    (await h.prisma.inventoryItem.findUniqueOrThrow({ where: { id }, select: { status: true } })).status;
  const queueRow = async (id: string) => {
    const q = await h.api('GET', '/admin/inventory/pending-publish?page=1&pageSize=1000', { token: admin });
    expect(q.status).toBe(200);
    return (q.body.data as Array<Record<string, unknown>>).find((r) => r.inventoryItemId === id);
  };
  const alta = async (json: Record<string, unknown>) => {
    const r = await h.api('POST', '/admin/inventory/items', { token: admin, json });
    expect({ s: r.status, b: r.status === 201 ? 'ok' : r.text }).toEqual({ s: 201, b: 'ok' });
    created.push(r.body.id);
    return r;
  };
  const lote = async (batchKey: string, items: Record<string, unknown>[]) => {
    batchKeys.push(batchKey);
    const r = await h.api('POST', '/admin/inventory/items/batch', { token: admin, json: { batchKey, items } });
    expect({ s: r.status, b: r.status === 200 ? 'ok' : r.text }).toEqual({ s: 200, b: 'ok' });
    for (const l of r.body.results as Array<{ ok: boolean; inventoryItemIds?: string[] }>) {
      if (l.ok) created.push(...(l.inventoryItemIds ?? []));
    }
    return r;
  };
  const rawPriced = () => ({
    productType: 'raw',
    cardId: card.common,
    rawCondition: 'NM',
    acquisitionType: 'compra',
    acquisitionCostCents: 100,
    listPriceCents: 900,
  });
  const rawUnpriced = () => ({
    productType: 'raw',
    cardId: card.nopref,
    rawCondition: 'NM',
    acquisitionType: 'compra',
    acquisitionCostCents: 100,
  });

  beforeAll(async () => {
    h = await E2EHarness.create();
    admin = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    svc = h.app.get(InventoryService);
    pricing = h.app.get(PricingService);
    for (const k of Object.keys(card) as Array<keyof typeof card>) {
      card[k] = (
        await h.prisma.card.findFirstOrThrow({ where: { externalId: E2E_CARDS[k].externalId }, select: { id: true } })
      ).id;
    }
    const base = await h.prisma.card.findUniqueOrThrow({ where: { id: card.nopref }, select: { setId: true } });
    await h.prisma.card.create({
      data: { id: FRESH_CARD, externalId: FRESH_CARD, setId: base.setId, name: 'SU8 Sin Precio', number: '999', rarity: 'Common', rarityCanonical: 'Common', availableFinishes: ['normal'] },
    });
  }, 180_000);

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    if (!h) return;
    await h.prisma.inventoryAdjustment.deleteMany({ where: { inventoryItemId: { in: created } } });
    await h.prisma.inventoryMovement.deleteMany({ where: { itemId: { in: created } } });
    await h.prisma.auditLog.deleteMany({ where: { entityId: { in: created } } });
    await h.prisma.inventoryItem.deleteMany({ where: { id: { in: created } } });
    await h.prisma.inventoryBatch.deleteMany({ where: { id: { in: batchKeys } } });
    await h.prisma.pendingPriceEntry.deleteMany({ where: { sealedProductId: { in: sealedProducts } } });
    await h.prisma.sealedProduct.deleteMany({ where: { id: { in: sealedProducts } } });
    await h.prisma.pendingPriceEntry.deleteMany({ where: { cardId: FRESH_CARD } });
    await h.prisma.card.deleteMany({ where: { id: FRESH_CARD } });
    await h.close();
  });

  describe('SU-B7 — (A) sin cajón y con precio que resuelve ⇒ `201` `listed` en la respuesta y en BD', () => {
    it('raw con `listPriceCents`', async () => {
      const r = await alta(rawPriced());
      expect(r.body.status).toBe('listed');
      expect(await status(r.body.id)).toBe('listed');
    });
    it('graded con cert + identidad de slab + precio', async () => {
      const r = await alta({
        productType: 'graded',
        cardId: card.graded,
        gradingCompany: 'PSA',
        gradeValue: '10',
        certNumber: `SU8-${RUN}`,
        acquisitionType: 'compra',
        acquisitionCostCents: 1000,
        listPriceCents: 450_000,
      });
      expect(r.body.status).toBe('listed');
      expect(await status(r.body.id)).toBe('listed');
    });
    it('sellado sin producto con `listPriceCents` (dueño)', async () => {
      const r = await alta({
        productType: 'sealed',
        cardId: card.common,
        sealedSubtype: 'etb',
        acquisitionType: 'compra',
        acquisitionCostCents: 1000,
        listPriceCents: 5000,
      });
      expect(r.body.status).toBe('listed');
      expect(await status(r.body.id)).toBe('listed');
    });
  });

  /**
   * Extra de backend (no está en la tabla de SU.8.5): el mercado a mano del alta (`manualMarketMxnCents`, dueño) se
   * escribe DENTRO de la tx del alta, así que el disparo —después del commit— lo lee y publica, y NO abre cola de M2.
   * Fija con Postgres real lo que `test/inventory.pending-reason-writers.spec.ts` («override manual ⇒ 0 entradas») fija
   * con dobles: su doble de `getReferencesBatch` tuvo que aprender a ver el override escrito (BACKEND_NOTES §82.SU8).
   */
  it('SU-B7 (extra) — sellado LIGADO con `manualMarketMxnCents` (dueño) ⇒ `listed`, y 0 entradas en la cola de M2', async () => {
    const anchor = await h.prisma.card.findUniqueOrThrow({ where: { id: card.nopref }, select: { setId: true } });
    const sp = await h.prisma.sealedProduct.create({
      data: {
        setId: anchor.setId,
        tcgplayerProductId: 880_000_000 + Math.floor(Math.random() * 1_000_000),
        tcgplayerGroupId: 990_901,
        name: `SU8 ETB ${RUN}`,
        subtype: 'etb',
      },
    });
    sealedProducts.push(sp.id);
    const r = await alta({ productType: 'sealed', sealedProductId: sp.id, acquisitionType: 'compra', acquisitionCostCents: 1000, manualMarketMxnCents: 90_000 });
    expect(r.body.status).toBe('listed');
    expect(await status(r.body.id)).toBe('listed');
    expect(await h.prisma.pendingPriceEntry.count({ where: { sealedProductId: sp.id } })).toBe(0);
  });

  it('SU-B8 — (A) raw `compra` sin precio ni referencia ⇒ `in_stock`, en la cola con `["price"]` y escalada a M2', async () => {
    const r = await alta({ ...rawUnpriced(), cardId: FRESH_CARD });
    expect(r.body.status).toBe('in_stock');
    expect(await status(r.body.id)).toBe('in_stock');
    const open = await h.prisma.pendingPriceEntry.findMany({ where: { cardId: FRESH_CARD, status: 'open' }, select: { id: true } });
    expect(open).toHaveLength(1);
    const row = await queueRow(r.body.id);
    expect(row?.missing).toEqual(['price']);
    expect(row?.pendingPriceEntryId).toBe(open[0].id);
  });

  it('SU-B9 — (B) lote con precio / sin precio / línea fallida ⇒ UNA llamada con exactamente los ids `ok:true`', async () => {
    const spy = jest.spyOn(svc, 'reevaluateForPublication');
    const r = await lote(`su8-b9-${RUN}`, [
      rawPriced(),
      rawUnpriced(),
      { ...rawPriced(), cardId: `no-existe-${RUN}` },
    ]);
    const res = r.body.results as Array<{ ok: boolean; inventoryItemIds?: string[] }>;
    expect(res.map((l) => l.ok)).toEqual([true, true, false]);
    const [priced] = res[0].inventoryItemIds as string[];
    const [unpriced] = res[1].inventoryItemIds as string[];
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toEqual([priced, unpriced]);
    expect(await status(priced)).toBe('listed');
    expect(await status(unpriced)).toBe('in_stock');
    expect((await queueRow(unpriced))?.missing).toEqual(['price']);
  });

  it('SU-B10 (canario) — (B) replay tras retirar de la venta: `idempotentReplay`, sigue `in_stock`, el cuerpo NO se llama', async () => {
    const batchKey = `su8-b10-${RUN}`;
    const first = await lote(batchKey, [rawPriced()]);
    const [id] = first.body.results[0].inventoryItemIds as string[];
    const off = await h.api('PATCH', `/admin/inventory/items/${id}`, { token: admin, json: { status: 'in_stock' } });
    expect(off.status).toBe(200);
    expect(await status(id)).toBe('in_stock');
    const spy = jest.spyOn(svc, 'reevaluateForPublication');
    const again = await lote(batchKey, [rawPriced()]);
    expect(again.body.idempotentReplay).toBe(true);
    expect(again.body.results[0].inventoryItemIds).toEqual([id]);
    expect(await status(id)).toBe('in_stock');
    expect(spy).not.toHaveBeenCalled();
  });

  it('SU-B11 — (C) `encontrada` raw con referencia ⇒ piezas `listed`', async () => {
    const r = await h.api('POST', '/admin/inventory/adjustments', {
      token: admin,
      json: { reason: 'encontrada', batchKey: `su8-b11-${RUN}`, item: { productType: 'raw', cardId: card.common, rawCondition: 'NM', qty: 2 } },
    });
    batchKeys.push(`su8-b11-${RUN}`);
    expect({ s: r.status, b: r.status === 201 ? 'ok' : r.text }).toEqual({ s: 201, b: 'ok' });
    const ids = r.body.inventoryItemIds as string[];
    created.push(...ids);
    expect(ids).toHaveLength(2);
    expect(r.body.toStatus).toBe('in_stock');
    for (const id of ids) expect(await status(id)).toBe('listed');
  });

  describe('SU-B12 (canario) — el cuerpo lanza (`pricing.loadPricingCurve` rechaza) ⇒ el alta NO cae', () => {
    it('(A) `201`, la pieza existe `in_stock`, respuesta `status:"in_stock"`', async () => {
      jest.spyOn(pricing, 'loadPricingCurve').mockRejectedValue(new Error('SU-B12: curva caída'));
      const r = await alta(rawPriced());
      expect(r.body.status).toBe('in_stock');
      expect(await status(r.body.id)).toBe('in_stock');
    });
    it('(B) `200`, la pieza existe `in_stock`', async () => {
      jest.spyOn(pricing, 'loadPricingCurve').mockRejectedValue(new Error('SU-B12: curva caída'));
      const r = await lote(`su8-b12-${RUN}`, [rawPriced()]);
      expect(r.body.idempotentReplay).toBe(false);
      const [id] = r.body.results[0].inventoryItemIds as string[];
      expect(await status(id)).toBe('in_stock');
    });
  });
});
