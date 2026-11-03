/**
 * ids-fila-vigente.e2e-spec.ts — 💰 **IDS-B28** (v1.116.5⟨ids⟩, BE-IDS-PT-9; API_CONTRACT §DYN.5.6/.7 «fila vigente», §IDS.0
 * I-2/I-6, ARCHITECTURE §15.1 D-IDS-U) contra Postgres REAL y la app por HTTP. Propiedad: backend.
 *
 * «Fila» = fila VIGENTE: `row.variantKey === listingPriceVariantKey(pieza, gradeKeyOf(pieza), versión)` con la pieza tal como se
 * leyó en esa petición. Una fila de otra `variantKey` (un `PATCH language` / `PATCH gradeValue` cuya corrida no llegó, o una
 * corrida empezada ANTES del `PATCH` que escribió después) cuenta como «sin fila»: vivo + `missing_row`, en cobro Y en tienda.
 *
 * El recálculo se RETIENE (`ListingPriceService.enqueue` solo anota: nada corre hasta que la prueba lo pide), así que la
 * ventana entre el `PATCH` y su corrida queda abierta a propósito. Forzadas, N=10 por caso (k/N impreso):
 *  (a) pieza `es` con fila, `PATCH language:'en'` ⇒ quote, sesión, `OrderItem`, ficha, rejilla y `/catalog/listings/:id` dan
 *      el `P` vivo del inglés bajo `version.key = 'en'`; ninguna superficie da el de la fila vieja; `missing_row` encolado;
 *  (b) el inglés SIN mercado ⇒ `422 PRICE_PENDING` (quote y sesión) nombrando `en`, y fuera de la ficha y de la API pública;
 *  (c) graduada listada, `PATCH gradeValue` ⇒ la sesión cobra el grado NUEVO;
 *  (d) corrida empezada antes del `PATCH` que escribe la fila vieja después ⇒ ignorada;
 *  (e) pieza de Destacadas pasada a `es` ⇒ fuera de `/catalog/featured` (I-6).
 */
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { E2EHarness } from './helpers/e2e-app';
import { E2E_USERS } from '../../prisma/e2e-fixtures';
import { seedE2E } from '../../prisma/seed-e2e';
import { ListingPriceService } from '../../src/modules/pricing/listing-price.service';
import { SaleDecisionService, SaleItem, isPricePending } from '../../src/modules/pricing/sale-decision.service';
import { SettingsService } from '../../src/modules/settings/settings.service';
import { SEALED_SALE_PRICE_INCLUDE } from '../../src/common/money';

jest.setTimeout(600_000);

const N = 10;

type Err = { error: { code: string; details?: { items?: { inventoryItemId: string; version: { key: string } }[] } } };
type Priced = { displayPriceCents?: number; fromPriceCents?: number; version?: { key: string } };
type Seen = { surface: string; cents: number | undefined; key: string | undefined };

