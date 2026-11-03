/**
 * ids-patrimony.e2e-spec.ts — 💰 IDS-B25 (API_CONTRACT §IDS.9, v1.116.4; criterio 531, D-IDS-R/S) contra Postgres REAL.
 * Propiedad: backend. Fixture propio (carta, set, productos, usuarios y piezas de la corrida); se borra al terminar.
 *
 * La puerta única de patrimonio (`PatrimonyValuationService.valuePieces`, §IDS.2 «Valor de patrimonio» `IDS-PAT`) da POR PIEZA
 * el mismo valor en todas las superficies que lo leen: «Mi bóveda» (`holdings`), su detalle, la reposición (`marketRefOf`),
 * `/admin/vaults`, la ficha 360° (`getUser.ownedItems`) y (Σ priced) `custody-value`; y, para copias de plataforma,
 * `inventory-value` y el export. Reglas que se afirman con números:
 *  - `(es, null)` = `⌊(R·X + 50)/100⌋` de la inglesa, con la `capturedDate` de `R_en` (no `''`);
 *  - promo con base cotizada ⇒ `pending` (D-IDS-S): fuera del total y +1 en `pendingPriceCount`;
 *  - sellado mapeado ⇒ su mercado; graduada sin slab ⇒ `pending`;
 *  - 💰 cambio de dinero declarado por el arquitecto: con un caso de revisión abierto en la inglesa (retenida R0, viva R1), la
 *    BÓVEDA del español vale `R1 × X` (sin retención: DYN.5.9 es solo de venta) y la VENTA del español se decide con `R0 × X`;
 *  - «Por reponer» de una promo ⇒ `M = null` ⇒ `R = Q` (lo pagado); retiro entregado de la promo sin origen ⇒ `409 no_reference`.
 * Determinista (N=1 por corrida; las mutaciones del contrato se miden aparte con N=3).
 */
import { randomUUID } from 'crypto';
import * as ExcelJS from 'exceljs';
import { Prisma } from '@prisma/client';
import { E2EHarness } from './helpers/e2e-app';
import { ShipPrepDb } from './helpers/ship-prep-db';
import { seedE2E } from '../../prisma/seed-e2e';
import { VaultService } from '../../src/modules/vault/vault.service';
import { AdminVaultsService } from '../../src/modules/vault/admin-vaults.service';
import { AdminService } from '../../src/modules/admin/admin.service';
import { InventoryService } from '../../src/modules/inventory/inventory.service';
import { SaleDecisionService, SaleItem } from '../../src/modules/pricing/sale-decision.service';
import { SettingsService } from '../../src/modules/settings/settings.service';
import { SEALED_SALE_PRICE_INCLUDE } from '../../src/common/money';
import { scaleByPct } from '../../src/common/card-version';

jest.setTimeout(180_000);

type Ref = { status: string; referenceMxnCents?: number; capturedDate?: string };

