/**
 * graded-estimate-degrade-market-ref.e2e-spec.ts — **SEC-M43-1 reproducido de punta a punta, y cerrado.**
 * M-44 / M-44b · ARCHITECTURE §4.38(l.4.10) · `API_CONTRACT` rev v1.50.3-g · `SECURITY_NOTES.md` §5.1.
 * Propiedad: backend; la EJECUTA QA.
 *
 * ## El ataque que este archivo ejecuta (el PoC del blue team, paso por paso, contra Postgres real)
 *
 * ```
 * estado inicial : PriceReference(graded:PSA:10) = 500000 · refKind=market   ← dinero de una pieza REAL
 *                  InventoryItem PSA 10 de esa carta
 * 1) el slab sale de `listed`  (in_stock / reserved / picking / envío… o CUSTODIA DE CLIENTE)
 * 2) POST /admin/pricing/override {graded, graded:PSA:10, 1234, intent:"graded_estimate"}
 *    ANTES → 200  (la guarda hermana solo ve `platform + listed`: no lo ve)
 *          → fila: graded:PSA:10 | 1234 | graded_estimate   ← la referencia de MERCADO, destruida
 * 3) republicar el slab
 *    ANTES → GET /catalog/cards/:id ⇒ listings: []          ← pieza REAL, invisible
 *          → GET /admin/pricing/pending ⇒ no la contiene    ← ninguna cola la ve
 * ```
 *
 * **Un verbo INFORMATIVO destruía un dato de DINERO**, con `200` y sin que ninguna cola se enterara
 * (`reconcilePublishedPrices` es `raw`-only, `TECH_DEBT` M43-D1). Desde M-44 el paso 2 responde
 * **`409 GRADED_ESTIMATE_WOULD_DEGRADE_MARKET_REF`** y la fila **no se toca: ni naturaleza ni monto**.
 *
 * ## Por qué el caso de CUSTODIA está aquí y no es un extra
 * §4.38(q.2) sostenía que «si el slab no está `listed`, nada vivo depende de esa fila». Para
 * `ownerType='customer'` **eso es falso**, y el arquitecto lo declara en (l.4.10): de esa fila cuelgan
 * la valuación de la bóveda del cliente, `admin-vaults`, el snapshot de portafolio y la oferta de
 * buylist — **bienes de un tercero**. El caso (B) lo mide con el portafolio real del cliente.
 *
 * ## Estado compartido
 * La BD es de toda la suite: este archivo usa `thirdraw` (`e2e-third-raw`, sin filas `graded:PSA:*` en
 * el seed y sin uso en ninguna otra suite de integración), crea sus piezas con folios propios
 * `E2E-M44-*` y las retira en el `afterAll` **aunque un caso haya fallado a medias**.
 */
import { E2EHarness } from './helpers/e2e-app';
import { E2E_CARDS, E2E_USERS } from '../../prisma/e2e-fixtures';

