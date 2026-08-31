/**
 * graded-estimate.e2e-spec.ts — «Gancho de grading» de punta a punta contra la app REAL + Postgres
 * REAL (v1.44, PROJECT §O, ARCHITECTURE §4.38, API_CONTRACT §2/§M2). Propiedad: backend; la EJECUTA QA.
 *
 * Reproduce el flujo de captura MANUAL tal cual lo hace el humano (§O.6: el override manual es el
 * respaldo de máxima precedencia sobre el ingest automático):
 *   1. el admin fija los estimados con `POST /admin/pricing/override` (endpoint YA existente),
 *   2. enciende el DIAL ÚNICO en M10 (`gradingHookEnabled`, seed `off`; v1.51 M-46, §4.38r),
 *   3. la ficha informa, la teja y la vitrina promueven — y solo si el gate de ROI se cumple,
 *   4. sube `minUpsidePct` en M2 y la vitrina se vacía AL VUELO **sin tocar ningún precio de venta**.
 *
 * Deja el entorno como lo encontró (dial en `off`, `minUpsidePct` restaurado, filas PSA borradas):
 * la suite comparte la BD con las demás y el dial es global.
 */
import { E2EHarness } from './helpers/e2e-app';
import { DEFAULT_GRADING_COST_TIERS } from '../../src/common/graded-estimate';
import {
  E2E_CARDS,
  E2E_LIST_OVERRIDE_CENTS,
  E2E_STALE_ESTIMATES,
  E2E_USERS,
} from '../../prisma/e2e-fixtures';

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
    h.api('PUT', '/admin/settings', { token: adminToken, json: { gradingHookEnabled: value } });

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
        json: {
          minUpsidePct: 30,
          freshnessDays: 30,
          grades: ['10', '9'],
          highlightGrades: ['10'],
          // v1.50.3: el seed del criterio 109. Se restaura explícitamente porque 8d lo fija.
          manualFreshnessDays: 30,
          // v1.50.3-f — **la tabla de escalones también se restaura, y no es paranoia.** `seed-e2e`
          // hace `upsert` con `update: {}` (deuda declarada, §11.0), así que una `ConfigSetting`
          // editada **sobrevive a `npm run seed:synthetic`**: si una corrida deja aquí unos tiers de
          // prueba, la siguiente falla en el caso 6 con unos números que nadie sabe de dónde salen y
          // el resembrado NO la arregla. Restaurar el valor del seed en el `afterAll` es lo único que
          // cierra ese modo de fallo desde esta suite.
          gradingCostTiers: DEFAULT_GRADING_COST_TIERS,
        },
      });
    }
    if (cardId) {
      await h.prisma.priceReference.deleteMany({
        where: { cardId, productType: 'graded', gradeKey: { in: ['graded:PSA:10', 'graded:PSA:9'] } },
      });
    }
    // v1.50.3-d: el caso `8e` captura un estimado PSA 9 sobre la carta con SLAB publicado (para ver
    // `?reason=SLAB_PUBLISHED` en real) y lo retira él mismo. Esto lo repite por si el caso falló a
    // media ejecución: la fila PSA 10 de esa carta es del SEED (el precio de mercado del slab) y NO se
    // toca — borrarla dejaría al slab sin referencia.
    const slab = await h.prisma.card.findFirst({ where: { externalId: E2E_CARDS.slabbed.externalId } });
    if (slab) {
      await h.prisma.priceReference.deleteMany({
        where: { cardId: slab.id, productType: 'graded', gradeKey: 'graded:PSA:9' },
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
      // v1.50.3-c (QA MENOR-1): `200`, no `201`. API_CONTRACT norma `200` para este endpoint y el
      // código respondía el `201` por default de `@Post` de Nest. Manda el contrato sobre el código.
      expect(res.status).toBe(200);
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
    // §O.8 / criterio 112(b): «todo intento bloqueado queda REGISTRADO». Se mide contra el stack vivo,
    // porque es lo que QA midió cuando la guarda resultó ser MUDA: 421 filas antes, 421 después.
    const auditBefore = await h.prisma.auditLog.count({ where: { action: 'pricing.override.blocked' } });

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

    // (d) criterio 112(b) — LOS DOS intentos bloqueados dejaron rastro, con lo necesario para actuar.
    //     Sin esto la guarda es muda: el 422/409 lo ve solo quien hizo la petición y se pierde al
    //     cerrar la pestaña, así que nadie puede ver si el operador choca contra ella a diario.
    const auditAfter = await h.prisma.auditLog.findMany({
      where: { action: 'pricing.override.blocked' },
      orderBy: { createdAt: 'asc' },
    });
    expect(auditAfter.length).toBe(auditBefore + 2);
    const codes = auditAfter.slice(-2).map((r) => (r.after as { code?: string } | null)?.code);
    expect(codes).toEqual(['GRADED_INTENT_REQUIRED', 'GRADED_ESTIMATE_SLAB_PUBLISHED']);
    const ultimo = auditAfter[auditAfter.length - 1].after as Record<string, unknown>;
    expect(ultimo).toMatchObject({
      cardId: conSlab!.id,
      gradeKey: 'graded:PSA:10',
      intent: 'graded_estimate',
      reason: 'slab_published',
      // El monto que NO se escribió: es lo que permite ver si el operador insiste con la misma cifra.
      attemptedPriceMxnCents: 123_456,
    });
    expect(auditAfter[auditAfter.length - 1].actorUserId).not.toBeNull();

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

  it('8) criterio 104/108 — subir `minUpsidePct` vacía la vitrina AL VUELO, sin mover ningún precio', async () => {
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

  /**
   * v1.50.3 — **criterio 111(e) contra el stack vivo.** Hasta este pase no era verificable porque la
   * lista **no existía**: §4.38(k.3) decidió no ocultar la cifra incoherente en la ficha, y esa decisión
   * solo se sostiene si alguien puede enterarse de que existe. Aquí se comprueban las tres mitades a la
   * vez sobre la MISMA carta: **no** en la rejilla, **sí** en la ficha, **sí** en la lista de revisión.
   */
  it('8c) criterio 111(e) — la cifra incoherente NO se promociona, SÍ se informa y SÍ sale en la lista', async () => {
    await setDial('on');
    // Se fuerza la INCOHERENCIA por la cota inferior (el error de unidades USD/MXN): un PSA 10 por
    // DEBAJO del precio raw. Es el caso que §O.7 nombra y el que el criterio 111(b) exige.
    const bajo = await h.api('POST', '/admin/pricing/override', {
      token: adminToken,
      json: {
        cardId,
        productType: 'graded',
        gradeKey: 'graded:PSA:10',
        priceMxnCents: Math.floor(E2E_LIST_OVERRIDE_CENTS / 2),
        intent: 'graded_estimate',
      },
    });
    expect(bajo.status).toBe(200); // v1.50.3-c: el contrato norma 200 (antes respondía el 201 de Nest)

    // (1) NO se promociona.
    const vitrina = await h.api('GET', '/catalog/cards?gradingHighlight=true&sort=grading_showcase&pageSize=8');
    expect(vitrina.body.data.find((g: any) => g.card.id === cardId)).toBeUndefined();
    // (2) …pero la FICHA sigue informando (§4.38k.3: informar ≠ promover).
    const ficha = await h.api('GET', `/catalog/cards/${cardId}`);
    expect(ficha.body.gradedEstimates.length).toBeGreaterThan(0);
    // (3) …y por eso TIENE que aparecer en la lista de revisión: es la contrapartida de (2).
    const review = await h.api('GET', '/admin/pricing/graded-estimates/review?pageSize=100', {
      token: adminToken,
    });
    expect(review.status).toBe(200);
    const fila = review.body.data.find((x: any) => x.cardId === cardId);
    expect(fila).toBeDefined();
    expect(fila.reason).toBe('NOT_ABOVE_RAW');
    // La lista se lee sin un fetch por fila: trae la identidad de la carta.
    expect(fila).toMatchObject({ cardName: expect.any(String), setName: expect.any(String), number: expect.any(String) });
    expect(review.body).toMatchObject({ page: 1, pageSize: 100, enabled: true, truncated: false });
    expect(review.body.scannedCards).toBeGreaterThan(0);

    // Un `reason` que NO es una incoherencia ⇒ 400 (no una lista vacía que parezca «nada que revisar»).
    // ⚠️ v1.50.3-c: el ejemplo ya NO puede ser `STALE` —pasó a opt-in admitido (§4.38n.2-bis)—, así que
    // se usa uno de los que siguen siendo AUSENCIA de dato. El caso `STALE` se prueba en `8d)`.
    const malo = await h.api('GET', '/admin/pricing/graded-estimates/review?reason=NO_PSA10', {
      token: adminToken,
    });
    expect(malo.status).toBe(400);

    // Se restaura el PSA 10 sano para no ensuciar los tests siguientes (la BD es compartida).
    await h.api('POST', '/admin/pricing/override', {
      token: adminToken,
      json: { cardId, productType: 'graded', gradeKey: 'graded:PSA:10', priceMxnCents: PSA10_CENTS, intent: 'graded_estimate' },
    });
  });

  /**
   * v1.50.3 (GU-A16, §4.38m) — **el override manual DECAE**, criterio 109. Es el caso que QA reprodujo
   * a mano: una fila manual de **40 días** seguía en la ficha y seguía promocionándose. §O.4: «mejor
   * callar que presumir un número viejo en una promesa comercial».
   */
  it('8d) criterio 109 — un override manual de 40 días desaparece de LAS TRES superficies', async () => {
    await setDial('on');
    // ⚠️ El dial se fija EXPLÍCITAMENTE, no se confía en el seed. `prisma/seed.ts` usa
    // `update: {}` (respeta ediciones del admin), así que el seed corregido de v1.50.3
    // (`manualFreshnessDays` `null` → 30) **NO llega a una BD ya sembrada**: ahí la fila conserva el
    // valor viejo. Es una corrección de DATOS pendiente para devops, no un fallo de código — y por eso
    // el candado del SEED vive en `test/graded-estimate.batch.spec.ts` (lee la constante) y este E2E
    // prueba el COMPORTAMIENTO con el dial en su valor de criterio.
    const dial = await h.api('PUT', '/admin/pricing/graded-estimates', {
      token: adminToken,
      json: { manualFreshnessDays: 30 },
    });
    expect(dial.status).toBe(200);
    expect(dial.body.manualFreshnessDays).toBe(30);
    // Se envejece la fila por SQL (el `POST` siempre escribe con la fecha de hoy, que es justo el bucle
    // operativo que el criterio define: el manual se refresca RECAPTURÁNDOLO).
    const hace40 = new Date(Date.now() - 40 * 86_400_000);
    hace40.setUTCHours(0, 0, 0, 0);
    await h.prisma.priceReference.updateMany({
      where: { cardId, productType: 'graded', gradeKey: { in: ['graded:PSA:10', 'graded:PSA:9'] } },
      data: { capturedDate: hace40 },
    });

    const ficha = await h.api('GET', `/catalog/cards/${cardId}`);
    expect(ficha.body.gradedEstimates).toBeUndefined(); // (1) la ficha calla
    const rejilla = await h.api('GET', `/catalog/cards?q=${encodeURIComponent(E2E_CARDS.common.name)}&pageSize=20`);
    const teja = rejilla.body.data.find((g: any) => g.card.id === cardId && g.productType === 'raw');
    expect(teja.gradingHighlight).toBeUndefined(); // (2) la teja no pinta badge
    const vitrina = await h.api('GET', '/catalog/cards?gradingHighlight=true&sort=grading_showcase&pageSize=8');
    expect(vitrina.body.data.find((g: any) => g.card.id === cardId)).toBeUndefined(); // (3) ni la vitrina

    // …y el precio de venta de la carta NO se movió por nada de esto (el estimado nunca fue dinero).
    expect(ficha.body.listings.find((l: any) => l.productType === 'raw').salePriceCents).toBe(
      E2E_LIST_OVERRIDE_CENTS,
    );

    // (4) v1.50.3-c (QA) — **el DIAGNÓSTICO de admin distingue «caducó» de «nunca se capturó».**
    //
    // Ésta es la contrapartida del arreglo del orden: con el filtro de frescura DENTRO del batch, el
    // preview respondía `reason:'NO_PSA10'`, `stale:false`, `psa10MxnCents:null`, `capturedDate:null`
    // sobre esta MISMA fila de 40 días — o sea «no la has capturado» cuando la verdad era «expiró».
    // Los dos remedios son OPUESTOS (capturar de cero vs. recapturar), y el paso siguiente de este
    // mismo test —recapturar y ver que revive— es justo el que el diagnóstico tiene que saber sugerir.
    const diag = await h.api('GET', `/admin/pricing/graded-estimates/preview?cardId=${cardId}`, {
      token: adminToken,
    });
    expect(diag.status).toBe(200);
    const grupo = diag.body.groups.find((x: any) => x.finish === 'normal');
    expect(grupo.reason).toBe('STALE'); // era `NO_PSA10` (código muerto pese a estar normado en §M2)
    expect(grupo.stale).toBe(true);
    expect(grupo.psa10MxnCents).toBe(PSA10_CENTS); // la cifra que expiró se SIGUE viendo…
    expect(grupo.capturedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/); // …con la fecha que la delata
    expect(grupo.eligible).toBe(false); // exhibir la caducada en el diagnóstico NO la vuelve elegible

    // (5) v1.50.3-c (§4.38i punto 7, GU-A24) — **EL CIERRE DEL BUCLE, y es lo que faltaba.**
    //
    // Sin esto, «caduca solo» sería una **desaparición sin retorno**: la cifra se va de las tres
    // superficies en silencio, sigue en la BD, y el dueño no tiene ninguna forma de encontrarla para
    // refrescarla o retirarla. `?reason=STALE` es esa forma — era un `400` hasta este pase.
    const caducadas = await h.api('GET', '/admin/pricing/graded-estimates/review?reason=STALE&pageSize=100', {
      token: adminToken,
    });
    expect(caducadas.status).toBe(200); // antes: 400 VALIDATION_ERROR
    // Se busca ESTA carta, no `data[0]`: la lista es GLOBAL por diseño (su conjunto motor son todas las
    // cartas con fila de estimado), así que filas ajenas al fixture pueden convivir sin invalidar nada.
    const pendiente = caducadas.body.data.find((x: any) => x.cardId === cardId);
    expect(pendiente).toBeDefined();
    expect(pendiente).toMatchObject({
      reason: 'STALE',
      stale: true,
      eligible: false,
      // El ORIGEN dice qué hacer: manual ⇒ recapturar o borrar (automática ⇒ mirar el ingest).
      isManual: true,
      psa10MxnCents: PSA10_CENTS, // la cifra caducada se VE: es lo que hace falta para decidir
    });
    expect(pendiente.capturedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // …y NO aparece en el default (los tres de coherencia): `STALE` es opt-in, o ahogaría la señal.
    const porDefecto = await h.api('GET', '/admin/pricing/graded-estimates/review?pageSize=100', {
      token: adminToken,
    });
    expect(porDefecto.body.data.find((x: any) => x.cardId === cardId)).toBeUndefined();

    // Recapturar lo revive: «el dueño SOSTIENE ese número», que es la lectura honesta del criterio.
    for (const [gradeKey, priceMxnCents] of [
      ['graded:PSA:10', PSA10_CENTS],
      ['graded:PSA:9', PSA9_CENTS],
    ] as const) {
      await h.api('POST', '/admin/pricing/override', {
        token: adminToken,
        json: { cardId, productType: 'graded', gradeKey, priceMxnCents, intent: 'graded_estimate' },
      });
    }
    const revive = await h.api('GET', `/catalog/cards/${cardId}`);
    expect(revive.body.gradedEstimates).toHaveLength(2);

    // (6) …y DESAPARECE de la lista de caducadas. Es la otra mitad de (5): una lista de pendientes que
    // no se vacía al resolver el pendiente enseña a ignorarla.
    const tras = await h.api('GET', '/admin/pricing/graded-estimates/review?reason=STALE&pageSize=100', {
      token: adminToken,
    });
    expect(tras.body.data.find((x: any) => x.cardId === cardId)).toBeUndefined();
  });

  /**
   * v1.50.3-d (§4.38q, criterio 8 del gate de QA) — **EL BUCLE COMPLETO DE LA LISTA DE REVISIÓN.**
   *
   * `PROJECT.md` §O.7 dice que la carta entra a la lista de revisión para que el dueño «la corrija con
   * override **o la descarte**», y **descartar no es pisar**. Hasta este pase el back-office solo podía
   * PISAR una cifra: el remedio disponible para un número que no debería existir era **otro número**.
   * Con la caducidad de §4.38(m) el hueco se volvió agudo — la cifra errónea desaparece de las tres
   * superficies, sigue en la tabla y ahora es enumerable: se construyó el detector y se dejó al
   * operador sin la herramienta.
   *
   * Se prueban las DOS mitades, que no son intercambiables:
   *  (A) la carta INCOHERENTE se **borra**, desaparece de `review` y de la ficha, y **ningún precio de
   *      venta cambia**;
   *  (B) sobre la carta con **slab publicado**, el MISMO `DELETE` responde **`409`** y el precio del
   *      slab es **idéntico antes y después** — el criterio 112 aplicado al verbo destructivo.
   *
   * Sin la pareja, «se corrige o se descarta» seguiría sin ser verificable.
   */
  it('8e) criterio 8 — la incoherente se BORRA y desaparece; sobre el slab el mismo DELETE es 409', async () => {
    await setDial('on');
    const delEstimate = (card: string, grade: string) =>
      h.api('DELETE', `/admin/pricing/graded-estimates/${card}/${grade}`, { token: adminToken });
    const gradedRows = (card: string, gradeKey: string) =>
      h.prisma.priceReference.findMany({
        where: { cardId: card, productType: 'graded', gradeKey, finish: 'normal', cardProductId: null },
      });

    // ───────────────── (A) la carta incoherente: encontrarla, descartarla, comprobar que se fue ────
    // Se vuelve a forzar la incoherencia por la cota inferior (el error de unidades USD/MXN), que es el
    // caso que §O.7 nombra: un PSA 10 por DEBAJO del precio raw.
    const incoherente = await h.api('POST', '/admin/pricing/override', {
      token: adminToken,
      json: {
        cardId,
        productType: 'graded',
        gradeKey: 'graded:PSA:10',
        priceMxnCents: Math.floor(E2E_LIST_OVERRIDE_CENTS / 2),
        intent: 'graded_estimate',
      },
    });
    expect(incoherente.status).toBe(200);

    const antes = await h.api('GET', `/catalog/cards/${cardId}`);
    const precioAntes = antes.body.listings.find((l: any) => l.productType === 'raw').salePriceCents;
    expect(antes.body.gradedEstimates.length).toBeGreaterThan(0);
    const revisionAntes = await h.api('GET', '/admin/pricing/graded-estimates/review?pageSize=100', {
      token: adminToken,
    });
    expect(revisionAntes.body.data.find((x: any) => x.cardId === cardId)?.reason).toBe('NOT_ABOVE_RAW');

    // El estado REAL de la tabla: el test `8d` envejeció las filas a 40 días y luego RECAPTURÓ, así que
    // esta clave tiene MÁS de una fila (la `@@unique` incluye `capturedDate`). Es justo el caso que
    // obliga a borrar TODAS: borrar «solo la vigente» haría aflorar la vieja y la cifra REAPARECERÍA.
    const filas10 = await gradedRows(cardId, 'graded:PSA:10');
    expect(filas10.length).toBeGreaterThan(1);

    const borrado10 = await delEstimate(cardId, '10');
    expect(borrado10.status).toBe(200);
    expect(borrado10.body).toMatchObject({ cardId, gradeValue: '10', deletedCount: filas10.length });
    // …y no queda NINGUNA fila de esa clave: sin esto, la ficha resucitaría la cifra más vieja sola.
    expect(await gradedRows(cardId, 'graded:PSA:10')).toHaveLength(0);

    // El PSA 9 se descarta igual (son grados INDEPENDIENTES): «descartar el estimado de esta carta».
    expect((await delEstimate(cardId, '9')).status).toBe(200);

    // (1) desaparece de la FICHA…
    const despues = await h.api('GET', `/catalog/cards/${cardId}`);
    expect(despues.body.gradedEstimates).toBeUndefined();
    // (2) …y de la LISTA DE REVISIÓN, también con los opt-in (`STALE` incluido: la fila no existe, no
    //     es que haya caducado). Una lista de trabajo que no se vacía al resolver enseña a ignorarla.
    for (const q of ['?pageSize=100', '?reason=STALE&pageSize=100', '?reason=SLAB_PUBLISHED&pageSize=100']) {
      const lista = await h.api(`GET`, `/admin/pricing/graded-estimates/review${q}`, { token: adminToken });
      expect(lista.status).toBe(200);
      expect(lista.body.data.find((x: any) => x.cardId === cardId)).toBeUndefined();
    }
    // (3) …y NINGÚN precio de venta cambió: el estimado nunca fue dinero (§4.38q.3).
    expect(despues.body.listings.find((l: any) => l.productType === 'raw').salePriceCents).toBe(precioAntes);
    expect(precioAntes).toBe(E2E_LIST_OVERRIDE_CENTS);
    // (4) …y la AUSENCIA de estimado NO es un «precio pendiente» (doctrina §4.38b.4): borrar no encola.
    expect(
      await h.prisma.pendingPriceEntry.findMany({ where: { cardId, productType: 'graded' } }),
    ).toHaveLength(0);

    // (5) AUDITADO con `before` = las filas borradas. Es la ÚNICA forma de deshacer (recapturar lo que
    //     había): un borrado en una tabla de dinero sin registro de qué había es inaceptable.
    const bitacora = await h.prisma.auditLog.findMany({
      where: { action: 'pricing.graded_estimate.delete', entityId: cardId },
      orderBy: { createdAt: 'asc' },
    });
    expect(bitacora.length).toBeGreaterThanOrEqual(2);
    const ultimoBorrado = bitacora[bitacora.length - 2].before as Record<string, any>;
    expect(ultimoBorrado).toMatchObject({ cardId, gradeValue: '10', deletedCount: filas10.length });
    expect(ultimoBorrado.rows.map((r: any) => r.priceMxnCents).sort()).toEqual(
      filas10.map((r) => r.priceMxnCents).sort(),
    );
    expect(bitacora[bitacora.length - 1].after).toBeNull();

    // (6) Repetir el borrado ⇒ `404`, JAMÁS un `200` silencioso: responder éxito cuando no pasó nada
    //     le haría creer al operador que limpió algo que no limpió (mismo criterio que el `PUT` vacío).
    const otraVez = await delEstimate(cardId, '10');
    expect(otraVez.status).toBe(404);
    // Y una clave arbitraria no se acepta en una ruta destructiva: solo los grados que la feature
    // gobierna (`grades`), nunca el `gradeKey` crudo con dos puntos escapados.
    expect((await delEstimate(cardId, '8')).status).toBe(400);
    expect((await delEstimate(cardId, 'graded%3APSA%3A10')).status).toBe(400);

    // ───────────────── (B) la carta con SLAB PUBLICADO: la guarda INV-D dispara y DEBE disparar ─────
    const conSlab = await h.prisma.card.findFirst({ where: { externalId: E2E_CARDS.slabbed.externalId } });
    if (!conSlab) throw new Error('fixture e2e-slab-raw no encontrado: corre `npm run seed:synthetic`');

    const fichaSlabAntes = await h.api('GET', `/catalog/cards/${conSlab.id}`);
    const slabAntes = fichaSlabAntes.body.listings.find((l: any) => l.productType === 'graded');
    // El criterio es «el `409` no borró NADA», así que se mide EL MISMO conteo antes y después —igual
    // que con el precio del slab— y no una longitud absoluta. Cuántas filas-día tenga esa clave es
    // asunto del fixture, no de esta prueba: fijar «exactamente 1» acoplaba el caso a que el seed no
    // hubiera corrido nunca otro día (fue el BLOQ-A que QA cazó).
    const filasSlabAntes = (await gradedRows(conSlab.id, 'graded:PSA:10')).length;
    expect(filasSlabAntes).toBeGreaterThan(0);
    expect(slabAntes.salePriceCents).toBeGreaterThan(0); // el slab se está VENDIENDO con ese precio
    // La fila `graded:PSA:10` de esta carta NO es un estimado: con el slab publicado es la referencia de
    // mercado REAL de una pieza física — y por eso la ficha no la muestra como estimado (INV-D lectura).
    expect(fichaSlabAntes.body.gradedEstimates).toBeUndefined();

    const bloqueado = await delEstimate(conSlab.id, '10');
    expect(bloqueado.status).toBe(409);
    expect(bloqueado.body.error.code).toBe('GRADED_ESTIMATE_SLAB_PUBLISHED');
    expect(bloqueado.body.error.details.publishedSlabCount).toBeGreaterThanOrEqual(1);

    // El precio del slab es IDÉNTICO antes y después: la guarda corta ANTES de tocar la tabla. Si el
    // borrado se permitiera, esa pieza quedaría sin referencia ⇒ PRICE_PENDING ⇒ DESPUBLICADA, y
    // despublicar una pieza real por «limpiar» es una acción de negocio, no una limpieza.
    const fichaSlabDespues = await h.api('GET', `/catalog/cards/${conSlab.id}`);
    const slabDespues = fichaSlabDespues.body.listings.find((l: any) => l.productType === 'graded');
    expect(slabDespues.salePriceCents).toBe(slabAntes.salePriceCents);
    expect(await gradedRows(conSlab.id, 'graded:PSA:10')).toHaveLength(filasSlabAntes);

    // ⛔ La inferencia que NO hay que hacer (§4.38q.2): este `DELETE` **no** es el remedio de INV-D
    // inverso. Aquí se ve el bucle real del operador — la carta expuesta se ENCUENTRA con
    // `?reason=SLAB_PUBLISHED`, pero el borrado de ESE grado está bloqueado; lo que sí se puede retirar
    // es el estimado de OTRO grado, porque ahí no hay ninguna pieza publicada que dependa de él.
    expect(
      (
        await h.api('POST', '/admin/pricing/override', {
          token: adminToken,
          json: {
            cardId: conSlab.id,
            productType: 'graded',
            gradeKey: 'graded:PSA:9',
            priceMxnCents: 600_000,
            intent: 'graded_estimate',
          },
        })
      ).status,
    ).toBe(200);
    const expuestas = await h.api(
      'GET',
      '/admin/pricing/graded-estimates/review?reason=SLAB_PUBLISHED&pageSize=100',
      { token: adminToken },
    );
    expect(expuestas.status).toBe(200);
    expect(expuestas.body.data.find((x: any) => x.cardId === conSlab.id)).toMatchObject({
      reason: 'SLAB_PUBLISHED',
      publishedSlabGrades: ['10'],
    });
    // La guarda es POR GRADO: el PSA 9 sí se retira (y así el fixture queda como estaba).
    const borrado9 = await delEstimate(conSlab.id, '9');
    expect(borrado9.status).toBe(200);
    expect(borrado9.body.deletedCount).toBe(1);
    // ⚠️ v1.50.3-e — **la carta SIGUE en `?reason=SLAB_PUBLISHED`, y eso es lo CORRECTO.** Hasta este
    // pase esta assertion esperaba que desapareciera, y lo hacía por el motivo equivocado: sin PSA 9 la
    // evaluación cortaba en `NO_PSA9` y **nunca llegaba a comprobar `SLAB_PUBLISHED`** — la carta salía
    // de la lista por un cortocircuito, no porque la exposición hubiera terminado.
    //
    // La exposición NO ha terminado: la fila `graded:PSA:10` sigue ahí (es la referencia de mercado del
    // slab publicado) y **es indistinguible de un estimado** — eso ES §4.38(l.3), el riesgo declarado, y
    // este filtro opt-in se define justamente como «el conjunto expuesto a él». Lo que cambió es que
    // ahora el conjunto está COMPLETO: antes solo se veían las cartas que además tuvieran el otro grado.
    const trasBorrar9 = await h.api(
      'GET',
      '/admin/pricing/graded-estimates/review?reason=SLAB_PUBLISHED&pageSize=100',
      { token: adminToken },
    );
    const expuestaAun = trasBorrar9.body.data.find((x: any) => x.cardId === conSlab.id);
    expect(expuestaAun).toMatchObject({
      reason: 'NO_PSA9', // el PRIMER bloqueante de la PROMOCIÓN — la decisión no cambia
      psa9MxnCents: null, // el estimado retirado ya no está: el borrado SÍ surtió efecto
      psa10MxnCents: E2E_CARDS.slabbed.refPsa10Cents, // …y la fila del SLAB sigue intacta
      publishedSlabGrades: ['10'],
      eligible: false,
    });
    // El diagnóstico completo nombra la exposición aunque no sea el primer bloqueante.
    expect(expuestaAun.reasons).toEqual(['NO_PSA9', 'SLAB_PUBLISHED']);
    // …y NO entra al filtro por DEFECTO: `SLAB_PUBLISHED` es la guarda funcionando, no un dato malo, y
    // meterlo ahí ahogaría la señal de incoherencia (§4.38n.2).
    expect(
      (
        await h.api('GET', '/admin/pricing/graded-estimates/review?pageSize=100', { token: adminToken })
      ).body.data.find((x: any) => x.cardId === conSlab.id),
    ).toBeUndefined();
    // …y el precio del slab sigue sin moverse tras TODO el ejercicio.
    const fichaSlabFinal = await h.api('GET', `/catalog/cards/${conSlab.id}`);
    expect(
      fichaSlabFinal.body.listings.find((l: any) => l.productType === 'graded').salePriceCents,
    ).toBe(slabAntes.salePriceCents);

    // Se recapturan los estimados de la carta del fixture para que los tests siguientes (9) partan del
    // mismo estado que antes de este caso.
    for (const [gradeKey, priceMxnCents] of [
      ['graded:PSA:10', PSA10_CENTS],
      ['graded:PSA:9', PSA9_CENTS],
    ] as const) {
      await h.api('POST', '/admin/pricing/override', {
        token: adminToken,
        json: { cardId, productType: 'graded', gradeKey, priceMxnCents, intent: 'graded_estimate' },
      });
    }
  });

  /**
   * §7 / SEC — una ruta **destructiva** sobre la tabla de dinero es `super_admin` y punto. Se prueba con
   * los DOS roles que no lo son (y con el anónimo), y se comprueba que la fila **sigue ahí**: un `403`
   * que aun así borrara sería el peor de los mundos.
   */
  it('8f) el borrado es `super_admin`: operador, cliente y anónimo reciben 401/403 y NADA se borra', async () => {
    const antes = await h.prisma.priceReference.count({
      where: { cardId, productType: 'graded', gradeKey: 'graded:PSA:10' },
    });
    expect(antes).toBeGreaterThan(0);
    const operador = await h.login(E2E_USERS.operator.email, E2E_USERS.operator.password);
    const cliente = await h.login(E2E_USERS.customer.email, E2E_USERS.customer.password);
    for (const token of [operador, cliente, undefined]) {
      const res = await h.api('DELETE', `/admin/pricing/graded-estimates/${cardId}/10`, { token });
      expect([401, 403]).toContain(res.status);
    }
    expect(
      await h.prisma.priceReference.count({
        where: { cardId, productType: 'graded', gradeKey: 'graded:PSA:10' },
      }),
    ).toBe(antes);
  });

  /**
   * v1.50.3-e (§4.38i.9 caso 9, §4.38n.2-ter) — **LA RED DE COHERENCIA CON UN SOLO GRADO.**
   *
   * Es el caso que más importa de toda la lista de revisión, porque es donde el error de unidades es
   * **más probable**: `NOT_ABOVE_RAW` caza el **USD capturado como MXN**, y ese error ocurre típicamente
   * en la **primera captura**, cuando el operador acaba de teclear **un solo grado**. La protección
   * faltaba precisamente en el momento de máximo riesgo.
   *
   * Medido antes del arreglo: raw MX$460 + PSA 10 MX$230 **sin PSA 9** ⇒ `review` devolvía `total: 0`
   * (la evaluación cortaba en `NO_PSA9` y la cota de magnitud nunca se comprobaba); **añadiendo** un PSA
   * 9, la misma carta aparecía al instante. Y el efecto compuesto es el fallo que §4.38 jura evitar: sin
   * PSA 9 la carta **nunca se promociona** (criterio 98) pero **la ficha SÍ muestra la cifra** (§4.38k.3,
   * la ficha no aplica magnitud) ⇒ **una cifra en unidades equivocadas, visible al comprador y no
   * enumerable para el operador**.
   *
   * Se ejecuta sobre la **CUARTA carta raw** del fixture, que nace **libre**: las tres anteriores ya se
   * consumen entre escenarios, y reciclar una aquí haría que este caso heredara el estado del anterior
   * — el acoplamiento entre pruebas que un fixture sintético existe para evitar. Termina **borrando** su
   * estimado, así que la deja como la encontró.
   */
  it('8g) caso 9 — un solo grado incoherente: NO se promociona, SÍ en la ficha y SÍ en `review`', async () => {
    await setDial('on');
    const cuarta = await h.prisma.card.findFirst({
      where: { externalId: E2E_CARDS.fourthraw.externalId },
    });
    if (!cuarta) throw new Error('fixture e2e-fourth-raw no encontrado: corre `npm run seed:synthetic`');

    // El precio de venta se LEE del catálogo (no se asume): es contra lo que la cota inferior compara,
    // y clavarlo a mano ataría el caso a la curva de precios vigente.
    const antes = await h.api('GET', `/catalog/cards/${cuarta.id}`);
    expect(antes.status).toBe(200);
    const grupoRaw = antes.body.listings.find((l: any) => l.productType === 'raw');
    const precioRaw = grupoRaw.salePriceCents;
    expect(precioRaw).toBeGreaterThan(0);
    // La carta parte LIMPIA: sin esto, un residuo de otra corrida haría verde este caso por accidente.
    expect(antes.body.gradedEstimates).toBeUndefined();

    // UN SOLO GRADO, y en unidades equivocadas: PSA 10 por DEBAJO del raw. **Sin PSA 9 a propósito.**
    const captura = await h.api('POST', '/admin/pricing/override', {
      token: adminToken,
      json: {
        cardId: cuarta.id,
        productType: 'graded',
        gradeKey: 'graded:PSA:10',
        priceMxnCents: Math.floor(precioRaw / 2),
        intent: 'graded_estimate',
      },
    });
    expect(captura.status).toBe(200);

    // (1) NO se promociona — ni teja ni vitrina. `reason` sigue siendo `NO_PSA9`: la DECISIÓN no cambió.
    const rejilla = await h.api(
      'GET',
      `/catalog/cards?q=${encodeURIComponent(E2E_CARDS.fourthraw.name)}&pageSize=20`,
    );
    const teja = rejilla.body.data.find((g: any) => g.card.id === cuarta.id && g.productType === 'raw');
    expect(teja).toBeDefined();
    expect(teja.gradingHighlight).toBeUndefined();
    const vitrina = await h.api('GET', '/catalog/cards?gradingHighlight=true&sort=grading_showcase&pageSize=8');
    expect(vitrina.body.data.find((g: any) => g.card.id === cuarta.id)).toBeUndefined();

    // (2) …pero la FICHA la sigue mostrando (§4.38k.3). Ésta es la mitad que obliga a la otra.
    const ficha = await h.api('GET', `/catalog/cards/${cuarta.id}`);
    expect(ficha.body.gradedEstimates).toHaveLength(1);
    expect(ficha.body.gradedEstimates[0].gradeValue).toBe('10');

    // (3) …y AHORA sí aparece en la lista de revisión. Antes de v1.50.3-e: `total: 0`, invisible.
    const porMotivo = await h.api(
      'GET',
      '/admin/pricing/graded-estimates/review?reason=NOT_ABOVE_RAW&pageSize=100',
      { token: adminToken },
    );
    expect(porMotivo.status).toBe(200);
    const fila = porMotivo.body.data.find((x: any) => x.cardId === cuarta.id);
    expect(fila).toBeDefined();
    expect(fila).toMatchObject({
      reason: 'NO_PSA9', // el PRIMER bloqueante, sin cambio de semántica (contrato §M2)
      eligible: false, // enumerarla NO la vuelve elegible
      psa10MxnCents: Math.floor(precioRaw / 2),
      psa9MxnCents: null, // money-safe: no resoluble es `null`, jamás 0
      salePriceCents: precioRaw,
    });
    // El diagnóstico COMPLETO es lo que la hace accionable: `reason` solo no bastaba.
    expect(fila.reasons).toEqual(['NO_PSA9', 'NOT_ABOVE_RAW']);
    // …y también con el filtro por DEFECTO (los tres de coherencia), que es como la mira el operador.
    const porDefecto = await h.api('GET', '/admin/pricing/graded-estimates/review?pageSize=100', {
      token: adminToken,
    });
    expect(porDefecto.body.data.find((x: any) => x.cardId === cuarta.id)).toBeDefined();

    // (4) …y NINGÚN precio de venta se movió: el estimado nunca fue dinero (criterio 112).
    expect(ficha.body.listings.find((l: any) => l.productType === 'raw').salePriceCents).toBe(precioRaw);

    // (5) El bucle se cierra con el remedio de §4.38(q) y la carta queda LIBRE otra vez (el fixture no
    //     se degrada corrida a corrida, que es justo por lo que esta carta existe).
    const borrado = await h.api('DELETE', `/admin/pricing/graded-estimates/${cuarta.id}/10`, {
      token: adminToken,
    });
    expect(borrado.status).toBe(200);
    const tras = await h.api('GET', '/admin/pricing/graded-estimates/review?pageSize=100', {
      token: adminToken,
    });
    expect(tras.body.data.find((x: any) => x.cardId === cuarta.id)).toBeUndefined();
    const fichaFinal = await h.api('GET', `/catalog/cards/${cuarta.id}`);
    expect(fichaFinal.body.gradedEstimates).toBeUndefined();
    expect(fichaFinal.body.listings.find((l: any) => l.productType === 'raw').salePriceCents).toBe(precioRaw);
  });

  /**
   * v1.50.3-e (petición de QA) — **las dos filas que la API del contrato NO puede fabricar**: un
   * estimado con `capturedDate` VIEJA y uno de origen **AUTOMÁTICO**. `POST /admin/pricing/override`
   * escribe siempre manual y siempre con la fecha de hoy (a propósito, §4.38m: el manual se refresca
   * recapturándolo), así que el sabor **automático** de `STALE` —el que tiene el remedio OPUESTO:
   * mirar el ingest, no la carta— solo estaba cubierto por unitarios con dobles.
   *
   * Con la carta `e2e-stale-est` del fixture ese sabor queda ejercitado contra el stack vivo.
   */
  it('8h) `?reason=STALE` con una fila AUTOMÁTICA: `isManual:false` (remedio = mirar el ingest)', async () => {
    await setDial('on');
    const rancia = await h.prisma.card.findFirst({
      where: { externalId: E2E_CARDS.staleest.externalId },
    });
    if (!rancia) throw new Error('fixture e2e-stale-est no encontrado: corre `npm run seed:synthetic`');
    const [psa10Seed] = E2E_STALE_ESTIMATES;

    const caducadas = await h.api('GET', '/admin/pricing/graded-estimates/review?reason=STALE&pageSize=100', {
      token: adminToken,
    });
    expect(caducadas.status).toBe(200);
    const fila = caducadas.body.data.find((x: any) => x.cardId === rancia.id);
    expect(fila).toBeDefined();
    expect(fila).toMatchObject({
      reason: 'STALE',
      stale: true,
      eligible: false,
      // La fila REPORTADA es la más antigua de las presentes (§4.38n.2-bis, MEN-B), que aquí es la
      // AUTOMÁTICA: por eso el remedio que señala es «mirar el ingest», no «recapturar».
      isManual: false,
      psa10MxnCents: psa10Seed.priceMxnCents,
    });
    // …y NO revela la identidad del proveedor: contesta «¿la puse yo?», nada más (§4.38g/n.2-bis).
    expect(fila).not.toHaveProperty('source');
    expect(JSON.stringify(fila)).not.toContain('pokemonpricetracker');

    // Las cifras del fixture son COHERENTES: esta carta NO debe ensuciar la señal de incoherencia.
    const porDefecto = await h.api('GET', '/admin/pricing/graded-estimates/review?pageSize=100', {
      token: adminToken,
    });
    expect(porDefecto.body.data.find((x: any) => x.cardId === rancia.id)).toBeUndefined();

    // Y lo rancio NO se exhibe: la ficha calla aunque las filas existan en la tabla (criterio 109).
    const ficha = await h.api('GET', `/catalog/cards/${rancia.id}`);
    expect(ficha.body.gradedEstimates).toBeUndefined();
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
