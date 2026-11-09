/**
 * ids-capture.e2e-spec.ts — v1.116⟨ids⟩ (API_CONTRACT §IDS.4/§IDS.0 I-4, I-6) contra Postgres REAL y la app por HTTP.
 * Propiedad: backend.
 *  - IDS-B11 (530): alta de versión no default con `listPriceCents` ⇒ 422 `field=listPriceCents`; graded/sealed en `es` ⇒ 422
 *    `version_raw_only`; liga con acabado ajeno ⇒ 422 `FINISH_NOT_AVAILABLE`; liga de otra carta ⇒ `PRODUCT_CARD_MISMATCH`.
 *  - `GET …/cards/:cardId/versions`: combos (acabado × idioma) ∪ (liga × acabado × idioma) con `previewPriceCents` = el `P` del
 *    cuerpo único, o el motivo (`no_english_market`, `no_stamped_market`).
 *  - `PATCH language`: fuera de `in_stock|listed` ⇒ 409 `ITEM_NOT_ADJUSTABLE`; dentro ⇒ recalcula la fila (`manual_price`).
 *  - `GET /admin/inventory/items`: `version` por pieza y filtros `language`/`stamped`.
 *  - IDS-B13 (528, I-6): la buylist no cotiza un producto de liga; la lista de deseos no casa una pieza en español.
 * Deterministas (N=1).
 */
import { randomUUID } from 'crypto';
import { E2EHarness } from './helpers/e2e-app';
import { E2E_USERS } from '../../prisma/e2e-fixtures';
import { seedE2E } from '../../prisma/seed-e2e';
import { ListingPriceService } from '../../src/modules/pricing/listing-price.service';
import { listedPiecesFor } from '../../src/modules/wishlist/wishlist-pieces';
import { InventoryService } from '../../src/modules/inventory/inventory.service';
import * as ExcelJS from 'exceljs';

jest.setTimeout(120_000);

