/**
 * graded-estimate-inv-d-inverse.e2e-spec.ts — **GE-1 reproducido de punta a punta, y cerrado.**
 * M-43 / ARCHITECTURE §4.38(l.4) · API_CONTRACT rev v1.50.3-f · `PENTEST_NOTES.md` «PASE FEATURE».
 * Propiedad: backend; la EJECUTA QA.
 *
 * ## El ataque que este archivo ejecuta
 * Es **el PoC del pentester, paso por paso**, contra la app REAL y Postgres REAL:
 *
 *   1. `POST /admin/pricing/override` con `intent:"graded_estimate"` sobre una carta **sin slab**
 *      (permitido: la guarda `409` no aplica), con el error USD-como-MXN: **MX$400 = 40 000 c**.
 *   2. Se **publica un slab PSA 10** de esa misma carta (el intake real; aquí por Prisma, como el PoC
 *      lo hizo por SQL en el entorno desechable).
 *   3. Se lee el **precio PÚBLICO** del slab.
 *
 * **Antes de M-43 el paso 3 devolvía `salePriceCents: 46000` (`basis: "market"`)** — MX$460 por un slab
 * PSA 10 que con su referencia correcta lista a **MX$9,200**: el **5 %** de su valor, comprable por
 * cualquiera. La fila del estimado y la referencia de mercado del slab son **LA MISMA FILA**, así que al
 * publicarse la pieza el número «informativo» pasó a ser su precio de venta.
 *
 * ## Por qué las guardas existentes no lo cubrían (y por eso este archivo es nuevo, no un `it` más)
 * - El `409 GRADED_ESTIMATE_SLAB_PUBLISHED` vigila **escribir el estimado sobre una carta que YA tiene
 *   slab**. Aquí el orden es el inverso, y en el paso 1 **no hay nada que bloquear**.
 * - La frescura **no rescata**: el PoC retrasó `capturedDate` 400 días y el slab **siguió** a MX$460.
 *   La frescura es un predicado de EXHIBICIÓN (decide qué se pinta) y **jamás** retira una fila del
 *   resolver de dinero. El caso (B) de aquí abajo lo reproduce.
 * - `sourceRank` tampoco: el estimado es la **única** candidata de su clave y gana con cualquier rango
 *   (§4.38l.4.1). Hacía falta **excluir**, no ordenar.
 *
 * ## Estado compartido
 * La BD es compartida por la suite: este archivo **crea** su slab y lo **borra**, y limpia sus filas
 * `graded:PSA:*`. Usa `fourthraw` (`e2e-fourth-raw`) — la carta raw publicada y **LIBRE** del fixture,
 * la misma que usó el pentester — para no heredar el estado de ningún otro caso.
 */
import { E2EHarness } from './helpers/e2e-app';
import { E2E_CARDS, E2E_FOLIOS, E2E_USERS } from '../../prisma/e2e-fixtures';