describe('E2E — IDS-B28 💰 fila vigente: una fila de otra versión no se cobra ni se exhibe', () => {
  let h: E2EHarness;
  let customer: string;
  let admin: string;
  let lp: ListingPriceService;
  let decider: SaleDecisionService;
  const run = randomUUID().slice(0, 8);
  let setId: string;
  let shelf: string | null;
  let seq = 0;
  const cardIds: string[] = [];
  const today = () => new Date(new Date().toISOString().slice(0, 10));
  const err = (r: { body: unknown }) => (r.body as Err).error;

  /** El recálculo RETENIDO: mientras `held`, `enqueue` solo anota (disparador e ids) y no corre nada. */
  let held = false;
  const enqueued: { trigger: string; ids?: readonly string[] }[] = [];

  async function card(name: string, refs: { productType: 'raw' | 'graded'; gradeKey: string; cents: number }[]): Promise<string> {
    seq += 1;
    const c = await h.prisma.card.create({
      data: { externalId: `ifv-${run}-${seq}`, setId, name: `${name} ${run} ${seq}`, number: String(seq), rarity: 'Common', rarityCanonical: 'Common', availableFinishes: ['normal'] },
    });
    cardIds.push(c.id);
    for (const r of refs) {
      await h.prisma.priceReference.create({
        data: { cardId: c.id, productType: r.productType, gradeKey: r.gradeKey, finish: 'normal', source: 'manual', priceMxnCents: r.cents, capturedDate: today(), isManualOverride: true, refKind: 'market' },
      });
    }
    return c.id;
  }
  async function item(cardId: string, data: Partial<Prisma.InventoryItemUncheckedCreateInput> = {}) {
    seq += 1;
    return h.prisma.inventoryItem.create({
      data: {
        folio: `IFV-${run}-${seq}`,
        cardId,
        productType: 'raw',
        rawCondition: 'NM',
        finish: 'normal',
        ownerType: 'platform',
        status: 'listed',
        acquisitionType: 'compra',
        acquisitionCostCents: 1000,
        firstListedAt: new Date(),
        locationId: shelf,
        ...data,
      },
    });
  }
  const row = (id: string) => h.prisma.listingPrice.findUniqueOrThrow({ where: { inventoryItemId: id } });
  async function live(id: string): Promise<number | 'pending'> {
    const it = (await h.prisma.inventoryItem.findUniqueOrThrow({
      where: { id },
      include: { card: { include: { set: true } }, ...SEALED_SALE_PRICE_INCLUDE },
    })) as SaleItem;
    try {
      return (await decider.decide(it, await h.app.get(SettingsService).getIvaDials())).unitPriceCents;
    } catch (e) {
      if (isPricePending(e)) return 'pending';
      throw e;
    }
  }
  const patch = (id: string, json: Record<string, unknown>) => h.api<Err>('PATCH', `/admin/inventory/items/${id}`, { token: admin, json });
  const quote = (ids: string[]) =>
    h.api<{ items: { inventoryItemId: string; unitPriceCents: number; version?: { key: string } }[] } & Err>('POST', '/checkout/quote', {
      token: customer,
      json: { inventoryItemIds: ids },
    });
  const session = (ids: string[], key: string) =>
    h.api<{ orderId: string } & Err>('POST', '/checkout/session', { token: customer, json: { inventoryItemIds: ids }, headers: { 'idempotency-key': key } });

  /** Todo lo que la tienda exhibe de la pieza `id` de la carta `cardId`: ficha (grupos, unidades, versiones), rejilla, listing. */
  async function exhibited(cardId: string, id: string): Promise<Seen[]> {
    const out: Seen[] = [];
    const ficha = await h.api<{ listings: Priced[]; units: (Priced & { inventoryItemId: string })[]; versions: Priced[] }>('GET', `/catalog/cards/${cardId}`);
    if (ficha.status === 200) {
      for (const l of ficha.body.listings) out.push({ surface: 'ficha.listings', cents: l.displayPriceCents, key: l.version?.key });
      for (const u of ficha.body.units.filter((x) => x.inventoryItemId === id)) out.push({ surface: 'ficha.units', cents: u.displayPriceCents, key: u.version?.key });
      for (const v of ficha.body.versions) out.push({ surface: 'ficha.versions', cents: v.fromPriceCents, key: v.version?.key });
    }
    const name = (await h.prisma.card.findUniqueOrThrow({ where: { id: cardId } })).name;
    const grid = await h.api<{ data: (Priced & { card: { id: string } })[] }>('GET', `/catalog/cards?q=${encodeURIComponent(name)}&pageSize=20`);
    for (const g of grid.body.data.filter((x) => x.card.id === cardId)) out.push({ surface: 'rejilla', cents: g.displayPriceCents, key: g.version?.key });
    const one = await h.api<Priced>('GET', `/catalog/listings/${id}`);
    if (one.status === 200) out.push({ surface: 'listing', cents: one.body.displayPriceCents, key: one.body.version?.key });
    return out;
  }

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedE2E(h.prisma);
    const seed = await h.prisma.user.findUniqueOrThrow({ where: { email: E2E_USERS.customer.email } });
    const ownEmail = `ifv.owner.${run}@e2e.local`;
    await h.prisma.user.upsert({
      where: { email: ownEmail },
      create: { email: ownEmail, passwordHash: seed.passwordHash, name: 'E2E Fila Vigente', role: 'customer', locale: 'es', phone: seed.phone, emailVerified: true },
      update: { emailVerified: true, status: 'active' },
    });
    customer = await h.login(ownEmail, E2E_USERS.customer.password);
    admin = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    lp = h.app.get(ListingPriceService);
    decider = h.app.get(SaleDecisionService);
    shelf = (await h.prisma.vaultLocation.findFirst({ where: { zone: 'platform_stock', isActive: true } }))?.id ?? null;
    setId = (await h.prisma.cardSet.create({ data: { externalId: `ifv-${run}`, name: `Set Fila Vigente ${run}` } })).id;
    const realEnqueue = lp.enqueue.bind(lp);
    jest.spyOn(lp, 'enqueue').mockImplementation((trigger, ids) => {
      if (!held) return realEnqueue(trigger, ids);
      enqueued.push({ trigger, ids });
      return Promise.resolve();
    });
  });

  afterEach(async () => {
    held = false;
    enqueued.length = 0;
    await h.prisma.featuredSelection.deleteMany({ where: { seed: { startsWith: `e2e-ifv-${run}` } } });
  });

  afterAll(async () => {
    if (h) {
      held = false;
      jest.restoreAllMocks();
      await lp?.idle();
      const ids = (await h.prisma.inventoryItem.findMany({ where: { cardId: { in: cardIds } }, select: { id: true } })).map((i) => i.id);
      const orderIds = (await h.prisma.orderItem.findMany({ where: { inventoryItemId: { in: ids } }, select: { orderId: true } })).map((o) => o.orderId);
      await h.prisma.inventoryItem.updateMany({ where: { id: { in: ids } }, data: { reservedByOrderId: null } });
      await h.prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
      await h.prisma.order.updateMany({ where: { id: { in: orderIds }, status: 'pending' }, data: { status: 'failed' } });
      await h.prisma.orderAccessToken.deleteMany({ where: { orderId: { in: orderIds } } }).catch(() => undefined);
      await h.prisma.order.deleteMany({ where: { id: { in: orderIds } } }).catch(() => undefined);
      await h.prisma.auditLog.deleteMany({ where: { entityType: 'InventoryItem', entityId: { in: ids } } });
      await h.prisma.inventoryMovement.deleteMany({ where: { itemId: { in: ids } } });
      await h.prisma.inventoryItem.deleteMany({ where: { id: { in: ids } } }).catch(() => undefined);
      await h.prisma.priceReference.deleteMany({ where: { cardId: { in: cardIds } } });
      await h.prisma.card.deleteMany({ where: { id: { in: cardIds } } }).catch(() => undefined);
      await h.prisma.cardSet.deleteMany({ where: { id: setId } }).catch(() => undefined);
      await h.close();
    }
  });

  it(`(a) PATCH language es→en con el recálculo retenido ⇒ quote, sesión, OrderItem y tienda dan el P vivo del inglés, 0/${N} con la fila vieja`, async () => {
    let bad = 0;
    let noMissingRow = 0;
    const lines: string[] = [];
    for (let i = 0; i < N; i += 1) {
      const cid = await card('Carta FV', [{ productType: 'raw', gradeKey: 'raw:NM', cents: 40_000 }]);
      const it = await item(cid, { language: 'es' });
      await lp.run('manual_price', [it.id]);
      const old = await row(it.id);
      expect(old.status).toBe('priced');
      expect(old.variantKey.endsWith('|v:es')).toBe(true);
      held = true;
      expect((await patch(it.id, { language: 'en' })).status).toBe(200);
      const pEn = await live(it.id);
      expect(typeof pEn).toBe('number');
      expect(pEn).not.toBe(old.unitPriceCents); // la prueba solo discrimina si los dos precios difieren

      const seen = await exhibited(cid, it.id);
      const q = await quote([it.id]);
      const s = await session([it.id], `ifv-${run}-a-${i}`);
      const line = s.status === 201 ? await h.prisma.orderItem.findFirst({ where: { orderId: s.body.orderId, inventoryItemId: it.id } }) : null;
      lines.push(line ? `${line.language}|${line.unitPriceCents}` : `sesión ${s.status}`);
      const wrong =
        q.status !== 201 && q.status !== 200
          ? true
          : q.body.items[0].unitPriceCents !== pEn ||
            q.body.items[0].version?.key !== 'en' ||
            line == null ||
            line.unitPriceCents !== pEn ||
            line.language !== 'en' ||
            seen.length === 0 ||
            seen.some((x) => x.cents === old.unitPriceCents || x.key !== 'en' || x.cents !== pEn);
      if (wrong) bad += 1;
      // `missing_row` encolado por el lector (con la pieza) — el `manual_price` del PATCH sigue retenido.
      if (!enqueued.some((e) => e.trigger === 'missing_row' && e.ids?.includes(it.id))) noMissingRow += 1;
      held = false;
      enqueued.length = 0;
    }
    // eslint-disable-next-line no-console
    console.log(
      `[IDS-B28 (a) forzada] fila vieja cobrada o exhibida ${bad}/${N} · sin missing_row ${noMissingRow}/${N} · líneas ${JSON.stringify(lines)}`,
    );
    expect([bad, noMissingRow]).toEqual([0, 0]);
  });

  it(`(b) el inglés SIN mercado ⇒ 422 PRICE_PENDING nombrando 'en' y fuera de la tienda, 0/${N} cobradas`, async () => {
    let bad = 0;
    for (let i = 0; i < N; i += 1) {
      const cid = await card('Carta FV sin mercado', [{ productType: 'raw', gradeKey: 'raw:NM', cents: 40_000 }]);
      const it = await item(cid, { language: 'es' });
      await lp.run('manual_price', [it.id]);
      expect((await row(it.id)).status).toBe('priced');
      await h.prisma.priceReference.deleteMany({ where: { cardId: cid } }); // la fila del día no se mueve (§DYN.5.5)
      held = true;
      expect((await patch(it.id, { language: 'en' })).status).toBe(200);
      expect(await live(it.id)).toBe('pending');
      const seen = await exhibited(cid, it.id);
      const q = await quote([it.id]);
      const s = await session([it.id], `ifv-${run}-b-${i}`);
      const named = (r: typeof q | typeof s) =>
        r.status === 422 && err(r)?.code === 'PRICE_PENDING' && err(r)?.details?.items?.some((x) => x.inventoryItemId === it.id && x.version.key === 'en');
      const nowStatus = (await h.prisma.inventoryItem.findUniqueOrThrow({ where: { id: it.id } })).status;
      if (!named(q) || !named(s) || seen.length > 0 || nowStatus !== 'listed') bad += 1;
      held = false;
      enqueued.length = 0;
    }
    // eslint-disable-next-line no-console
    console.log(`[IDS-B28 (b) forzada] inglés sin mercado cobrado o exhibido ${bad}/${N}`);
    expect(bad).toBe(0);
  });

  it(`(c) graduada listada, PATCH gradeValue 9→10 ⇒ la sesión cobra el grado NUEVO, 0/${N} con el viejo`, async () => {
    let bad = 0;
    const lines: string[] = [];
    for (let i = 0; i < N; i += 1) {
      const cid = await card('Carta FV graduada', [
        { productType: 'graded', gradeKey: 'graded:PSA:9', cents: 100_000 },
        { productType: 'graded', gradeKey: 'graded:PSA:10', cents: 250_000 },
      ]);
      const it = await item(cid, { productType: 'graded', rawCondition: null, gradingCompany: 'PSA', gradeValue: '9', certNumber: `IFV${run}${i}` });
      await lp.run('manual_price', [it.id]);
      const old = await row(it.id);
      expect(old.status).toBe('priced');
      held = true;
      expect((await patch(it.id, { gradeValue: '10' })).status).toBe(200);
      const p10 = await live(it.id);
      expect(typeof p10).toBe('number');
      expect(p10).not.toBe(old.unitPriceCents);
      const listing = await h.api<Priced>('GET', `/catalog/listings/${it.id}`);
      const s = await session([it.id], `ifv-${run}-c-${i}`);
      const line = s.status === 201 ? await h.prisma.orderItem.findFirst({ where: { orderId: s.body.orderId, inventoryItemId: it.id } }) : null;
      lines.push(line ? String(line.unitPriceCents) : `sesión ${s.status}`);
      if (line?.unitPriceCents !== p10 || listing.body.displayPriceCents !== p10) bad += 1;
      held = false;
      enqueued.length = 0;
    }
    // eslint-disable-next-line no-console
    console.log(`[IDS-B28 (c) forzada] grado viejo cobrado o exhibido ${bad}/${N} · líneas ${JSON.stringify(lines)}`);
    expect(bad).toBe(0);
  });

  it(`(d) corrida empezada ANTES del PATCH que escribe la fila vieja DESPUÉS ⇒ ignorada, 0/${N} cobradas`, async () => {
    let bad = 0;
    let wroteOld = 0;
    const lines: string[] = [];
    for (let i = 0; i < N; i += 1) {
      const cid = await card('Carta FV en vuelo', [{ productType: 'raw', gradeKey: 'raw:NM', cents: 40_000 }]);
      const it = await item(cid, { language: 'es' });
      // La barrera: la corrida lee la pieza (es) y se detiene ANTES de calcular; ahí entra el PATCH; luego escribe.
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      let reached!: () => void;
      const atGate = new Promise<void>((r) => (reached = r));
      const realLoad = decider.loadBatch.bind(decider);
      const spy = jest.spyOn(decider, 'loadBatch').mockImplementation(async (items) => {
        if (items.some((x) => x.id === it.id)) {
          spy.mockRestore();
          reached();
          await gate;
        }
        return realLoad(items);
      });
      const inFlight = lp.run('manual_price', [it.id]);
      await atGate;
      held = true;
      expect((await patch(it.id, { language: 'en' })).status).toBe(200);
      release();
      await inFlight;
      const late = await row(it.id);
      if (late.variantKey.endsWith('|v:es')) wroteOld += 1; // la corrida en vuelo escribió la versión de ANTES
      const pEn = await live(it.id);
      const s = await session([it.id], `ifv-${run}-d-${i}`);
      const line = s.status === 201 ? await h.prisma.orderItem.findFirst({ where: { orderId: s.body.orderId, inventoryItemId: it.id } }) : null;
      lines.push(line ? `${line.language}|${line.unitPriceCents}` : `sesión ${s.status}`);
      if (line?.unitPriceCents !== pEn || line?.language !== 'en' || line?.unitPriceCents === late.unitPriceCents) bad += 1;
      held = false;
      enqueued.length = 0;
    }
    // eslint-disable-next-line no-console
    console.log(`[IDS-B28 (d) forzada] corrida en vuelo con la fila vieja ${wroteOld}/${N} · cobrada ${bad}/${N} · líneas ${JSON.stringify(lines)}`);
    expect(wroteOld).toBe(N); // el escenario se dio (si no, la prueba no mide nada)
    expect(bad).toBe(0);
  });

  it(`(e) pieza de Destacadas pasada a 'es' ⇒ fuera de /catalog/featured (I-6), 0/${N} visibles`, async () => {
    let bad = 0;
    for (let i = 0; i < N; i += 1) {
      const cid = await card('Carta FV destacada', [{ productType: 'raw', gradeKey: 'raw:NM', cents: 40_000 }]);
      const it = await item(cid, { language: 'en' });
      await lp.run('manual_price', [it.id]);
      await h.prisma.featuredSelection.create({
        data: {
          businessDate: new Date(Date.UTC(2098, 0, 1 + i)),
          effectiveFrom: new Date(Date.now() - 1000),
          seed: `e2e-ifv-${run}-${i}`,
          dials: {},
          poolCount: 1,
          newArrivalCandidates: 0,
          items: { create: [{ position: 1, slotKind: 'pool', cardId: cid, productType: 'raw', gradeKey: 'raw:NM', finish: 'normal' }] },
        },
      });
      const before = await h.api<{ data: { card: { id: string } }[] }>('GET', '/catalog/featured');
      expect(before.body.data.filter((g) => g.card.id === cid)).toHaveLength(1); // el escenario se dio
      held = true;
      expect((await patch(it.id, { language: 'es' })).status).toBe(200);
      const after = await h.api<{ data: { card: { id: string } }[] }>('GET', '/catalog/featured');
      if (after.body.data.some((g) => g.card.id === cid)) bad += 1;
      held = false;
      enqueued.length = 0;
      await h.prisma.featuredSelection.deleteMany({ where: { seed: `e2e-ifv-${run}-${i}` } });
    }
    // eslint-disable-next-line no-console
    console.log(`[IDS-B28 (e) forzada] española en Destacadas ${bad}/${N}`);
    expect(bad).toBe(0);
  });
});
