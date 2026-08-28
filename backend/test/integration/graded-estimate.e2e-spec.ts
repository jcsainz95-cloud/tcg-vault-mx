/**
 * graded-estimate.e2e-spec.ts — «Gancho de grading» de punta a punta contra la app REAL + Postgres
 * REAL (v1.44, PROJECT §N, ARCHITECTURE §4.38, API_CONTRACT §2/§M2). Propiedad: backend; la EJECUTA QA.
 *
 * Reproduce el flujo de FASE 1 tal cual lo hará el humano (§N.6, manual-first):
 *   1. el admin fija los estimados con `POST /admin/pricing/override` (endpoint YA existente),
 *   2. enciende el interruptor maestro en M10 (`gradedEstimatesEnabled`, seed `off`),
 *   3. la ficha informa, la teja y la vitrina promueven — y solo si el gate de ROI se cumple,
 *   4. sube `minUpsidePct` en M2 y la vitrina se vacía AL VUELO **sin tocar ningún precio de venta**.
 *
 * Deja el entorno como lo encontró (dial en `off`, `minUpsidePct` restaurado, filas PSA borradas):
 * la suite comparte la BD con las demás y el dial es global.
 */
import { E2EHarness } from './helpers/e2e-app';
import { E2E_CARDS, E2E_LIST_OVERRIDE_CENTS, E2E_USERS } from '../../prisma/e2e-fixtures';