describe('E2E — SEC-M43-1 / M-44: un ESTIMADO no puede destruir la referencia de MERCADO de una pieza real', () => {
  let h: E2EHarness;
  let adminToken: string;
  let cardId: string;
  let slabId: string | null = null;

  /** Los montos EXACTOS del PoC del blue team, en centavos MXN. */
  /** La referencia de MERCADO de la pieza: MX$5,000. */
  const MERCADO_CENTS = 500_000;
  /** El «estimado» con el que se pisaba: MX$12.34. */
  const ESTIMADO_CENTS = 1_234;

  const FOLIO = 'E2E-M44-DEGRADE-0001';
  const GRADE_KEY = 'graded:PSA:10';
  const clave = { productType: 'graded' as const, gradeKey: GRADE_KEY, finish: 'normal' as const };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ficha = async (): Promise<any> => (await h.api('GET', `/catalog/cards/${cardId}`)).body;
  const slabListing = (body: { listings: Record<string, unknown>[] }) =>
    body.listings.find((l) => l.productType === 'graded' && l.gradeValue === '10');

  /** La fila del día de la clave atacada — el objeto del hallazgo. */
  const filaDelDia = async () =>
    h.prisma.priceReference.findFirst({
      where: { cardId, ...clave, cardProductId: null },
      orderBy: { capturedDate: 'desc' },
    });

  /** El ataque: capturar un «estimado» encima de la referencia de mercado del día. */
  const atacar = () =>
    h.api('POST', '/admin/pricing/override', {
      token: adminToken,
      json: {
        cardId,
        productType: 'graded',
        gradeKey: GRADE_KEY,
        priceMxnCents: ESTIMADO_CENTS,
        intent: 'graded_estimate',
      },
    });

  beforeAll(async () => {
    h = await E2EHarness.create();
    adminToken = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    const card = await h.prisma.card.findFirst({ where: { externalId: E2E_CARDS.thirdraw.externalId } });
    if (!card) throw new Error('fixture e2e-third-raw no encontrado: corre `npm run seed:synthetic`');
    cardId = card.id;
    await h.prisma.priceReference.deleteMany({ where: { cardId, ...clave } });
    await h.prisma.inventoryItem.deleteMany({ where: { folio: FOLIO } });

    // ===== Estado inicial: la referencia de MERCADO de una pieza real, afirmada por un humano. =====
    const ref = await h.api('POST', '/admin/pricing/override', {
      token: adminToken,
      json: { cardId, productType: 'graded', gradeKey: GRADE_KEY, priceMxnCents: MERCADO_CENTS, intent: 'market' },
    });
    expect(ref.status).toBe(200);
    expect(ref.body.data.refKind).toBe('market');

    // El slab, FUERA de `listed` — el punto ciego exacto de la guarda hermana: aquí cabe la reserva,
    // el picking, el envío en curso, la pre-publicación… y la custodia del caso (B).
    const location = await h.prisma.vaultLocation.findFirst({ where: { zone: 'platform_stock' } });
    const slab = await h.prisma.inventoryItem.create({
      data: {
        folio: FOLIO,
        cardId,
        productType: 'graded',
        gradingCompany: 'PSA',
        gradeValue: '10',
        certNumber: 'E2E-M44-CERT',
        ownerType: 'platform',
        status: 'in_stock',
        acquisitionType: 'compra',
        acquisitionCostCents: 300_000,
        finish: 'normal',
        locationId: location?.id ?? null,
      },
    });
    slabId = slab.id;
  });

  afterAll(async () => {
    if (slabId) await h.prisma.inventoryItem.deleteMany({ where: { id: slabId } });
    if (cardId) await h.prisma.priceReference.deleteMany({ where: { cardId, ...clave } });
    await h?.close();
  });

  it('A) el PoC: con el slab en `in_stock`, el estimado recibe 409 y la fila NO se toca', async () => {
    const antes = await filaDelDia();
    expect(antes).toMatchObject({ refKind: 'market', priceMxnCents: MERCADO_CENTS });

    const res = await atacar();

    // ⛔ LA TABLA PRIMERO, y el orden es deliberado: el hallazgo es lo que le pasa a la FILA de
    // dinero; el código de error es solo la forma en que se dice. Si la guarda se cayera, el rojo
    // muestra la degradación literal (`market → graded_estimate`, `500000 → 1234`) y no un status.
    // Las DOS propiedades, que el dictamen nombra por separado: naturaleza **y** monto.
    const despues = await filaDelDia();
    expect({ refKind: despues!.refKind, priceMxnCents: despues!.priceMxnCents }).toEqual({
      refKind: 'market',
      priceMxnCents: MERCADO_CENTS,
    });

    // El código lo dice todo: NO es el `409` de la guarda hermana (que no ve este slab) sino el de
    // M-44. Si algún día esto volviera a ser `200`, el hallazgo está reabierto.
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('GRADED_ESTIMATE_WOULD_DEGRADE_MARKET_REF');
    expect(res.body.error.details).toMatchObject({
      cardId,
      gradeKey: GRADE_KEY,
      currentRefKind: 'market',
    });
    // El monto vigente NO viaja en `details` (dato comercial; el operador lo ve en `priceHistory`).
    expect(JSON.stringify(res.body.error.details)).not.toContain(String(MERCADO_CENTS));
    // …pero el MENSAJE sí lo nombra, que es lo que le dice al operador qué está a punto de pisar.
    expect(res.body.error.message).toContain('MX$5,000.00');
    expect(res.body.error.message).toContain('intent:"market"');

    // Y no se coló una SEGUNDA fila de estimado del mismo día por la puerta de al lado.
    const delDia = await h.prisma.priceReference.findMany({
      where: { cardId, ...clave, capturedDate: despues!.capturedDate },
    });
    expect(delDia).toHaveLength(1);
  });

  it('A2) al REPUBLICAR, la pieza sigue vendible y a su precio real (antes: invisible en catálogo)', async () => {
    await h.prisma.inventoryItem.update({ where: { id: slabId! }, data: { status: 'listed' } });
    const body = await ficha();
    const l = slabListing(body) as Record<string, unknown> | undefined;

    // ANTES de M-44 aquí había `listings: []` para el grupo graded: la pieza REAL quedaba fuera de
    // venta en silencio y `GET /admin/pricing/pending` tampoco la contenía (M43-D1).
    expect(l).toBeDefined();
    expect(l!.priceBasis).toBe('market');
    expect(l!.referenceValue).toMatchObject({ referenceMxnCents: MERCADO_CENTS });
    expect((l!.salePriceCents as number) > MERCADO_CENTS).toBe(true);
    // Y el número del ataque no aparece en NINGUNA parte de la superficie pública de la carta.
    expect(JSON.stringify(body)).not.toContain(String(ESTIMADO_CENTS));
    // La ruta por-pieza dice lo mismo: la pieza es comprable.
    expect((await h.api('GET', `/catalog/listings/${slabId}`)).status).toBe(200);
  });

  it('B) CUSTODIA DE CLIENTE — el caso que decide la severidad: la valuación del dueño no se cae', async () => {
    // (l.4.10): para `ownerType='customer'` la frase de (q.2) («nada vivo depende de esa fila») es
    // FALSA y el arquitecto lo declara: de esta fila cuelgan la bóveda del cliente, `admin-vaults`, el
    // snapshot de portafolio y la oferta de buylist. Son bienes de un TERCERO.
    const cliente = await h.prisma.user.findFirst({ where: { email: E2E_USERS.customer2.email } });
    const custodia = await h.prisma.vaultLocation.findFirst({ where: { zone: 'customer_custody' } });
    await h.prisma.inventoryItem.update({
      where: { id: slabId! },
      data: {
        ownerType: 'customer',
        ownerUserId: cliente!.id,
        ownershipStatus: 'settled',
        status: 'in_custody',
        locationId: custodia?.id ?? null,
      },
    });

    const res = await atacar();
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('GRADED_ESTIMATE_WOULD_DEGRADE_MARKET_REF');
    const fila = await filaDelDia();
    expect(fila).toMatchObject({ refKind: 'market', priceMxnCents: MERCADO_CENTS });

    // Y se comprueba dónde duele: el portafolio del cliente sigue valuando su pieza a MX$5,000. Antes
    // de M-44 esta valuación caía a `pending` sin que nadie lo notara.
    const tokenCliente = await h.login(E2E_USERS.customer2.email, E2E_USERS.customer2.password);
    const holdings = await h.api('GET', '/vault/holdings', { token: tokenCliente });
    expect(holdings.status).toBe(200);
    const pieza = (holdings.body.data as Record<string, unknown>[]).find((d) => d.folio === FOLIO);
    expect(pieza).toBeDefined();
    expect(JSON.stringify(pieza)).toContain(String(MERCADO_CENTS));
    expect(holdings.body.portfolio.totalValueMxnCents).toBeGreaterThanOrEqual(MERCADO_CENTS);
  });

  it('C) PRECEDENCIA (l.4.10 punto 2): con el slab PUBLICADO gana `GRADED_ESTIMATE_SLAB_PUBLISHED`', async () => {
    // Las dos condiciones se cumplen a la vez (slab `platform+listed` Y fila `market` del día). Gana la
    // preexistente: su mensaje es más útil al operador y su `details` enumera los `inventoryItemIds`.
    await h.prisma.inventoryItem.update({
      where: { id: slabId! },
      data: { ownerType: 'platform', ownerUserId: null, ownershipStatus: null, status: 'listed' },
    });
    const res = await atacar();
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('GRADED_ESTIMATE_SLAB_PUBLISHED');
    expect(res.body.error.details.inventoryItemIds).toContain(slabId);
    // La fila, igual de intacta: las dos guardas fallan cerrando, ninguna se apoya en la otra.
    expect(await filaDelDia()).toMatchObject({ refKind: 'market', priceMxnCents: MERCADO_CENTS });
  });

  it('D) M-44b — la bitácora permite reconstruir el monto pisado (`before`), y el bloqueo queda trazado', async () => {
    // El bloqueo del caso (A)/(B) tiene su propia acción: un intento BLOQUEADO no es un override.
    const bloqueos = await h.prisma.auditLog.findMany({
      where: { action: 'pricing.override.blocked', entityId: cardId },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });
    expect(bloqueos.length).toBeGreaterThan(0);
    const codigos = bloqueos.map((b) => (b.after as Record<string, unknown>).code);
    expect(codigos).toContain('GRADED_ESTIMATE_WOULD_DEGRADE_MARKET_REF');
    expect((bloqueos[0].after as Record<string, unknown>).attemptedPriceMxnCents).toBeDefined();

    // Y un override LEGÍTIMO que pisa un monto deja el anterior en la bitácora: sin `before`, el valor
    // destruido no era reconstruible desde el audit trail (§5.1 del blue team, y residual (l.4.9)-1).
    const NUEVO = 640_000;
    const res = await h.api('POST', '/admin/pricing/override', {
      token: adminToken,
      json: { cardId, productType: 'graded', gradeKey: GRADE_KEY, priceMxnCents: NUEVO, intent: 'market' },
    });
    expect(res.status).toBe(200);
    const escritura = await h.prisma.auditLog.findFirst({
      where: { action: 'pricing.override' },
      orderBy: { createdAt: 'desc' },
    });
    expect(escritura!.before).toMatchObject({
      priceMxnCents: MERCADO_CENTS,
      refKind: 'market',
      source: 'manual',
    });
    expect(escritura!.after).toMatchObject({ priceMxnCents: NUEVO });
    // Se deja la fila como estaba para no sorprender a nadie que lea el estado final.
    await h.api('POST', '/admin/pricing/override', {
      token: adminToken,
      json: { cardId, productType: 'graded', gradeKey: GRADE_KEY, priceMxnCents: MERCADO_CENTS, intent: 'market' },
    });
  });

  it('E) SEC-M43-4 — el borde de dinero ya no responde 500 a una entrada basura', async () => {
    const post = (json: Record<string, unknown>) =>
      h.api('POST', '/admin/pricing/override', { token: adminToken, json });

    const banana = await post({ cardId, productType: 'banana', gradeKey: 'raw:NM', priceMxnCents: 1000 });
    expect(banana.status).toBe(422);
    expect(banana.body.error.code).toBe('VALIDATION_ERROR');

    const sinCarta = await post({
      cardId: 'no-existe',
      productType: 'graded',
      gradeKey: GRADE_KEY,
      priceMxnCents: 1000,
      intent: 'market',
    });
    expect(sinCarta.status).toBe(404);
    expect(sinCarta.body.error.code).toBe('NOT_FOUND');

    // El tercero es el peor de los tres: devolvía `200` y CREABA una fila de dinero para un grado que
    // ninguna pieza puede llevar — invisible para toda lectura y para el operador.
    const grado11 = await post({
      cardId,
      productType: 'graded',
      gradeKey: 'graded:PSA:11',
      priceMxnCents: 1000,
      intent: 'graded_estimate',
    });
    expect(grado11.status).toBe(422);
    expect(grado11.body.error.code).toBe('VALIDATION_ERROR');
    expect(
      await h.prisma.priceReference.count({ where: { cardId, gradeKey: 'graded:PSA:11' } }),
    ).toBe(0);
  });
});