describe('IDS-B25 — 💰 una puerta de patrimonio: mismo valor por pieza en todas las superficies (531, D-IDS-R/S)', () => {
  let h: E2EHarness;
  let db: ShipPrepDb;
  const run = randomUUID().slice(0, 8);
  const base = 300_000_000 + Math.floor(Math.random() * 90_000_000);
  const stampedPid = base;
  const promoPid = base + 1;
  const sealedPid = base + 2;
  const X = 75;
  const R = 40_000; // inglés (manual: tier 0, sin retención)
  const RP = 90_000; // producto de liga
  const S = 70_000; // sellado mapeado (manual: pasa el gate del dial)
  const R0 = 40_000; // retenida (base del caso)
  const R1 = 50_000; // viva (automática)
  const day = (n: number) => new Date(new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10));
  const enDate = day(3);
  let savedDial: Prisma.JsonValue | undefined;
  let setId: string;
  let cardId: string;
  let lockedCardId: string;
  let userId: string;
  const pieceIds: string[] = [];
  let seq = 0;

  async function piece(data: Partial<Prisma.InventoryItemUncheckedCreateInput> & { ownerType?: 'customer' | 'platform' }) {
    seq += 1;
    const customer = (data.ownerType ?? 'customer') === 'customer';
    const p = await h.prisma.inventoryItem.create({
      data: {
        folio: `IDP-${run}-${String(seq).padStart(3, '0')}`,
        cardId,
        productType: 'raw',
        rawCondition: 'NM',
        finish: 'normal',
        acquisitionType: 'compra',
        acquisitionCostCents: 100,
        ...(customer ? { ownerType: 'customer', ownerUserId: userId, ownershipStatus: 'settled', status: 'in_custody' } : { ownerType: 'platform', status: 'in_stock' }),
        ...data,
      } as Prisma.InventoryItemUncheckedCreateInput,
    });
    pieceIds.push(p.id);
    return p;
  }

  /** Las siete piezas de la tabla del contrato, con su valor esperado (`null` ⇒ pending). */
  async function sevenPieces(ownerType: 'customer' | 'platform') {
    const rows = [
      { tag: 'en', data: {}, want: R },
      { tag: 'es', data: { language: 'es' as const }, want: scaleByPct(R, X) },
      { tag: 'enP', data: { cardProductId: stampedPid }, want: RP },
      { tag: 'esP', data: { language: 'es' as const, cardProductId: stampedPid }, want: scaleByPct(RP, X) },
      { tag: 'promo', data: { cardProductId: promoPid }, want: null },
      { tag: 'sealed', data: { productType: 'sealed' as const, rawCondition: null, tcgplayerProductId: sealedPid, sealedCondition: 'mint' as const }, want: S },
      { tag: 'gradedNoSlab', data: { productType: 'graded' as const, rawCondition: null, gradingCompany: null, gradeValue: null }, want: null },
    ];
    const out: { tag: string; id: string; want: number | null }[] = [];
    for (const r of rows) out.push({ tag: r.tag, id: (await piece({ ...r.data, ownerType })).id, want: r.want });
    return out;
  }

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedE2E(h.prisma);
    db = new ShipPrepDb(h, `idpat${run.slice(0, 5)}`);
    await db.init();
    savedDial = (await h.prisma.configSetting.findUnique({ where: { key: 'spanish_market_pct' } }))?.valueJson;
    await h.prisma.configSetting.upsert({ where: { key: 'spanish_market_pct' }, create: { key: 'spanish_market_pct', valueJson: X }, update: { valueJson: X } });
    setId = (await h.prisma.cardSet.create({ data: { externalId: `idp-${run}`, name: `Set Patrimonio ${run}` } })).id;
    cardId = (await h.prisma.card.create({ data: { externalId: `idp-${run}-1`, setId, name: `Carta Patrimonio ${run}`, number: '1', rarity: 'Common', availableFinishes: ['normal'] } })).id;
    lockedCardId = (await h.prisma.card.create({ data: { externalId: `idp-${run}-2`, setId, name: `Carta Candado ${run}`, number: '2', rarity: 'Common', availableFinishes: ['normal'] } })).id;
    userId = (await h.prisma.user.create({ data: { email: `idp.${run}@e2e.local`, name: 'Cliente Patrimonio', role: 'customer' } })).id;
    await h.prisma.priceReference.create({
      data: { cardId, productType: 'raw', gradeKey: 'raw:NM', finish: 'normal', source: 'manual', priceMxnCents: R, capturedDate: enDate, isManualOverride: true, refKind: 'market' },
    });
    const stamped = await h.prisma.cardProduct.create({
      data: { cardId, tcgplayerProductId: stampedPid, kind: 'stamped', name: `Liga ${run}`, finishes: ['normal'], stampType: 'prize_pack', sourceGroupId: 22880 },
    });
    await h.prisma.priceReference.create({
      data: { cardId, productType: 'raw', gradeKey: 'raw:NM', finish: 'normal', source: 'manual', cardProductId: stamped.id, priceMxnCents: RP, capturedDate: day(0), isManualOverride: true, refKind: 'market' },
    });
    // Promo de la MISMA carta, sin precio propio: la base (R) existe y ⛔ no puede valuarla (D-IDS-S).
    await h.prisma.cardProduct.create({ data: { cardId, tcgplayerProductId: promoPid, kind: 'promo', name: `Promo ${run}`, finishes: ['normal'] } });
    await h.prisma.priceReference.create({
      data: { cardId, productType: 'sealed', gradeKey: `sealed:tcg:${sealedPid}`, finish: 'normal', source: 'manual', priceMxnCents: S, capturedDate: day(0), isManualOverride: true, refKind: 'market' },
    });
    // Caso de revisión ABIERTO en la inglesa de la carta del candado: viva R1 (automática), retenida R0 (base del caso).
    await h.prisma.priceReference.create({
      data: { cardId: lockedCardId, productType: 'raw', gradeKey: 'raw:NM', finish: 'normal', source: 'tcgcsv_singles', priceMxnCents: R1, capturedDate: day(0), refKind: 'market' },
    });
    await h.prisma.priceReviewCase.create({
      data: {
        cardId: lockedCardId, productType: 'raw', gradeKey: 'raw:NM', finish: 'normal', axis: 'sell', proposedMxnCents: R1, baselineMxnCents: R0,
        jumpFactorMilli: 1250, sourceCount: 1, familyCount: 1, consensus: false, quotesSnapshot: [], status: 'open',
      },
    });
  });

  afterAll(async () => {
    if (h) {
      if (savedDial === undefined) await h.prisma.configSetting.deleteMany({ where: { key: 'spanish_market_pct' } });
      else await h.prisma.configSetting.update({ where: { key: 'spanish_market_pct' }, data: { valueJson: savedDial as Prisma.InputJsonValue } });
      await db?.cleanup();
      await h.prisma.inventoryItem.deleteMany({ where: { id: { in: pieceIds } } });
      await h.prisma.priceReviewCase.deleteMany({ where: { cardId: { in: [cardId, lockedCardId] } } });
      await h.prisma.priceReference.deleteMany({ where: { cardId: { in: [cardId, lockedCardId] } } });
      await h.prisma.cardProduct.deleteMany({ where: { cardId } });
      await h.prisma.card.deleteMany({ where: { id: { in: [cardId, lockedCardId] } } });
      await h.prisma.cardSet.deleteMany({ where: { id: setId } });
      await h.prisma.user.deleteMany({ where: { id: userId } });
      await h.close();
    }
  });

  const cents = (r: Ref | undefined | null): number | null => (r?.status === 'priced' && r.referenceMxnCents != null ? r.referenceMxnCents : null);

  it('cliente: holdings, detalle, marketRefOf, /admin/vaults, ficha 360° y custody-value dan por pieza el MISMO valor', async () => {
    const vault = h.app.get(VaultService);
    const admin = h.app.get(AdminService);
    const custodyBefore = (await admin.custodyValue()).totalCustodyValueCents;
    const ps = await sevenPieces('customer');
    const want = new Map(ps.map((p) => [p.id, p.want]));
    const pricedSum = ps.reduce((s, p) => s + (p.want ?? 0), 0);
    const pendingN = ps.filter((p) => p.want == null).length;
    expect(pendingN).toBe(2); // promo + graduada sin slab: la promo es el +1 de D-IDS-S

    // «Mi bóveda»
    const hold = (await vault.holdings(userId)) as unknown as { data: { inventoryItemId: string; referenceValue: Ref }[]; portfolio: { totalValueMxnCents: number; pendingPriceCount: number } };
    const byHold = new Map(hold.data.map((r) => [r.inventoryItemId, cents(r.referenceValue)]));
    expect(Object.fromEntries(ps.map((p) => [p.tag, byHold.get(p.id)]))).toEqual(Object.fromEntries(ps.map((p) => [p.tag, p.want])));
    expect(hold.portfolio).toMatchObject({ totalValueMxnCents: pricedSum, pendingPriceCount: pendingN });

    // Detalle y reposición (M), pieza por pieza
    for (const p of ps) {
      const d = (await vault.holdingDetail(userId, p.id)) as unknown as { referenceValue: Ref };
      expect({ tag: p.tag, detail: cents(d.referenceValue) }).toEqual({ tag: p.tag, detail: p.want });
      const item = await h.prisma.inventoryItem.findUniqueOrThrow({ where: { id: p.id } });
      const m = await vault.marketRefOf(item);
      expect({ tag: p.tag, m: m?.cents ?? null }).toEqual({ tag: p.tag, m: p.want });
    }
    // `marketRefOf(es).capturedDate` = la de R_en (no `''`).
    const esItem = await h.prisma.inventoryItem.findUniqueOrThrow({ where: { id: ps.find((p) => p.tag === 'es')!.id } });
    expect((await vault.marketRefOf(esItem))?.capturedDate).toBe(enDate.toISOString().slice(0, 10));

    // /admin/vaults
    const av = (await h.app.get(AdminVaultsService).list({ q: `idp.${run}`, page: 1, pageSize: 10, sort: 'value_desc' })) as unknown as {
      data: { userId: string; totalValueMxnCents: number; pendingPriceCount: number; pieceCount: number }[];
    };
    expect(av.data.find((r) => r.userId === userId)).toMatchObject({ totalValueMxnCents: pricedSum, pendingPriceCount: pendingN, pieceCount: ps.length });

    // Ficha 360° (`ownedItemRefs`)
    const u = (await admin.getUser(userId, 'super_admin')) as unknown as { ownedItems: { inventoryItemId: string; referenceValue: Ref }[] };
    const by360 = new Map(u.ownedItems.map((r) => [r.inventoryItemId, cents(r.referenceValue)]));
    expect(Object.fromEntries(ps.map((p) => [p.tag, by360.get(p.id)]))).toEqual(Object.fromEntries(ps.map((p) => [p.tag, p.want])));

    // custody-value: Σ priced (los pending no suman)
    expect((await admin.custodyValue()).totalCustodyValueCents - custodyBefore).toBe(pricedSum);
    expect(want.size).toBe(7);
  });

  it('plataforma: inventory-value y el export («Precio mercado MXN») dan los mismos números', async () => {
    const admin = h.app.get(AdminService);
    const before = await admin.inventoryValue();
    const ps = await sevenPieces('platform');
    const after = await admin.inventoryValue();
    const pricedSum = ps.reduce((s, p) => s + (p.want ?? 0), 0);
    expect(after.atReferenceCents - before.atReferenceCents).toBe(pricedSum);
    expect(after.pendingPriceCount - before.pendingPriceCount).toBe(2);

    const buf = await h.app.get(InventoryService).exportInventoryXlsx({ setId });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
    const sheet = wb.getWorksheet('Inventario')!;
    const header = (sheet.getRow(1).values as unknown[]).map((v) => String(v ?? ''));
    const colFolio = header.indexOf('Folio');
    const colMarket = header.indexOf('Precio mercado MXN');
    expect(colFolio).toBeGreaterThan(0);
    expect(colMarket).toBeGreaterThan(0);
    const byFolio = new Map<string, number | null>();
    sheet.eachRow((row, i) => {
      if (i === 1) return;
      const v = row.getCell(colMarket).value;
      byFolio.set(String(row.getCell(colFolio).value), v == null || v === '' ? null : Math.round(Number(v) * 100));
    });
    const folios = await h.prisma.inventoryItem.findMany({ where: { id: { in: ps.map((p) => p.id) } }, select: { id: true, folio: true } });
    const folioOf = new Map(folios.map((f) => [f.id, f.folio]));
    expect(Object.fromEntries(ps.map((p) => [p.tag, byFolio.get(folioOf.get(p.id)!)]))).toEqual(Object.fromEntries(ps.map((p) => [p.tag, p.want])));
  });

  it('💰 caso de revisión abierto en la inglesa (retenida R0, viva R1): bóveda `es` = R1 × X; venta `es` con R0 × X', async () => {
    const es = await piece({ cardId: lockedCardId, language: 'es' });
    const hold = (await h.app.get(VaultService).holdings(userId)) as unknown as { data: { inventoryItemId: string; referenceValue: Ref }[] };
    expect(cents(hold.data.find((r) => r.inventoryItemId === es.id)?.referenceValue)).toBe(scaleByPct(R1, X));
    // La venta: el cuerpo único con la retención de DYN.5.9 (instrumentación = la referencia de entrada ya con X).
    const sale = (await h.prisma.inventoryItem.findUniqueOrThrow({
      where: { id: es.id },
      include: { card: { include: { set: true } }, ...SEALED_SALE_PRICE_INCLUDE },
    })) as unknown as SaleItem;
    const d = await h.app.get(SaleDecisionService).decide(sale, await h.app.get(SettingsService).getIvaDials());
    expect(d.marketMxnCents).toBe(scaleByPct(R0, X));
    expect(scaleByPct(R1, X)).not.toBe(scaleByPct(R0, X)); // el caso distingue de verdad
  });

  it('D-IDS-S: «Por reponer» de una promo ⇒ `M = null` ⇒ `referenceCents == paidReferenceCents`; retiro entregado de la promo sin origen ⇒ 409 no_reference', async () => {
    // (a) Caso «Por reponer» con origen: la pieza 0 de una orden vault es una promo de la carta con base cotizada.
    const u = await db.mkUser('Promo Caso');
    const drawer = await db.mkDrawer();
    const vo = await db.mkVaultOrder(u.id, { prices: [50000, 30000], placement: 'pending', locationId: drawer.id, cardIds: [cardId, cardId] });
    await h.prisma.inventoryItem.update({ where: { id: vo.pieces[0].id }, data: { cardProductId: promoPid } });
    const placement = vo.placement!;
    const items = await h.prisma.vaultPlacementItem.findMany({ where: { placementId: placement.id } });
    const it0 = items.find((i) => i.inventoryItemId === vo.pieces[0].id)!;
    for (const it of items) if (it.id !== it0.id) expect((await db.vpMark(placement.id, it.id, { status: 'picked' })).status).toBe(200);
    expect((await db.vpMark(placement.id, it0.id, { status: 'missing', missingReason: 'not_found' })).status).toBe(200);
    expect((await db.vpPrepare(placement.id)).status).toBe(200);
    const conf = await db.vpConfirm(placement.id, { locationId: drawer.id });
    expect(conf.status).toBe(200);
    const caseId: string = conf.body.items.find((i: { result: string }) => i.result === 'missing').caseId;
    const ctx = (await db.caseGet(caseId, db.adminToken)).body.refundContext;
    expect(ctx).toMatchObject({ available: true, market: null });
    expect(ctx.referenceCents).toBe(ctx.paidReferenceCents);

    // (b) Retiro ENTREGADO de una promo SIN pedido de origen ⇒ sin Q y sin M ⇒ 409 no_reference (bloquea; ⛔ nunca paga 0).
    const u2 = await db.mkUser('Promo Sin Origen');
    const p = await db.mkPiece({ status: 'in_custody', ownerType: 'customer', ownerUserId: u2.id, ownershipStatus: 'settled', cardId });
    await h.prisma.inventoryItem.update({ where: { id: p.id }, data: { cardProductId: promoPid } });
    const w = await db.mkWithdrawal(u2.id, [p.id], 'entregado');
    const r = await h.api('GET', `/admin/manual-refunds/withdrawal-delivered/preview?shipmentItemId=${w.lines[0].id}`, { token: db.adminToken });
    expect(r.status).toBe(409);
    expect(r.body.error.details).toEqual({ reason: 'no_reference' });
  });
});
