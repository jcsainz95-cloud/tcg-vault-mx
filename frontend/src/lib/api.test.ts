import { describe, it, expect } from 'vitest';
import {
  getCatalog,
  getCatalogFacets,
  getPortfolioHistory,
  getBuylistQuote,
  batchQuote,
  BUYLIST_QUOTE_BATCH_MAX,
  loginWithGoogle,
  presignUpload,
  getAdminInventory,
  getAdminInventoryItem,
  updateInventoryItem,
  moveInventoryItem,
  markInventoryItem,
  createLocation,
} from './api';
import { getToken, setToken } from './api-client';

// Estas pruebas ejercitan la RAMA MOCK del cliente (config.useMocks = true por defecto
// en test, ya que NEXT_PUBLIC_USE_MOCKS !== 'false'). Verifican que las llamadas nuevas
// de v1.1 devuelven shapes del contrato sin backend (para Vercel).

describe('api (rama mock, v1.1)', () => {
  it('getCatalog filtra por rareza cruda (multi) sobre inventario publicado', async () => {
    const res = await getCatalog({ rarity: ['Illustration Rare'] });
    expect(res.data.length).toBeGreaterThan(0);
    expect(res.data.every((l) => l.card.rarity === 'Illustration Rare')).toBe(true);
  });

  it('getCatalog nunca devuelve items "precio pendiente" (Compra = solo con precio)', async () => {
    const res = await getCatalog({});
    expect(res.data.length).toBeGreaterThan(0);
    expect(res.data.every((l) => l.sellable && l.salePriceCents != null)).toBe(true);
  });

  it('getCatalog filtra por rango de precio (centavos)', async () => {
    const res = await getCatalog({ maxPriceCents: 50000 });
    expect(res.data.every((l) => (l.salePriceCents ?? 0) <= 50000)).toBe(true);
  });

  it('getCatalogFacets devuelve rarezas, sets con año (desc) y rango de precio', async () => {
    const f = await getCatalogFacets();
    expect(f.rarities.length).toBeGreaterThan(0);
    expect(f.sets.length).toBeGreaterThan(0);
    // sets ordenados por año descendente
    const years = f.sets.map((s) => s.year ?? 0);
    expect([...years].sort((a, b) => b - a)).toEqual(years);
    expect(f.price.currency).toBe('MXN');
  });

  it('getCatalogFacets expone las facetas de acabado (v1.6-finish)', async () => {
    const f = await getCatalogFacets();
    expect(f.finishes.length).toBeGreaterThan(0);
    // Todos los acabados de la faceta pertenecen al enum Finish.
    const valid = new Set(['normal', 'reverse_holo', 'holofoil', 'first_edition_holofoil']);
    expect(f.finishes.every((x) => valid.has(x))).toBe(true);
  });

  it('getCatalog filtra por acabado (v1.6-finish): solo listings de ese finish', async () => {
    const res = await getCatalog({ finish: 'reverse_holo' });
    expect(res.data.length).toBeGreaterThan(0);
    expect(res.data.every((l) => l.finish === 'reverse_holo')).toBe(true);
  });

  it('getPortfolioHistory devuelve serie ordenada + change con dirección', async () => {
    const h = await getPortfolioHistory('1m');
    expect(h.range).toBe('1m');
    expect(h.points.length).toBeGreaterThan(1);
    expect(['up', 'down', 'flat']).toContain(h.change.direction);
    // fechas ascendentes
    const dates = h.points.map((p) => p.date);
    expect([...dates].sort()).toEqual(dates);
  });

  it('buylist: rareza sin regla explícita (Ultra Rare) usa el fallback pct (40% de la referencia)', async () => {
    const q = await getBuylistQuote({ cardId: 'c-milotic-fa', productType: 'raw', rawCondition: 'NM' });
    expect(q.rarity).toBe('Ultra Rare');
    expect(q.appliedRule).toEqual({ mode: 'pct', value: 40, source: 'fallback' });
    expect(q.quote.status).toBe('cotizada');
    expect(q.quote.quotedPriceCents).toBe(Math.round(210000 * 0.4));
  });

  it('buylist: rareza con regla fija (Common) cotiza el monto fijo sin depender de la referencia', async () => {
    const q = await getBuylistQuote({ cardId: 'c-pikachu', productType: 'raw', rawCondition: 'NM' });
    expect(q.rarity).toBe('Common');
    expect(q.appliedRule).toEqual({ mode: 'fixed', value: 50, source: 'rule' });
    expect(q.quote.quotedPriceCents).toBe(50);
  });

  it('buylist: carta sin market price (Zapdos) escala a precio pendiente (adquisición)', async () => {
    const q = await getBuylistQuote({ cardId: 'c-zapdos', productType: 'raw', rawCondition: 'NM' });
    expect(q.quote.status).toBe('precio_pendiente');
    expect(q.quote.quotedPriceCents).toBeNull();
  });

  it('buylist (v1.6-finish): el acabado selecciona la regla — Common + reverse_holo = "Reverse Holo" fijo $1.50', async () => {
    const q = await getBuylistQuote({
      cardId: 'c-pikachu',
      productType: 'raw',
      rawCondition: 'NM',
      finish: 'reverse_holo',
    });
    // El backend deriva la regla del acabado (no de la rareza base): Reverse Holo fijo 150.
    expect(q.finish).toBe('reverse_holo');
    expect(q.appliedRule).toEqual({ mode: 'fixed', value: 150, source: 'rule' });
    expect(q.quote.quotedPriceCents).toBe(150);
  });

  it('buylist (v1.6-finish): sin finish la respuesta ecoa el default normal', async () => {
    const q = await getBuylistQuote({ cardId: 'c-pikachu', productType: 'raw', rawCondition: 'NM' });
    expect(q.finish).toBe('normal');
    expect(q.appliedRule).toEqual({ mode: 'fixed', value: 50, source: 'rule' });
  });

  // ---- Batch quote (contrato §6 · POST /buylist/quote/batch, v1.15) ----
  it('batchQuote (v1.15): cotiza N cartas en 1 request, ecoando index/cardId y el MISMO monto que el por-carta', async () => {
    const res = await batchQuote([
      { cardId: 'c-pikachu', productType: 'raw', rawCondition: 'NM' }, // Common → fixed 50
      { cardId: 'c-charizard', productType: 'raw', rawCondition: 'NM' }, // Rare Holo → fallback 40%
    ]);
    expect(res.results).toHaveLength(2);
    // index 0 = correlación posicional; cardId ecoado.
    const r0 = res.results[0];
    expect(r0).toMatchObject({ index: 0, cardId: 'c-pikachu', ok: true });
    if (r0.ok) expect(r0.quote.quotedPriceCents).toBe(50);
    const r1 = res.results[1];
    expect(r1).toMatchObject({ index: 1, cardId: 'c-charizard', ok: true });
    // Coincide EXACTAMENTE con el quote por-carta (misma función de precio).
    const single = await getBuylistQuote({ cardId: 'c-charizard', productType: 'raw', rawCondition: 'NM' });
    if (r1.ok) expect(r1.quote.quotedPriceCents).toBe(single.quote.quotedPriceCents);
  });

  it('batchQuote (v1.15): TOLERANTE por-ítem — una carta inexistente sale ok:false NOT_FOUND sin tumbar las demás', async () => {
    const res = await batchQuote([
      { cardId: 'c-pikachu', productType: 'raw', rawCondition: 'NM' },
      { cardId: 'c-does-not-exist', productType: 'raw', rawCondition: 'NM' },
    ]);
    // HTTP 200 con resultado/error por índice: la válida cotiza; la inválida trae su error.
    const ok = res.results[0];
    const bad = res.results[1];
    expect(ok.ok).toBe(true);
    expect(bad).toMatchObject({ index: 1, cardId: 'c-does-not-exist', ok: false });
    if (!bad.ok) expect(bad.error.code).toBe('NOT_FOUND');
  });

  it('batchQuote (v1.15): acabado fuera de availableFinishes sale ok:false FINISH_NOT_AVAILABLE (por-ítem, SEC-A1)', async () => {
    // Pikachu (Base Set) NO tiene holofoil disponible → error de ESE ítem, no del lote.
    const res = await batchQuote([
      { cardId: 'c-pikachu', productType: 'raw', rawCondition: 'NM', finish: 'holofoil' },
    ]);
    const r = res.results[0];
    expect(r).toMatchObject({ index: 0, cardId: 'c-pikachu', ok: false });
    if (!r.ok) expect(r.error.code).toBe('FINISH_NOT_AVAILABLE');
  });

  it('batchQuote (v1.15): vacío o sobre-cap (>50) es error de request (400 VALIDATION_ERROR)', async () => {
    await expect(batchQuote([])).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
    const overCap = Array.from({ length: BUYLIST_QUOTE_BATCH_MAX + 1 }, () => ({
      cardId: 'c-pikachu',
      productType: 'raw' as const,
      rawCondition: 'NM' as const,
    }));
    await expect(batchQuote(overCap)).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
  });

  it('presignUpload (mock) devuelve maxBytes como tope de tamaño del presign', async () => {
    const p = await presignUpload({ purpose: 'kyc_ine', contentType: 'image/jpeg', contentLength: 1234 });
    expect(p.uploadKey).toMatch(/^kyc_ine\//);
    expect(p.method).toBe('PUT');
    // El presign trae el límite de tamaño (fuente única de verdad en cliente).
    expect(typeof p.maxBytes).toBe('number');
    expect(p.maxBytes).toBeGreaterThan(0);
  });

  it('loginWithGoogle (mock) deja sesión y marca authProvider=google', async () => {
    setToken(null);
    const res = await loginWithGoogle('mock-id-token');
    expect(res.user.authProvider).toBe('google');
    expect(getToken()).toBe('mock.session.token');
  });
});

describe('api (rama mock) · M1 gestión de inventario (Ola 2)', () => {
  it('getAdminInventory pagina y filtra por status/zone/q (contrato §M1)', async () => {
    const all = await getAdminInventory();
    expect(all.page).toBe(1);
    expect(all.total).toBe(all.data.length);

    const listed = await getAdminInventory({ status: 'listed' });
    expect(listed.data.length).toBeGreaterThan(0);
    expect(listed.data.every((i) => i.status === 'listed')).toBe(true);

    const byFolio = await getAdminInventory({ q: 'inv-000110' });
    expect(byFolio.data.map((i) => i.folio)).toEqual(['INV-000110']);

    const byZone = await getAdminInventory({ zone: 'customer_custody' });
    expect(byZone.data.every((i) => i.location?.zone === 'customer_custody')).toBe(true);
  });

  it('getAdminInventoryItem devuelve el detalle + historial de movimientos', async () => {
    const detail = await getAdminInventoryItem('inv-1001');
    expect(detail.folio).toBe('INV-000101');
    expect(detail.movements.length).toBeGreaterThan(0);
    expect(detail.movements.some((m) => m.reason === 'alta')).toBe(true);
  });

  it('updateInventoryItem publica con listPriceCents y bloquea gradeada sin cert (mock de la invariante v1.2)', async () => {
    const updated = await updateInventoryItem('inv-1010', { status: 'listed', listPriceCents: 123456 });
    expect(updated.status).toBe('listed');
    expect(updated.listPriceCents).toBe(123456);
    // Revertir para no ensuciar otros asserts del archivo.
    await updateInventoryItem('inv-1010', { status: 'in_stock' });

    // Gradeada publicada exige certNumber: vaciarlo y publicar debe fallar 422.
    await expect(
      updateInventoryItem('inv-1001', { status: 'listed', certNumber: '' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('moveInventoryItem cambia la ubicación y registra el movimiento (reason=move)', async () => {
    const moved = await moveInventoryItem('inv-1010', { toLocationId: 'loc-1', note: 'reacomodo' });
    expect(moved.location?.id).toBe('loc-1');
    const detail = await getAdminInventoryItem('inv-1010');
    expect(detail.movements[0]).toMatchObject({ reason: 'move', toLocationId: 'loc-1', note: 'reacomodo' });
  });

  it('markInventoryItem marca perdida/dañada y registra el movimiento', async () => {
    const marked = await markInventoryItem('inv-1010', { mark: 'damaged', note: 'esquina doblada' });
    expect(marked.status).toBe('damaged');
    const detail = await getAdminInventoryItem('inv-1010');
    expect(detail.movements[0]).toMatchObject({ reason: 'damaged', toStatus: 'damaged' });
  });

  it('createLocation deriva label = box-row-slot y la deja disponible en getLocations', async () => {
    const created = await createLocation({ zone: 'platform_stock', box: 'C77', row: 'F03', slot: 'S09' });
    expect(created.label).toBe('C77-F03-S09');
    const byLocation = await getAdminInventory({ locationId: created.id });
    expect(byLocation.total).toBe(0);
  });
});