describe('E2E — §IDS.4 captura por versión', () => {
  let h: E2EHarness;
  let admin: string;
  let lp: ListingPriceService;
  const run = randomUUID().slice(0, 8);
  const pid = 600_000_000 + Math.floor(Math.random() * 90_000_000);
  const cardIds: string[] = [];
  let setId: string;
  let cardA: string;
  let cardB: string;
  let shelf: string | null;
  const today = () => new Date(new Date().toISOString().slice(0, 10));
  const err = (r: { body: unknown }) => (r.body as { error: { code: string; details?: Record<string, unknown> } }).error;

  async function card(n: number, finishes: ('normal' | 'holofoil' | 'reverse_holo')[]) {
    const c = await h.prisma.card.create({
      data: { externalId: `idc-${run}-${n}`, setId, name: `Carta Captura ${run} ${n}`, number: String(n), rarity: 'Common', rarityCanonical: 'Common', availableFinishes: finishes },
    });
    cardIds.push(c.id);
    return c.id;
  }
  const alta = (json: Record<string, unknown>) =>
    h.api<{ id: string; status: string }>('POST', '/admin/inventory/items', {
      token: admin,
      json: { productType: 'raw', rawCondition: 'NM', acquisitionType: 'compra', acquisitionCostCents: 1000, locationId: shelf ?? undefined, ...json },
    });

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedE2E(h.prisma);
    admin = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    lp = h.app.get(ListingPriceService);
    shelf = (await h.prisma.vaultLocation.findFirst({ where: { zone: 'platform_stock', isActive: true } }))?.id ?? null;
    setId = (await h.prisma.cardSet.create({ data: { externalId: `idc-${run}`, name: `Set Captura ${run}` } })).id;
    cardA = await card(1, ['normal', 'reverse_holo']);
    cardB = await card(2, ['normal']);
    await h.prisma.priceReference.create({
      data: { cardId: cardA, productType: 'raw', gradeKey: 'raw:NM', finish: 'normal', source: 'manual', priceMxnCents: 40_000, capturedDate: today(), isManualOverride: true, refKind: 'market' },
    });
    const cp = await h.prisma.cardProduct.create({
      data: { cardId: cardA, tcgplayerProductId: pid, kind: 'stamped', name: `Liga ${run} (Cosmos Holo)`, finishes: ['holofoil'], stampType: 'prize_pack', stampLabel: 'Cosmos Holo', sourceGroupId: 22880 },
    });
    await h.prisma.priceReference.create({
      data: { cardId: cardA, productType: 'raw', gradeKey: 'raw:NM', finish: 'holofoil', source: 'manual', cardProductId: cp.id, priceMxnCents: 90_000, capturedDate: today(), isManualOverride: true, refKind: 'market' },
    });
    await h.prisma.cardProduct.create({
      data: { cardId: cardB, tcgplayerProductId: pid + 1, kind: 'stamped', name: `Liga ${run} B`, finishes: ['normal'], stampType: 'league', sourceGroupId: 1539 },
    });
  });

  afterAll(async () => {
    if (h) {
      await lp?.idle();
      const ids = (await h.prisma.inventoryItem.findMany({ where: { cardId: { in: cardIds } }, select: { id: true } })).map((i) => i.id);
      await h.prisma.inventoryMovement.deleteMany({ where: { itemId: { in: ids } } });
      await h.prisma.inventoryItem.deleteMany({ where: { id: { in: ids } } });
      await h.prisma.priceReference.deleteMany({ where: { cardId: { in: cardIds } } });
      await h.prisma.pendingPriceEntry.deleteMany({ where: { cardId: { in: cardIds } } });
      await h.prisma.cardProduct.deleteMany({ where: { cardId: { in: cardIds } } });
      await h.prisma.card.deleteMany({ where: { id: { in: cardIds } } });
      await h.prisma.cardSet.deleteMany({ where: { id: setId } });
      await h.close();
    }
  });

  it('IDS-B11 (530): versión no default con precio ⇒ 422; graded en español ⇒ version_raw_only; acabado y carta de la liga validados', async () => {
    const price = await alta({ cardId: cardA, language: 'es', listPriceCents: 9_900 });
    expect([price.status, err(price).code, err(price).details?.field]).toEqual([422, 'VALIDATION_ERROR', 'listPriceCents']);
    const priceP = await alta({ cardId: cardA, cardProductId: pid, finish: 'holofoil', listPriceCents: 9_900 });
    expect([priceP.status, err(priceP).details?.field]).toEqual([422, 'listPriceCents']);
    const graded = await alta({ cardId: cardA, productType: 'graded', rawCondition: undefined, gradingCompany: 'PSA', gradeValue: '10', certNumber: `C-${run}`, language: 'es' });
    expect([graded.status, err(graded).details?.rule]).toEqual([422, 'version_raw_only']);
    const finish = await alta({ cardId: cardA, cardProductId: pid, finish: 'normal' });
    expect([finish.status, err(finish).code]).toEqual([422, 'FINISH_NOT_AVAILABLE']);
    const other = await alta({ cardId: cardA, cardProductId: pid + 1 });
    expect([other.status, err(other).code]).toEqual([422, 'PRODUCT_CARD_MISMATCH']);
    // Inglés normal sin nada nuevo: igual que hoy.
    const en = await alta({ cardId: cardA });
    expect(en.status).toBe(201);
    expect((await h.prisma.inventoryItem.findUniqueOrThrow({ where: { id: en.body.id } })).language).toBe('en');
    // Válidas: español y liga (con su acabado propio, aunque la carta base no lo tenga).
    const es = await alta({ cardId: cardA, language: 'es' });
    expect(es.status).toBe(201);
    const liga = await alta({ cardId: cardA, cardProductId: pid, finish: 'holofoil', language: 'es' });
    expect(liga.status).toBe(201);
    const row = await h.prisma.inventoryItem.findUniqueOrThrow({ where: { id: liga.body.id } });
    expect([row.language, row.cardProductId, row.finish, row.listPriceCents]).toEqual(['es', pid, 'holofoil', null]);
    expect(await h.prisma.pendingPriceEntry.count({ where: { cardId: cardA } })).toBe(0);
  });

  it('GET versions: combos con el P del cuerpo único o su motivo; sin candidatas', async () => {
    const r = await h.api<{ combos: { finish: string; finishLabel: string; language: string; stamp: { productId: number } | null; previewPriceCents: number | null; unavailableReason: string | null; baseReferenceMxnCents: number | null; appliedMarketPct: number | null }[]; candidates: unknown[] }>(
      'GET',
      `/admin/inventory/cards/${cardA}/versions`,
      { token: admin },
    );
    expect(r.status).toBe(200);
    const key = (c: { finish: string; language: string; stamp: { productId: number } | null }) => `${c.language}.${c.stamp?.productId ?? '-'}.${c.finish}`;
    expect(r.body.combos.map(key).sort()).toEqual(
      [`en.-.normal`, `es.-.normal`, `en.-.reverse_holo`, `es.-.reverse_holo`, `en.${pid}.holofoil`, `es.${pid}.holofoil`].sort(),
    );
    const by = new Map(r.body.combos.map((c) => [key(c), c]));
    expect(by.get('en.-.normal')!.previewPriceCents).toBeGreaterThan(0);
    expect(by.get('es.-.normal')!.previewPriceCents).toBeLessThan(by.get('en.-.normal')!.previewPriceCents!);
    expect(by.get('es.-.reverse_holo')).toMatchObject({ previewPriceCents: null, unavailableReason: 'no_english_market' });
    expect(by.get(`en.${pid}.holofoil`)).toMatchObject({ finishLabel: 'cosmos_holo', unavailableReason: null });
    expect(r.body.candidates).toEqual([]);
    // IDS-B20 (v1.116.2): desglose — base SIN X y el X aplicado.
    expect(by.get('en.-.normal')).toMatchObject({ baseReferenceMxnCents: 40_000, appliedMarketPct: null });
    expect(by.get('es.-.normal')).toMatchObject({ baseReferenceMxnCents: 40_000, appliedMarketPct: 75 });
    expect(by.get(`en.${pid}.holofoil`)).toMatchObject({ baseReferenceMxnCents: 90_000, appliedMarketPct: null });
    expect(by.get(`es.${pid}.holofoil`)).toMatchObject({ baseReferenceMxnCents: 90_000, appliedMarketPct: 75 });
    expect(by.get('es.-.reverse_holo')).toMatchObject({ baseReferenceMxnCents: null });
    const nf = await h.api('GET', `/admin/inventory/cards/no-existe-${run}/versions`, { token: admin });
    expect(nf.status).toBe(404);
  });

  it('PATCH language: reservada ⇒ 409; listada ⇒ cambia y la fila del día se recalcula', async () => {
    const a = await alta({ cardId: cardA });
    await h.prisma.inventoryItem.update({ where: { id: a.body.id }, data: { status: 'reserved' } });
    const busy = await h.api('PATCH', `/admin/inventory/items/${a.body.id}`, { token: admin, json: { language: 'es' } });
    expect([busy.status, err(busy).code]).toEqual([409, 'ITEM_NOT_ADJUSTABLE']);
    const b = await alta({ cardId: cardA });
    await lp.idle();
    await lp.run('publish', [b.body.id]);
    const before = await h.prisma.listingPrice.findUnique({ where: { inventoryItemId: b.body.id } });
    const ok = await h.api('PATCH', `/admin/inventory/items/${b.body.id}`, { token: admin, json: { language: 'es' } });
    expect(ok.status).toBe(200);
    await lp.idle();
    const after = await h.prisma.listingPrice.findUnique({ where: { inventoryItemId: b.body.id } });
    expect((await h.prisma.inventoryItem.findUniqueOrThrow({ where: { id: b.body.id } })).language).toBe('es');
    expect(before?.status).toBe('priced');
    expect(after?.unitPriceCents).toBeLessThan(before!.unitPriceCents!);
    expect(after?.variantKey).toBe(`${cardA}|raw|raw:NM|normal|v:es`);
  });

  it('GET items: `version` por pieza y filtros language / stamped', async () => {
    const es = await h.api<{ data: { cardId: string; language: string; version: { key: string } }[] }>(
      'GET',
      `/admin/inventory/items?cardId=${cardA}&language=es&pageSize=100`,
      { token: admin },
    );
    expect(es.status).toBe(200);
    expect(es.body.data.length).toBeGreaterThan(0);
    expect(es.body.data.every((d) => d.version.key.startsWith('es'))).toBe(true);
    const st = await h.api<{ data: { version: { key: string; stamp: { type: string; label: string | null } | null } }[] }>(
      'GET',
      `/admin/inventory/items?cardId=${cardA}&stamped=true&pageSize=100`,
      { token: admin },
    );
    expect(st.body.data.map((d) => d.version.key)).toEqual([`es.${pid}`]);
    expect(st.body.data[0].version.stamp).toMatchObject({ type: 'prize_pack', label: 'Cosmos Holo' });
    const none = await h.api<{ data: { version: { stamp: unknown } }[] }>('GET', `/admin/inventory/items?cardId=${cardA}&stamped=false&pageSize=100`, { token: admin });
    expect(none.body.data.every((d) => d.version.stamp === null)).toBe(true);
    const bad = await h.api('GET', `/admin/inventory/items?language=ja`, { token: admin });
    expect(bad.status).toBe(400);
  });

  it('IDS-B14 (527): export con columnas 19 «Idioma» y 20 «Liga»; mercado de una versión = el de su versión (×X)', async () => {
    const buf = await h.app.get(InventoryService).exportInventoryXlsx({ setId });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.getWorksheet('Inventario')!;
    const headers = (ws.getRow(1).values as unknown[]).slice(1);
    expect(headers.slice(18)).toEqual(['Idioma', 'Liga']);
    const rows = new Map<string, unknown[]>();
    ws.eachRow((r, n) => {
      if (n > 1) rows.set(String(r.getCell(1).value), (r.values as unknown[]).slice(1));
    });
    const pieces = await h.prisma.inventoryItem.findMany({ where: { cardId: cardA } });
    const en = pieces.find((p) => p.language === 'en' && p.cardProductId == null && p.finish === 'normal')!;
    const es = pieces.find((p) => p.language === 'es' && p.cardProductId == null)!;
    const liga = pieces.find((p) => p.cardProductId === pid)!;
    expect(rows.get(en.folio)!.slice(14, 15)).toEqual([400]);
    expect(rows.get(en.folio)!.slice(18)).toEqual(['Inglés', '']);
    expect(rows.get(es.folio)!.slice(14, 15)).toEqual([300]);
    expect(rows.get(es.folio)![18]).toBe('Español');
    expect(rows.get(liga.folio)!.slice(18)).toEqual(['Español', 'Prize Pack']);
  });

  it('IDS-B13 (528, I-6): la buylist no cotiza la liga y la lista de deseos no casa una pieza en español', async () => {
    const q = await h.api('POST', '/buylist/quote', { json: { cardId: cardA, productType: 'raw', productId: pid, finish: 'holofoil' } });
    expect([q.status, err(q).code]).toEqual([422, 'PRODUCT_NOT_FOUND']);
    const esListed = await h.prisma.inventoryItem.create({
      data: { folio: `IDC-${run}-W`, cardId: cardA, productType: 'raw', rawCondition: 'NM', finish: 'normal', status: 'listed', acquisitionType: 'compra', language: 'es' },
    });
    const enListed = await h.prisma.inventoryItem.create({
      data: { folio: `IDC-${run}-W2`, cardId: cardA, productType: 'raw', rawCondition: 'NM', finish: 'normal', status: 'listed', acquisitionType: 'compra' },
    });
    const matched = await listedPiecesFor(h.prisma, cardA, 'normal');
    expect(matched).toContain(enListed.id);
    expect(matched).not.toContain(esListed.id);
  });

  it('ID-3 (PROMOS_MASTERSET §4): el alta desde la CELDA DE SELLO del binder crea la pieza del SELLO (cardProductId), no la lisa', async () => {
    const b = await h.api<{ collectionPromos?: { items: { cardId: string; cardProductId?: number; stampType?: string; stampLabel?: string; variants: { finish: string }[] }[] } }>(
      'GET',
      `/admin/inventory/master-sets/${setId}`,
      { token: admin },
    );
    expect(b.status).toBe(200);
    const cell = b.body.collectionPromos?.items.find((c) => c.cardProductId === pid);
    expect(cell).toMatchObject({ cardId: cardA, cardProductId: pid, stampType: 'prize_pack', stampLabel: 'Cosmos Holo' });
    const totalAntes = await h.prisma.inventoryItem.count({ where: { cardProductId: pid } });
    // exactamente lo que enviaria el CellDrawer con la celda de sello
    const made = await alta({ cardId: cell!.cardId, cardProductId: cell!.cardProductId, finish: cell!.variants[0].finish });
    expect(made.status).toBe(201);
    const row = await h.prisma.inventoryItem.findUniqueOrThrow({ where: { id: made.body.id } });
    expect([row.cardId, row.cardProductId, row.finish]).toEqual([cardA, pid, 'holofoil']);
    // contraste: omitir cardProductId (el defecto que se evita) crea la LISA
    const plain = await alta({ cardId: cell!.cardId });
    expect((await h.prisma.inventoryItem.findUniqueOrThrow({ where: { id: plain.body.id } })).cardProductId).toBeNull();
    // y el conteo de la celda de sello cuenta SOLO la pieza del sello
    const after = await h.api<{ collectionPromos: { items: { cardProductId?: number; totalCount: number }[] } }>('GET', `/admin/inventory/master-sets/${setId}`, { token: admin });
    expect(after.body.collectionPromos.items.find((c) => c.cardProductId === pid)?.totalCount).toBe(totalAntes + 1); // la lisa creada arriba NO suma aqui
  });
});
