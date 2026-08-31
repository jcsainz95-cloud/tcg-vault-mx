import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
  createCheckoutSession,
  createShipment,
  listAddresses,
  createAddress,
  updateAddress,
  deleteAddress,
  updateAdminShipmentStatus,
  respondSellRequest,
  createDispute,
  getDisputes,
  getSellRequests,
  decideBuylistItem,
  getAdminRejectedBuylistItems,
} from './api';
import { getToken, setToken } from './api-client';
import { config } from './config';
import * as fx from './mock/fixtures';

// Estas pruebas ejercitan la RAMA MOCK del cliente (config.useMocks = true por defecto
// en test: `vitest.config.ts` declara NEXT_PUBLIC_USE_MOCKS='true'). Verifican que las llamadas nuevas
// de v1.1 devuelven shapes del contrato sin backend (para Vercel).

describe('api (rama mock, v1.1)', () => {
  it('getCatalog filtra por rareza cruda (multi) sobre inventario publicado', async () => {
    const res = await getCatalog({ rarity: ['Illustration Rare'] });
    expect(res.data.length).toBeGreaterThan(0);
    expect(res.data.every((l) => l.card.rarity === 'Illustration Rare')).toBe(true);
  });

  it('getCatalog nunca devuelve grupos "precio pendiente" ni agotados (Compra = con precio y stock)', async () => {
    const res = await getCatalog({});
    expect(res.data.length).toBeGreaterThan(0);
    // v1.38-grouped-listings: cada GRUPO trae stockCount≥1 (vivo) y salePriceCents del grupo (nunca 0).
    expect(res.data.every((g) => g.stockCount >= 1 && g.salePriceCents > 0)).toBe(true);
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

  it('buylist v2.0: la cotización sale de la CURVA sobre el mercado — la rareza NO la decide', async () => {
    // Ultra Rare y Common cotizan por el MISMO camino (curva sobre el mercado de su variante): la
    // rareza viaja como dato informativo del catálogo, no como selector de regla (criterio 84).
    const ultra = await getBuylistQuote({ cardId: 'c-milotic-fa', productType: 'raw', rawCondition: 'NM' });
    expect(ultra.rarity).toBe('Ultra Rare');
    expect(ultra.priceBasis).toBe('market');
    expect(ultra.quote.status).toBe('cotizada');
    // ref MX$2,100 > último punto (MX$500) ⇒ tramo plano final 50% ⇒ MX$1,050.
    expect(ultra.quote.quotedPriceCents).toBe(105_000);

    const common = await getBuylistQuote({ cardId: 'c-pikachu', productType: 'raw', rawCondition: 'NM' });
    expect(common.rarity).toBe('Common');
    expect(common.priceBasis).toBe('market');
    // Una Common cara deja de cotizar al bin de bulk: el mercado manda (era el bug de P-48).
    // ref MX$95 cae en el tramo $25→$100 ⇒ pct interpolado 39.33% ⇒ MX$37.36.
    expect(common.quote.quotedPriceCents).toBe(3_736);
  });

  /**
   * El mock del cotizador INTERPOLA (v2.1.7). Antes aplicaba el pct del primer punto a todo el
   * dominio: QA midió **67% de diferencia** contra el backend vivo (MX$300 vs MX$500 para un
   * mercado de MX$1,000) con constantes idénticas — divergencia pura de evaluación. Este test fija
   * que el modo demo reproduce la **prueba de mesa normativa** del eje de compra (ARCHITECTURE
   * §4.36.1), que es lo que lo vuelve una demo honesta en vez de una cifra inventada.
   *
   * Sigue sin ser la autoridad: el monto que se paga lo deriva SIEMPRE el backend (SEC-A1).
   */
  it('el mock del cotizador reproduce la prueba de mesa de COMPRA (§4.36.1)', () => {
    const table: [number, number][] = [
      [50, 100], // gana el bin
      [1_000, 300], // 30% (tramo plano inicial)
      [2_500, 750], // 30% (punto exacto)
      [10_000, 4_000], // 40% (punto exacto)
      [30_000, 13_500], // 45% interpolado
      [50_000, 25_000], // 50% (punto exacto)
    ];
    for (const [marketCents, expected] of table) {
      expect(fx.mockDemoBuyQuote(marketCents).cents, `mercado ${marketCents}`).toBe(expected);
    }
    // Sin dato de mercado NO se cotiza: el bin no rellena el hueco (§4.36.0).
    expect(fx.mockDemoBuyQuote(null)).toEqual({ cents: null, basis: 'pending' });
  });

  it('buylist v2.0: `appliedRule` YA NO existe en la respuesta (no hay reglas, hay curva)', async () => {
    const q = await getBuylistQuote({ cardId: 'c-pikachu', productType: 'raw', rawCondition: 'NM' });
    expect('appliedRule' in q).toBe(false);
  });

  it('buylist: carta sin market price (Zapdos) escala a precio pendiente (adquisición)', async () => {
    const q = await getBuylistQuote({ cardId: 'c-zapdos', productType: 'raw', rawCondition: 'NM' });
    expect(q.quote.status).toBe('precio_pendiente');
    expect(q.quote.quotedPriceCents).toBeNull();
  });

  it('buylist v2.0: el acabado YA NO selecciona regla — solo elige DE QUÉ VARIANTE se lee el mercado', async () => {
    const q = await getBuylistQuote({
      cardId: 'c-pikachu',
      productType: 'raw',
      rawCondition: 'NM',
      finish: 'reverse_holo',
    });
    expect(q.finish).toBe('reverse_holo');
    expect(q.priceBasis).toBe('market');
    // Mismo cálculo que en `normal`, sobre el mercado del reverse (ref × 1.25 = MX$118.75 en el
    // mock): el acabado dejó de tener regla de precio propia (§N.4). Con el pct interpolado del
    // tramo $25→$100 ⇒ MX$48.06.
    expect(q.quote.quotedPriceCents).toBe(4_806);
  });

  it('buylist (v1.6-finish): sin finish la respuesta ecoa el default normal', async () => {
    const q = await getBuylistQuote({ cardId: 'c-pikachu', productType: 'raw', rawCondition: 'NM' });
    expect(q.finish).toBe('normal');
    expect(q.priceBasis).toBe('market');
  });

  // ---- Batch quote (contrato §6 · POST /buylist/quote/batch, v1.15) ----
  it('batchQuote (v1.15): cotiza N cartas en 1 request, ecoando index/cardId y el MISMO monto que el por-carta', async () => {
    const res = await batchQuote([
      { cardId: 'c-pikachu', productType: 'raw', rawCondition: 'NM' },
      { cardId: 'c-charizard', productType: 'raw', rawCondition: 'NM' },
    ]);
    expect(res.results).toHaveLength(2);
    // index 0 = correlación posicional; cardId ecoado.
    const r0 = res.results[0];
    expect(r0).toMatchObject({ index: 0, cardId: 'c-pikachu', ok: true });
    if (r0.ok) expect(r0.quote.quotedPriceCents).toBe(3_736);
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

// ---- WS-F · flujos de dinero del cliente (rama MOCK) ----
describe('api (rama mock) · WS-F checkout + shipments + direcciones', () => {
  it('createCheckoutSession devuelve orderId, breakdown y stripe.clientSecret (contrato §4)', async () => {
    // v1.38-grouped-listings: el catálogo devuelve GRUPOS; el add-to-cart de 1 usa la pieza
    // representativa (más barata). El carrito/checkout sigue por-pieza (inventoryItemId).
    const group = (await getCatalog({})).data[0];
    const res = await createCheckoutSession([group.representativeInventoryItemId]);
    expect(res.orderId).toMatch(/^ord-/);
    expect(res.stripe.clientSecret).toBeTruthy();
    expect(res.stripe.paymentIntentId).toBeTruthy();
    // El total = subtotal + IVA + fee (BreakdownDTO); mayor que el subtotal de la carta.
    expect(res.breakdown.totalCents).toBeGreaterThan(group.salePriceCents);
  });

  it('createShipment cobra el envío settled y devuelve clientSecret; MX-only y ITEM_NOT_SETTLED', async () => {
    // inv-1002 (Blastoise) es settled; addr-1 es MX en fixtures.
    const res = await createShipment(['inv-1002'], 'addr-1');
    expect(res.shipmentId).toMatch(/^shp-/);
    expect(res.status).toBe('solicitado');
    expect(res.stripe.clientSecret).toBeTruthy();
    expect(res.breakdown.subtotalCents).toBe(17500); // tarifa fija MX$175

    // inv-1006 (Latias) es pending → 422 ITEM_NOT_SETTLED.
    await expect(createShipment(['inv-1006'], 'addr-1')).rejects.toMatchObject({
      code: 'ITEM_NOT_SETTLED',
      status: 422,
    });
  });

  it('CRUD de direcciones: list → create (MX) → set default → delete (contrato §1)', async () => {
    const before = await listAddresses();
    const created = await createAddress({
      line1: 'Calle 5 de Mayo 10',
      city: 'Puebla',
      state: 'Puebla',
      postalCode: '72000',
      country: 'MX',
      phone: '2221234567',
      isDefault: true,
    });
    expect(created.id).toBeTruthy();
    const after = await listAddresses();
    expect(after.length).toBe(before.length + 1);
    // isDefault=true deja como no-default a las demás.
    expect(after.filter((a) => a.isDefault).length).toBe(1);

    const updated = await updateAddress(created.id, { city: 'Cholula' });
    expect(updated.city).toBe('Cholula');

    await deleteAddress(created.id);
    const final = await listAddresses();
    expect(final.find((a) => a.id === created.id)).toBeUndefined();
  });

  it('createAddress rechaza país != MX (422 ADDRESS_NOT_MX)', async () => {
    await expect(
      createAddress({
        line1: '5th Ave 1',
        city: 'NYC',
        state: 'NY',
        postalCode: '10001',
        country: 'US',
        phone: '2120000000',
      }),
    ).rejects.toMatchObject({ code: 'ADDRESS_NOT_MX', status: 422 });
  });
});

describe('api (rama mock) · WS-F Pass 2 (F4/F5/F6)', () => {
  it('F4 · updateAdminShipmentStatus permite la transición legal y devuelve el nuevo estado', async () => {
    // shp-7001 está en `enviado`; enviado→entregado es legal (tabla TRANSITIONS).
    const res = await updateAdminShipmentStatus('shp-7001', 'entregado');
    expect(res.status).toBe('entregado');
  });

  it('F4 · updateAdminShipmentStatus rechaza una transición ilegal con 409 CONFLICT', async () => {
    // shp-7002 está en `entregado` (terminal): cualquier transición es ilegal.
    await expect(updateAdminShipmentStatus('shp-7002', 'picking')).rejects.toMatchObject({
      code: 'CONFLICT',
      status: 409,
    });
  });

  it('F5 · respondSellRequest accept mueve los ítems `ajustada` → `aprobada`', async () => {
    const res = await respondSellRequest('sr-3002', 'accept');
    expect(res.status).toBe('aprobada');
    const list = await getSellRequests();
    const req = list.find((r) => r.sellRequestId === 'sr-3002')!;
    expect(req.items.every((it) => it.itemStatus !== 'ajustada')).toBe(true);
    expect(req.items.some((it) => it.itemStatus === 'aprobada')).toBe(true);
  });

  it('F6 · createDispute abre disputa sobre ítem raw entregado (type derivado server-side)', async () => {
    // inv-1003 (Charizard raw) va en el envío entregado shp-7002 (dentro de ventana).
    const res = await createDispute({ inventoryItemId: 'inv-1003', description: 'Corner wear on arrival' });
    expect(res.disputeId).toMatch(/^dsp-/);
    expect(res.status).toBe('abierta');
    expect(res.type).toBe('condition_raw');
    expect(res.evidenceContact).toContain('@');
    // Aparece en "Mis disputas".
    const disputes = await getDisputes();
    expect(disputes.some((d) => d.inventoryItemId === 'inv-1003')).toBe(true);
  });

  it('F6 · createDispute rechaza un ítem GRADEADO con 422 NOT_RAW', async () => {
    // inv-1006 (Latias graded) va en shp-7002 → no aplica disputa de condición.
    await expect(
      createDispute({ inventoryItemId: 'inv-1006', description: 'anything' }),
    ).rejects.toMatchObject({ code: 'NOT_RAW', status: 422 });
  });

  // ---- v1.18-buylist-rejects (§M5) ----
  it('v1.18 · decideBuylistItem reject SIN motivo (o corto) → 400 VALIDATION_ERROR (espeja al backend)', async () => {
    await expect(decideBuylistItem('sri-9', { decision: 'reject' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      status: 400,
    });
    await expect(
      decideBuylistItem('sri-9', { decision: 'reject', reason: 'ab' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
  });

  it('v1.18 · reject con motivo fija rejectedAt + plazos (7d/30d), anula el precio aprobado y aparece en rejected-items', async () => {
    const res = await decideBuylistItem('sri-9', {
      decision: 'reject',
      reason: 'no es NM: doblez central',
    });
    expect(res.itemStatus).toBe('rechazada');
    expect(res.rejectionReason).toBe('no es NM: doblez central');
    expect(res.approvedPriceCents).toBeUndefined();
    expect(res.rejectedAt).toBeTruthy();
    const DAY = 24 * 3600 * 1000;
    const t0 = new Date(res.rejectedAt!).getTime();
    expect(new Date(res.returnDeadlineAt!).getTime()).toBe(t0 + 7 * DAY);
    expect(new Date(res.abandonDeadlineAt!).getTime()).toBe(t0 + 30 * DAY);

    // La pestaña «Rechazadas» (transversal) lo lista con seller + reason + plazos.
    const page = await getAdminRejectedBuylistItems();
    const row = page.data.find((r) => r.id === 'sri-9')!;
    expect(row).toBeTruthy();
    expect(row.sellRequestId).toBe('sr-3002');
    expect(row.seller?.email).toContain('@');
    expect(row.reason).toBe('no es NM: doblez central');
    expect(row.returnDeadlineAt).toBe(res.returnDeadlineAt);
    expect(row.abandonDeadlineAt).toBe(res.abandonDeadlineAt);
  });
});

// ---- WS-F · rama REAL (fetch stubeado, config.useMocks=false) ----
describe('api (rama REAL) · WS-F endpoints, headers y errores', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const originalUseMocks = config.useMocks;

  function makeRes(status: number, body: unknown) {
    return { status, ok: status >= 200 && status < 300, json: async () => body } as unknown as Response;
  }

  beforeEach(() => {
    config.useMocks = false;
    setToken('access-token'); // evita interceptor de refresh; añade Authorization
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    config.useMocks = originalUseMocks;
    setToken(null);
    vi.unstubAllGlobals();
  });

  it('createCheckoutSession → POST /checkout/session con Idempotency-Key', async () => {
    fetchMock.mockResolvedValueOnce(
      makeRes(201, {
        orderId: 'ord-1',
        breakdown: { subtotalCents: 1000, ivaCents: 160, ivaRatePct: 16, processingFeeCents: 90, totalCents: 1250, currency: 'MXN' },
        stripe: { paymentIntentId: 'pi_1', clientSecret: 'pi_1_secret' },
      }),
    );
    const res = await createCheckoutSession(['inv-1'], 'bp-1');
    expect(res.stripe.clientSecret).toBe('pi_1_secret');

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/checkout/session');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ inventoryItemIds: ['inv-1'], billingProfileId: 'bp-1' });
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBeTruthy();
  });

  it('createCheckoutSession propaga 403 EMAIL_NOT_VERIFIED (banner de verificación en la vista)', async () => {
    fetchMock.mockResolvedValueOnce(
      makeRes(403, { error: { code: 'EMAIL_NOT_VERIFIED', message: 'verify email' } }),
    );
    await expect(createCheckoutSession(['inv-1'])).rejects.toMatchObject({
      code: 'EMAIL_NOT_VERIFIED',
      status: 403,
    });
  });

  it('createShipment → POST /shipments con Idempotency-Key y propaga 403 EMAIL_NOT_VERIFIED', async () => {
    fetchMock.mockResolvedValueOnce(
      makeRes(201, {
        shipmentId: 'shp-1',
        status: 'solicitado',
        breakdown: { subtotalCents: 17500, ivaCents: 2800, ivaRatePct: 16, processingFeeCents: 900, totalCents: 21200, currency: 'MXN' },
        stripe: { paymentIntentId: 'pi_s', clientSecret: 'pi_s_secret' },
      }),
    );
    const res = await createShipment(['inv-1002'], 'addr-1');
    expect(res.stripe.clientSecret).toBe('pi_s_secret');
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/shipments');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ inventoryItemIds: ['inv-1002'], addressId: 'addr-1' });
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBeTruthy();

    fetchMock.mockResolvedValueOnce(
      makeRes(403, { error: { code: 'EMAIL_NOT_VERIFIED', message: 'verify email' } }),
    );
    await expect(createShipment(['inv-1002'], 'addr-1')).rejects.toMatchObject({
      code: 'EMAIL_NOT_VERIFIED',
      status: 403,
    });
  });

  it('direcciones REAL: list (unwrap data), create (POST), update (PATCH), delete (DELETE 204)', async () => {
    fetchMock.mockResolvedValueOnce(makeRes(200, { data: [{ id: 'a1', line1: 'x', city: 'c', state: 's', postalCode: '00000', country: 'MX', phone: '5550000000' }] }));
    const list = await listAddresses();
    expect(list).toHaveLength(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/users/me/addresses');

    fetchMock.mockResolvedValueOnce(makeRes(201, { id: 'a2', line1: 'y', city: 'c', state: 's', postalCode: '11111', country: 'MX', phone: '5551111111' }));
    await createAddress({ line1: 'y', city: 'c', state: 's', postalCode: '11111', country: 'MX', phone: '5551111111' });
    expect(fetchMock.mock.calls[1][1].method).toBe('POST');

    fetchMock.mockResolvedValueOnce(makeRes(200, { id: 'a2', line1: 'y', city: 'c', state: 's', postalCode: '11111', country: 'MX', phone: '5551111111', isDefault: true }));
    const upd = await updateAddress('a2', { isDefault: true });
    expect(upd.isDefault).toBe(true);
    expect(fetchMock.mock.calls[2][1].method).toBe('PATCH');
    expect(String(fetchMock.mock.calls[2][0])).toContain('/users/me/addresses/a2');

    fetchMock.mockResolvedValueOnce(makeRes(204, {}));
    await deleteAddress('a2');
    expect(fetchMock.mock.calls[3][1].method).toBe('DELETE');
  });

  it('F4 · updateAdminShipmentStatus → PATCH /admin/shipments/:id/status body { to }', async () => {
    fetchMock.mockResolvedValueOnce(makeRes(200, { id: 'shp-1', status: 'enviado' }));
    const res = await updateAdminShipmentStatus('shp-1', 'enviado');
    expect(res.status).toBe('enviado');
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/admin/shipments/shp-1/status');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ to: 'enviado' });
  });

  it('F5 · respondSellRequest → POST /buylist/requests/:id/respond body { decision }', async () => {
    fetchMock.mockResolvedValueOnce(makeRes(200, { id: 'sr-1', status: 'aprobada' }));
    const res = await respondSellRequest('sr-1', 'accept');
    expect(res.status).toBe('aprobada');
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/buylist/requests/sr-1/respond');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ decision: 'accept' });
  });

  it('v1.18 · getAdminRejectedBuylistItems → GET /admin/buylist/rejected-items con paginación y userId', async () => {
    fetchMock.mockResolvedValueOnce(makeRes(200, { data: [], page: 2, pageSize: 50, total: 0 }));
    await getAdminRejectedBuylistItems({ page: 2, pageSize: 50, userId: 'u-1' });
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/admin/buylist/rejected-items');
    expect(String(url)).toContain('page=2');
    expect(String(url)).toContain('pageSize=50');
    expect(String(url)).toContain('userId=u-1');
  });

  it('v1.18 · decideBuylistItem reject → PATCH con body { decision, reason } (contrato §M5)', async () => {
    fetchMock.mockResolvedValueOnce(makeRes(200, { id: 'sri-1', itemStatus: 'rechazada' }));
    await decideBuylistItem('sri-1', { decision: 'reject', reason: 'no es NM: esquina doblada' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/admin/buylist/items/sri-1/decision');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({
      decision: 'reject',
      reason: 'no es NM: esquina doblada',
    });
  });

  it('F6 · createDispute → POST /disputes { inventoryItemId, description }; propaga 422 DISPUTE_WINDOW_CLOSED', async () => {
    fetchMock.mockResolvedValueOnce(
      makeRes(201, {
        disputeId: 'dsp-1',
        status: 'abierta',
        type: 'condition_raw',
        deadlineAt: '2026-08-24T00:00:00Z',
        // Dato de infraestructura: el cliente lo PROPAGA tal cual (por eso el aserto de abajo
        // es sobre la forma, no sobre el buzón). API_CONTRACT §0, cláusula 4.
        evidenceContact: 'evidencias@ejemplo.test',
      }),
    );
    const res = await createDispute({ inventoryItemId: 'inv-1', description: 'edge wear' });
    expect(res.evidenceContact).toContain('@');
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/disputes');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ inventoryItemId: 'inv-1', description: 'edge wear' });

    fetchMock.mockResolvedValueOnce(
      makeRes(422, { error: { code: 'DISPUTE_WINDOW_CLOSED', message: 'window closed' } }),
    );
    await expect(createDispute({ inventoryItemId: 'inv-1', description: 'late' })).rejects.toMatchObject({
      code: 'DISPUTE_WINDOW_CLOSED',
      status: 422,
    });
  });

  it('F6 · getDisputes → GET /disputes (unwrap data)', async () => {
    fetchMock.mockResolvedValueOnce(
      makeRes(200, {
        data: [
          { id: 'dsp-1', inventoryItemId: 'inv-1', type: 'condition_raw', status: 'abierta', description: 'x', deadlineAt: '2026-08-24T00:00:00Z', createdAt: '2026-08-17T00:00:00Z' },
        ],
      }),
    );
    const list = await getDisputes();
    expect(list).toHaveLength(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/disputes');
    expect(fetchMock.mock.calls[0][1].method ?? 'GET').toBe('GET');
  });
});