describe('E2E — Gancho de grading (valor estimado si se gradea)', () => {
  let h: E2EHarness;
  let adminToken: string;
  let cardId: string;

  // Carta raw publicada a MX$600 (override por pieza del fixture `E2E-LST-0002`).
  // PSA 10 = MX$9,000 ⇒ escalón [MX$5,000, MX$10,000) ⇒ costo MX$1,800.
  // umbral = ceil((60000 + 180000) × 1.30) = 312000 ; PSA 9 = MX$5,000 = 500000 >= 312000 ⇒ DESTACADA.
  const PSA10_CENTS = 900_000;
  const PSA9_CENTS = 500_000;
  const EXPECTED_THRESHOLD = 312_000;
  const EXPECTED_NET_UPSIDE = PSA9_CENTS - (E2E_LIST_OVERRIDE_CENTS + 180_000);

  const setDial = (value: 'on' | 'off') =>
    h.api('PUT', '/admin/settings', { token: adminToken, json: { gradedEstimatesEnabled: value } });

  beforeAll(async () => {
    h = await E2EHarness.create();
    adminToken = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    const card = await h.prisma.card.findFirst({ where: { externalId: E2E_CARDS.common.externalId } });
    if (!card) throw new Error('fixture e2e-common no encontrado: corre `npm run seed:synthetic`');
    cardId = card.id;
  });

  afterAll(async () => {
    // Restaurar el estado GLOBAL que esta suite tocó (la BD es compartida).
    if (adminToken) {
      await setDial('off');
      await h.api('PUT', '/admin/pricing/graded-estimates', {
        token: adminToken,
        json: { minUpsidePct: 30, freshnessDays: 30, grades: ['10', '9'], highlightGrades: ['10'] },
      });
    }
    if (cardId) {
      await h.prisma.priceReference.deleteMany({
        where: { cardId, productType: 'graded', gradeKey: { in: ['graded:PSA:10', 'graded:PSA:9'] } },
      });
    }
    await h?.close();
  });

  it('1) el admin fija los estimados con el override manual YA existente (fase 1, sin mecanismo nuevo)', async () => {
    for (const [gradeKey, priceMxnCents] of [
      ['graded:PSA:10', PSA10_CENTS],
      ['graded:PSA:9', PSA9_CENTS],
    ] as const) {
      const res = await h.api('POST', '/admin/pricing/override', {
        token: adminToken,
        // `finish` OMITIDO ⇒ `normal`: el grado NO se cruza con el acabado (§4.38a).
        // v1.50.2 (BREAKING, INV-D §4.38l.1): con `productType:'graded'` el `intent` es OBLIGATORIO.
        // Aquí es `graded_estimate` porque esto ES la captura del gancho; sin él la ruta responde 422.
        json: { cardId, productType: 'graded', gradeKey, priceMxnCents, intent: 'graded_estimate' },
      });
      expect(res.status).toBe(201);
    }
    // La clave canónica quedó escrita tal cual la lee el storefront.
    const rows = await h.prisma.priceReference.findMany({
      where: { cardId, productType: 'graded', gradeKey: { in: ['graded:PSA:10', 'graded:PSA:9'] } },
    });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.finish === 'normal' && r.cardProductId === null)).toBe(true);
    // Doctrina (b): escribir un estimado NO encola un «precio pendiente».
    const pendings = await h.prisma.pendingPriceEntry.findMany({
      where: { cardId, productType: 'graded' },
    });
    expect(pendings).toHaveLength(0);
  });

  it('2) con el dial en `off` (seed fail-closed) NADA se emite y la vitrina responde vacía', async () => {
    await setDial('off');
    const ficha = await h.api('GET', `/catalog/cards/${cardId}`);
    expect(ficha.status).toBe(200);
    expect(ficha.body.gradedEstimates).toBeUndefined();
    expect(ficha.body.listings.every((l: any) => l.gradingHighlight === undefined)).toBe(true);

    const vitrina = await h.api('GET', '/catalog/cards?gradingHighlight=true&sort=grading_showcase&pageSize=8');
    expect(vitrina.status).toBe(200); // NO es un error: es la feature apagada
    expect(vitrina.body).toMatchObject({ data: [], total: 0 });
  });

  it('3) con el dial en `on`: la FICHA informa (PSA 10 + PSA 9) y la TEJA promueve (badge PSA 10)', async () => {
    expect((await setDial('on')).status).toBe(200);

    const ficha = await h.api('GET', `/catalog/cards/${cardId}`);
    expect(ficha.body.gradedEstimates).toHaveLength(2);
    expect(ficha.body.gradedEstimates.map((e: any) => e.gradeValue)).toEqual(['10', '9']);
    expect(ficha.body.gradedEstimates[0].estimate).toMatchObject({
      status: 'priced',
      referenceMxnCents: PSA10_CENTS,
    });
    expect(ficha.body.gradedEstimates[0].estimate.capturedDate).toEqual(expect.any(String));
    // INDISTINGUIBILIDAD (§4.38g): `source`/`isManualOverride` NUNCA viajan EN EL GANCHO — es lo único
    // que delataría fase 1 (manual) vs fase 2 (ingest).
    expect(ficha.body.gradedEstimates[0].estimate.source).toBeUndefined();
    // La aserción se ACOTA a los dos campos del gancho a propósito: el resto de la ficha lleva el
    // `PriceInfo` del precio RAW (`listings[].referenceValue`, `units[].referenceValue`), que expone
    // `source`/`isManualOverride` desde antes de v1.44. Escanear el body entero mezclaba ese campo
    // PRE-EXISTENTE y legítimo con la fuga que esta prueba busca.
    // v1.50.2: el destacado se lee de la REJILLA (`GroupedListingSummaryDTO`), no de los `listings[]`
    // de la ficha — se MOVIÓ, no se duplicó (§4.38e).
    const rejilla = await h.api('GET', `/catalog/cards?q=${encodeURIComponent(E2E_CARDS.common.name)}&pageSize=20`);
    const teja = rejilla.body.data.find((g: any) => g.card.id === cardId && g.productType === 'raw');
    const hookJson = JSON.stringify({
      gradedEstimates: ficha.body.gradedEstimates,
      gradingHighlight: teja.gradingHighlight,
    });
    expect(hookJson).not.toContain('isManualOverride');
    expect(hookJson).not.toContain('"source"');

    // La FICHA ya NO trae destacado en sus grupos (informa con `gradedEstimates`, que es más rico).
    expect(ficha.body.listings.every((l: any) => l.gradingHighlight === undefined)).toBe(true);
    expect(teja.gradingHighlight).toHaveLength(1);
    expect(teja.gradingHighlight[0].gradeValue).toBe('10'); // el badge pinta UNA cifra
    // SEC-A1: ni el umbral, ni el costo, ni la ganancia neta salen del servidor. Estos SÍ son tokens
    // exclusivos del gancho, así que se escanean sobre el body COMPLETO (no pueden estar en ningún lado).
    for (const forbidden of ['netUpside', 'gradingCost', 'threshold', 'minUpsidePct', 'eligible']) {
      expect(JSON.stringify(ficha.body)).not.toContain(forbidden);
    }
  });

  /**
   * v1.50.2 — INV-D (§4.38l.1) contra el STACK VIVO. Es la guarda que impide que un «estimado» cambie
   * el precio de venta REAL de un slab publicado: la fila es la misma, así que la única defensa es
   * **exigir que se declare la intención** y bloquear la combinación imposible.
   */
  it('3b) INV-D — `intent` OBLIGATORIO en graded: 422 sin él, 409 sobre una carta con slab publicado', async () => {
    // (a) SIN `intent` ⇒ 422. Es BREAKING a propósito: un default a `market` sería fail-open.
    const sinIntent = await h.api('POST', '/admin/pricing/override', {
      token: adminToken,
      json: { cardId, productType: 'graded', gradeKey: 'graded:PSA:10', priceMxnCents: PSA10_CENTS },
    });
    expect(sinIntent.status).toBe(422);
    expect(sinIntent.body.error.code).toBe('GRADED_INTENT_REQUIRED');

    // (b) `graded_estimate` sobre la carta que SÍ tiene un slab PSA 10 publicado (`E2E-LST-0003`) ⇒ 409.
    const conSlab = await h.prisma.card.findFirst({ where: { externalId: E2E_CARDS.graded.externalId } });
    const choque = await h.api('POST', '/admin/pricing/override', {
      token: adminToken,
      json: {
        cardId: conSlab!.id,
        productType: 'graded',
        gradeKey: 'graded:PSA:10',
        priceMxnCents: 123_456,
        intent: 'graded_estimate',
      },
    });
    expect(choque.status).toBe(409);
    expect(choque.body.error.code).toBe('GRADED_ESTIMATE_SLAB_PUBLISHED');
    expect(choque.body.error.details.publishedSlabCount).toBeGreaterThanOrEqual(1);

    // …y el precio de mercado del slab NO se movió (la guarda corta ANTES de escribir).
    const ref = await h.prisma.priceReference.findFirst({
      where: { cardId: conSlab!.id, productType: 'graded', gradeKey: 'graded:PSA:10' },
      orderBy: { capturedDate: 'desc' },
    });
    expect(ref?.priceMxnCents).not.toBe(123_456);

    // (c) `intent:"market"` sobre esa MISMA carta sí es legítimo: es fijar el precio real del slab.
    //     (No se ejecuta la escritura para no ensuciar la BD compartida; lo cubre el spec unitario.)
  });

  it('4) la VITRINA la lista (subconjunto ordenado de Compra, mismo DTO de teja)', async () => {
    const vitrina = await h.api('GET', '/catalog/cards?gradingHighlight=true&sort=grading_showcase&pageSize=8');
    expect(vitrina.status).toBe(200);
    const mine = vitrina.body.data.find((g: any) => g.card.id === cardId);
    expect(mine).toBeDefined();
    expect(mine.gradingHighlight[0].estimate.referenceMxnCents).toBe(PSA10_CENTS);
    expect(mine.salePriceCents).toBe(E2E_LIST_OVERRIDE_CENTS); // el precio de venta NO cambió
    // Todo lo que entra a la vitrina está destacado (nada «no destacado» se cuela al paginar).
    expect(vitrina.body.data.every((g: any) => g.gradingHighlight != null)).toBe(true);
  });

  it('5) `sort=grading_showcase` SIN el filtro ⇒ 400 GRADING_SORT_REQUIRES_FILTER (fail-closed)', async () => {
    const res = await h.api('GET', '/catalog/cards?sort=grading_showcase');
    expect(res.status).toBe(400);
    expect(res.body?.error?.code ?? res.body?.code).toBe('GRADING_SORT_REQUIRES_FILTER');
    const bad = await h.api('GET', '/catalog/cards?gradingHighlight=false');
    expect(bad.status).toBe(400);
  });

  it('6) el diagnóstico de admin explica el gate (y es el ÚNICO lugar donde salen sus insumos)', async () => {
    const res = await h.api('GET', `/admin/pricing/graded-estimates/preview?cardId=${cardId}`, {
      token: adminToken,
    });
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(true);
    const g = res.body.groups.find((x: any) => x.finish === 'normal');
    expect(g).toMatchObject({
      salePriceCents: E2E_LIST_OVERRIDE_CENTS,
      psa10MxnCents: PSA10_CENTS,
      psa9MxnCents: PSA9_CENTS,
      stale: false,
      gradingCostMxnCents: 180_000,
      thresholdMxnCents: EXPECTED_THRESHOLD,
      netUpsidePsa9MxnCents: EXPECTED_NET_UPSIDE,
      eligible: true,
    });
  });

  it('7) el `PUT` de diales valida los invariantes de la tabla de escalones (jamás costo 0)', async () => {
    const empty = await h.api('PUT', '/admin/pricing/graded-estimates', {
      token: adminToken,
      json: { gradingCostTiers: [] },
    });
    expect(empty.status).toBe(422);
    expect(empty.body?.error?.code ?? empty.body?.code).toBe('GRADING_TIERS_EMPTY');

    const gap = await h.api('PUT', '/admin/pricing/graded-estimates', {
      token: adminToken,
      json: {
        gradingCostTiers: [
          { minValueMxnCents: 0, maxValueMxnCents: 200_000, costMxnCents: 70_000 },
          { minValueMxnCents: 300_000, maxValueMxnCents: null, costMxnCents: 110_000 },
        ],
      },
    });
    expect(gap.status).toBe(422);
    expect(gap.body?.error?.code ?? gap.body?.code).toBe('GRADING_TIERS_NOT_CONTIGUOUS');

    const zeroCost = await h.api('PUT', '/admin/pricing/graded-estimates', {
      token: adminToken,
      json: { gradingCostTiers: [{ minValueMxnCents: 0, maxValueMxnCents: null, costMxnCents: 0 }] },
    });
    expect(zeroCost.status).toBe(422);
  });

  it('8) criterio 86/90 — subir `minUpsidePct` vacía la vitrina AL VUELO, sin mover ningún precio', async () => {
    const antes = await h.api('GET', `/catalog/cards/${cardId}`);
    const precioAntes = antes.body.listings.find((l: any) => l.productType === 'raw').salePriceCents;

    const put = await h.api('PUT', '/admin/pricing/graded-estimates', {
      token: adminToken,
      json: { minUpsidePct: 500 },
    });
    expect(put.status).toBe(200);
    expect(put.body.minUpsidePct).toBe(500);

    const vitrina = await h.api('GET', '/catalog/cards?gradingHighlight=true&sort=grading_showcase&pageSize=8');
    expect(vitrina.body.data.find((g: any) => g.card.id === cardId)).toBeUndefined();

    const despues = await h.api('GET', `/catalog/cards/${cardId}`);
    const raw = despues.body.listings.find((l: any) => l.productType === 'raw');
    expect(raw.gradingHighlight).toBeUndefined(); // el badge desaparece…
    expect(raw.salePriceCents).toBe(precioAntes); // …y el precio de venta NO se movió
    // PARTICIÓN §4.38-0: la FICHA sigue mostrando sus dos cifras (el dial de curaduría no la apaga).
    expect(despues.body.gradedEstimates).toHaveLength(2);
  });

  it('8b) GU-A8 — un `minUpsidePct` CORRUPTO por edición fuera de banda apaga la vitrina, no la ficha', async () => {
    // Se restaura el umbral sano para que la carta VUELVA a estar destacada (si no, el test 8 ya la
    // había sacado y esta prueba no discriminaría nada).
    await h.api('PUT', '/admin/pricing/graded-estimates', {
      token: adminToken,
      json: { minUpsidePct: 30 },
    });
    const vitrinaSana = await h.api('GET', '/catalog/cards?gradingHighlight=true&sort=grading_showcase&pageSize=8');
    expect(vitrinaSana.body.data.find((g: any) => g.card.id === cardId)).toBeDefined();

    // Edición FUERA DE BANDA (el `PUT` lo rechazaría con 422): SQL directo / restore parcial. Es el
    // único camino que llega a este estado, y es exactamente cuando conviene ser paranoico (§4.38d).
    await h.prisma.configSetting.upsert({
      where: { key: 'grading_min_upside_pct' },
      create: { key: 'grading_min_upside_pct', valueJson: 'mucho' },
      update: { valueJson: 'mucho' },
    });

    // NO se cae al seed 30 (que habría vuelto a destacar la carta): nada se promociona.
    const vitrina = await h.api('GET', '/catalog/cards?gradingHighlight=true&sort=grading_showcase&pageSize=8');
    expect(vitrina.status).toBe(200);
    expect(vitrina.body.data.find((g: any) => g.card.id === cardId)).toBeUndefined();

    const ficha = await h.api('GET', `/catalog/cards/${cardId}`);
    const raw = ficha.body.listings.find((l: any) => l.productType === 'raw');
    expect(raw.gradingHighlight).toBeUndefined(); // el badge desaparece…
    expect(ficha.body.gradedEstimates).toHaveLength(2); // …pero la FICHA sigue informando (alcance)
    expect(raw.salePriceCents).toBe(E2E_LIST_OVERRIDE_CENTS); // y ningún precio se movió

    // El diagnóstico de admin lo explica con la razón accionable.
    const preview = await h.api('GET', `/admin/pricing/graded-estimates/preview?cardId=${cardId}`, {
      token: adminToken,
    });
    const g = preview.body.groups.find((x: any) => x.finish === 'normal');
    expect(g).toMatchObject({ eligible: false, reason: 'FEATURE_OFF' });

    // Un `PUT` válido vuelve a dejar la config sana (el camino de salida del operador).
    const fix = await h.api('PUT', '/admin/pricing/graded-estimates', {
      token: adminToken,
      json: { minUpsidePct: 30 },
    });
    expect(fix.status).toBe(200);
    expect(fix.body.minUpsidePct).toBe(30);
    const vuelve = await h.api('GET', '/catalog/cards?gradingHighlight=true&sort=grading_showcase&pageSize=8');
    expect(vuelve.body.data.find((g2: any) => g2.card.id === cardId)).toBeDefined();
  });

  it('9) apagar el dial deja el catálogo EXACTAMENTE como antes de la feature', async () => {
    await setDial('off');
    const ficha = await h.api('GET', `/catalog/cards/${cardId}`);
    expect(ficha.body.gradedEstimates).toBeUndefined();
    expect(ficha.body.listings.every((l: any) => l.gradingHighlight === undefined)).toBe(true);
    expect(ficha.body.listings.find((l: any) => l.productType === 'raw').salePriceCents).toBe(
      E2E_LIST_OVERRIDE_CENTS,
    );
  });
});