describe('E2E — GE-1 / INV-D inverso: un estimado JAMÁS precia un slab publicado (M-43)', () => {
  let h: E2EHarness;
  let adminToken: string;
  let cardId: string;
  let slabId: string | null = null;

  /** El estimado con el error de unidades del PoC: USD 400 tecleados como MX$400. */
  const ESTIMADO_MALO_CENTS = 40_000;
  /** La referencia de mercado CORRECTA de un slab PSA 10 (la del fixture `slabbed`): MX$8,000. */
  const MERCADO_SLAB_CENTS = 800_000;
  /** Lo que el slab listaba heredando el estimado: 40 000 × 1.15 = MX$460. */
  const PRECIO_HEREDADO_CENTS = 46_000;

  const FOLIO = 'E2E-M43-INVD-0001';
  const GRADE_KEY = 'graded:PSA:10';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ficha = async (): Promise<any> => (await h.api('GET', `/catalog/cards/${cardId}`)).body;
  /**
   * El grupo PSA 10 de la ficha. `undefined` NO es «no encontré el campo»: `fetchSellable` descarta las
   * piezas no vendibles, así que un slab sin referencia de MERCADO **no tiene grupo** — su ausencia ES
   * el efecto observable de M-43.
   */
  const slabListing = (body: { listings: Record<string, unknown>[] }) =>
    body.listings.find((l) => l.productType === 'graded' && l.gradeValue === '10');

  const claveDelEstimado = { productType: 'graded' as const, gradeKey: GRADE_KEY, finish: 'normal' as const };

  beforeAll(async () => {
    h = await E2EHarness.create();
    adminToken = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    const card = await h.prisma.card.findFirst({ where: { externalId: E2E_CARDS.fourthraw.externalId } });
    if (!card) throw new Error('fixture e2e-fourth-raw no encontrado: corre `npm run seed:synthetic`');
    cardId = card.id;
    // Punto de partida limpio: la carta del fixture nace SIN ninguna fila `graded:PSA:*` y sin slab.
    await h.prisma.priceReference.deleteMany({ where: { cardId, ...claveDelEstimado } });
    await h.prisma.inventoryItem.deleteMany({ where: { folio: FOLIO } });
  });

  afterAll(async () => {
    // El slab y las filas de precio son estado GLOBAL: se retiran aunque un caso haya fallado a medias.
    if (slabId) await h.prisma.inventoryItem.deleteMany({ where: { id: slabId } });
    if (cardId) await h.prisma.priceReference.deleteMany({ where: { cardId, ...claveDelEstimado } });
    await h?.close();
  });

  it('A) el PoC completo: capturar el estimado, publicar el slab ⇒ el slab NO hereda MX$460', async () => {
    // --- PASO 1 del PoC: el estimado con error de unidades. PERMITIDO: aún no hay slab. --------------
    const captura = await h.api('POST', '/admin/pricing/override', {
      token: adminToken,
      json: {
        cardId,
        productType: 'graded',
        gradeKey: GRADE_KEY,
        priceMxnCents: ESTIMADO_MALO_CENTS,
        intent: 'graded_estimate',
      },
    });
    expect(captura.status).toBe(200);
    // v1.50.3-f: el `intent` ya no vive solo en la bitácora — CONGELÓ la naturaleza en la fila, y es
    // esa naturaleza (no el estado del mundo) la que decide si el número puede ser dinero.
    expect(captura.body.data.refKind).toBe('graded_estimate');
    const fila = await h.prisma.priceReference.findFirst({ where: { cardId, ...claveDelEstimado } });
    expect(fila).toMatchObject({ priceMxnCents: ESTIMADO_MALO_CENTS, refKind: 'graded_estimate' });

    // --- PASO 2 del PoC: se publica un slab PSA 10 de ESA carta (plataforma, `listed`) ---------------
    const location = await h.prisma.vaultLocation.findFirst({ where: { zone: 'platform_stock' } });
    const slab = await h.prisma.inventoryItem.create({
      data: {
        folio: FOLIO,
        cardId,
        productType: 'graded',
        gradingCompany: 'PSA',
        gradeValue: '10',
        certNumber: 'E2E-M43-CERT',
        ownerType: 'platform',
        status: 'listed',
        acquisitionType: 'compra',
        acquisitionCostCents: 500_000,
        finish: 'normal',
        locationId: location?.id ?? null,
      },
    });
    slabId = slab.id;

    // --- PASO 3 del PoC: el precio PÚBLICO del slab -------------------------------------------------
    const body = await ficha();
    // ⛔ LA ASERCIÓN DEL HALLAZGO: la cifra medida por el pentester (MX$460) no aparece en NINGUNA
    // parte de la superficie pública de esta carta. Se escanea el body entero a propósito: el ataque
    // no es «este campo trae un número raro», es «el número del estimado se convirtió en dinero».
    expect(JSON.stringify(body)).not.toContain(String(PRECIO_HEREDADO_CENTS));
    // Y el fallo es en la dirección CORRECTA y declarada (§4.38l.4.4A): sin fila de MERCADO en su
    // clave el slab resuelve `pending` ⇒ no es vendible ⇒ `fetchSellable` lo descarta ⇒ **desaparece
    // del storefront**. Una pieza sin precio no le cuesta dinero a nadie; una pieza al 5 % sí.
    expect(slabListing(body)).toBeUndefined();
    expect(body.units.some((u: Record<string, unknown>) => u.inventoryItemId === slab.id)).toBe(false);
    // La ruta por-pieza dice lo mismo (un no-vendible no es visible en Compra): `404`, no un precio.
    const porPieza = await h.api('GET', `/catalog/listings/${slab.id}`);
    expect(porPieza.status).toBe(404);
    // El grupo RAW de la carta sigue publicado y priceado: M-43 apaga la pieza sin referencia de
    // mercado, no la carta.
    expect(body.listings.some((x: Record<string, unknown>) => x.productType === 'raw')).toBe(true);

    // El estimado NO se borró ni se movió: sigue en la tabla, intacto. M-43 no destruye datos — cambia
    // quién puede leerlos como dinero.
    const sigue = await h.prisma.priceReference.findFirst({ where: { cardId, ...claveDelEstimado } });
    expect(sigue).toMatchObject({ priceMxnCents: ESTIMADO_MALO_CENTS, refKind: 'graded_estimate' });
  });

  it('B) variante RANCIA del PoC (−400 días): tampoco lo pricea (la frescura nunca fue la defensa)', async () => {
    // El pentester retrasó `capturedDate` 400 días y el slab SIGUIÓ a MX$460. La razón es estructural:
    // el estimado se escribe por la vía manual (`isManualOverride: true`), así que entra al resolver por
    // la lectura de candidatas PERENNES, que va SIN cota de fecha (§4.27f-2). Si `MONEY_REF_WHERE`
    // faltara en ESA query —el olvido natural, porque no es la query «principal»— el hallazgo seguiría
    // vivo justo en su variante más difícil de ver.
    const hace400 = new Date();
    hace400.setUTCHours(0, 0, 0, 0);
    hace400.setUTCDate(hace400.getUTCDate() - 400);
    await h.prisma.priceReference.updateMany({
      where: { cardId, ...claveDelEstimado },
      data: { capturedDate: hace400 },
    });

    const body = await ficha();
    expect(JSON.stringify(body)).not.toContain(String(PRECIO_HEREDADO_CENTS));
    expect(slabListing(body)).toBeUndefined();
    expect((await h.api('GET', `/catalog/listings/${slabId}`)).status).toBe(404);
  });

  it('C) el REMEDIO (paso 3 del cut-over): re-afirmar con `intent:"market"` devuelve el precio real', async () => {
    // §4.38(l.4.7) paso 3: «re-afirmar el precio de cada slab con `intent:"market"` ANTES de migrar».
    // Sin este gesto, migrar apaga la pieza en silencio; con él, la migración no puede apagar nada.
    // Es además un acto de dinero DELIBERADO y AUDITADO, que es exactamente lo que el hallazgo pedía
    // que sustituyera a la herencia silenciosa.
    const res = await h.api('POST', '/admin/pricing/override', {
      token: adminToken,
      json: {
        cardId,
        productType: 'graded',
        gradeKey: GRADE_KEY,
        priceMxnCents: MERCADO_SLAB_CENTS,
        intent: 'market',
      },
    });
    expect(res.status).toBe(200);
    expect(res.body.data.refKind).toBe('market');

    const l = slabListing(await ficha()) as Record<string, unknown> | undefined;
    // La pieza VUELVE al storefront: con una fila de MERCADO en su clave ya es vendible.
    expect(l).toBeDefined();
    expect(l!.priceBasis).toBe('market');
    // ORÁCULO SIN NÚMERO MÁGICO: el fixture `slabbed` tiene un slab PSA 10 publicado con EXACTAMENTE
    // esta misma referencia de mercado (`refPsa10Cents = 800000` ⇒ MX$9,200). Dos piezas con la misma
    // referencia tienen que resolver el MISMO precio, sin que este test tenga que reimplementar la
    // curva —lo que lo volvería inmune a un error en ella, que es justo lo contrario de lo que sirve—.
    const otro = await h.prisma.inventoryItem.findUnique({ where: { folio: E2E_FOLIOS.listedSlab } });
    const fichaSlabbed = (await h.api('GET', `/catalog/cards/${otro!.cardId}`)).body;
    const esperado = fichaSlabbed.listings.find(
      (x: Record<string, unknown>) => x.productType === 'graded' && x.gradeValue === '10',
    );
    expect(esperado.salePriceCents).toBeGreaterThan(PRECIO_HEREDADO_CENTS);
    expect(l!.salePriceCents).toBe(esperado.salePriceCents);
  });

  it('D) ⚠️ EL TRAMPOLÍN — la re-afirmación del MISMO día RECLASIFICA la fila, no crea una segunda', async () => {
    // La `@@unique` NO incluye `refKind`, así que para una carta+grado+día hay UNA sola fila: el
    // `intent:"market"` del caso (C) cayó sobre la fila-estimado del día y la RECLASIFICÓ. Si el
    // `update` del escritor hubiera omitido `refKind` —el trampolín que §4.38(l.4.3) marca por escrito—
    // la fila seguiría siendo `graded_estimate`, el paso 3 del cut-over no funcionaría y el slab se
    // quedaría **sin precio** aunque el operador acabara de afirmarlo. Se comprueba aquí porque es una
    // propiedad de la TABLA, no de la respuesta HTTP.
    const filas = await h.prisma.priceReference.findMany({
      where: { cardId, ...claveDelEstimado },
      orderBy: { capturedDate: 'desc' },
    });
    const deHoy = filas.filter((f) => f.priceMxnCents === MERCADO_SLAB_CENTS);
    expect(deHoy).toHaveLength(1);
    expect(deHoy[0].refKind).toBe('market');
    expect(deHoy[0].isManualOverride).toBe(true);
    // Y NO quedó ninguna fila de estimado de ese mismo día compitiendo con ella.
    const estimadosDeHoy = filas.filter(
      (f) => f.refKind === 'graded_estimate' && f.capturedDate.getTime() === deHoy[0].capturedDate.getTime(),
    );
    expect(estimadosDeHoy).toHaveLength(0);
  });

  it('E) PASO 2 del cut-over — `/review?reason=SLAB_PUBLISHED` enumera la coexistencia y dice `refKind`', async () => {
    // §4.38(l.4.7) paso 2: ésta es la lista con la que el operador sabe QUÉ re-afirmar antes de migrar.
    // El `refKind` por fila es lo que impide el error simétrico: sin él, una lista que ofrece un verbo
    // DESTRUCTIVO al lado invita a «limpiar» una cifra que es el precio de una pieza física viva.
    const res = await h.api('GET', '/admin/pricing/graded-estimates/review?reason=SLAB_PUBLISHED&pageSize=50', {
      token: adminToken,
    });
    expect(res.status).toBe(200);
    const fila = res.body.data.find((x: Record<string, unknown>) => x.cardId === cardId);
    expect(fila).toBeDefined();
    expect(fila.reasons).toContain('SLAB_PUBLISHED');
    expect(fila.publishedSlabGrades).toContain('10');
    // Tras la re-afirmación del caso (C) la fila es DINERO: el `DELETE` del gancho no se la lleva.
    expect(fila.refKind).toBe('market');
    // Y el diagnóstico por carta dice lo mismo (mismo cálculo, misma fila).
    const prev = await h.api('GET', `/admin/pricing/graded-estimates/preview?cardId=${cardId}`, {
      token: adminToken,
    });
    expect(prev.status).toBe(200);
    expect(prev.body.groups[0].refKind).toBe('market');
  });

  it('F) la guarda DIRECTA (409) sigue en pie: defensa en profundidad, ninguna se apoya en la otra', async () => {
    // Con `refKind` el `409` dejó de ser estrictamente necesario para el DINERO, y aun así se conserva:
    // con un slab publicado, «capturar un estimado» es una intención EQUIVOCADA y el sistema tiene que
    // decirlo, no absorberla en silencio (§4.38l.4.3 regla 3).
    const res = await h.api('POST', '/admin/pricing/override', {
      token: adminToken,
      json: {
        cardId,
        productType: 'graded',
        gradeKey: GRADE_KEY,
        priceMxnCents: ESTIMADO_MALO_CENTS,
        intent: 'graded_estimate',
      },
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('GRADED_ESTIMATE_SLAB_PUBLISHED');
    // El precio del slab NO se movió (la guarda corta ANTES de escribir).
    const l = slabListing(await ficha()) as Record<string, unknown> | undefined;
    expect(l!.priceBasis).toBe('market');
    expect(l!.referenceValue).toMatchObject({ referenceMxnCents: MERCADO_SLAB_CENTS });
  });
});
