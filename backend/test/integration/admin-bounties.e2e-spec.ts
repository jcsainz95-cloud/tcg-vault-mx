import { E2EHarness } from './helpers/e2e-app';
import { seedE2E } from '../../prisma/seed-e2e';
import { E2E_USERS } from '../../prisma/e2e-fixtures';
import { DEFAULT_PRICING_CURVE, resolveBuyFromCurve, PricingCurve } from '../../src/common/pricing-curve';

/**
 * `admin-bounties.e2e-spec.ts` — **la CONSOLA DE BOUNTIES contra el stack vivo**
 * (`GET /api/v1/admin/pricing/bounties`, API_CONTRACT §M2-B, ARCHITECTURE §4.42, PROJECT
 * criterio **184** / **D52**).
 *
 * ### Lo que este archivo existe para probar, y es UNA cosa
 * **⭐ B-1 — que el `rebasada` se vea.** Un bounty por debajo —o igual— de la tarifa vigente deja de
 * pagarse y **desaparece de todas las superficies**: la vitrina lo filtra por contrato, las dos
 * secciones que la pintan desaparecen enteras y solo queda el badge de la casilla del binder. Esta
 * pantalla es **la única** desde la que ese bounty se puede ver sin sospecharlo antes. El resto de
 * los casos de aquí son secundarios a ése.
 *
 * ### Por qué contra Postgres real y por HTTP
 * Tres de las cosas que se comprueban **no existen en un doble**: el predicado de ALCANCE y los
 * filtros de identidad son **SQL** (un `where` mal compuesto solo falla contra el motor), el
 * `403`/`401` son **guards del pipeline real**, y **B-2** exige que la MISMA fila salga `rebasada`
 * aquí y **ausente** de `GET /buylist/bounties` — *no se puede tapar cambiando un solo lado*.
 *
 * ⛔ **Lo que NO se re-asierta aquí** (§M2-B.6): `BOUNTY_TARGET_REQUIRED`, el default 2,
 * `BOUNTY_PRICE_REQUIRED` y el `raw`-only están cerrados en `test/pricing.variant-controls.spec.ts`
 * y esta pantalla **reusa** ese endpoint. *Dos candados sobre la misma regla se tapan entre sí.*
 */

const SET_ID = 'e2e-bounty-console-set';
const CARD_PREFIX = 'e2e-bc-';

/** Mercado base de los fixtures. Lo que la curva paga por él se calcula con el CUERPO REAL. */
const MARKET_BASE = 10000;

describe('E2E — consola de bounties (`GET /admin/pricing/bounties`) contra backend vivo', () => {
  let h: E2EHarness;
  let adminToken: string;
  let operatorToken: string;
  let curve: PricingCurve;

  /** Lo que la CURVA VIGENTE (la del entorno, no una copia) paga por un mercado dado. */
  const curveBuy = (marketCents: number) => resolveBuyFromCurve(marketCents, curve).cents as number;

  const cardId = (slug: string) => `${CARD_PREFIX}${slug}`;

  async function makeCard(slug: string, number: string, name: string) {
    await h.prisma.card.create({
      data: {
        id: cardId(slug),
        externalId: cardId(slug),
        setId: SET_ID,
        name,
        number,
        rarity: 'Rare Holo',
        availableFinishes: ['normal'],
      },
    });
  }

  /** Fija el MERCADO de la variante `raw:NM/normal` (una fila de referencia manual, en MXN). */
  async function setMarket(slug: string, priceMxnCents: number) {
    await h.prisma.priceReference.deleteMany({ where: { cardId: cardId(slug) } });
    await h.prisma.priceReference.create({
      data: {
        cardId: cardId(slug),
        productType: 'raw',
        gradeKey: 'raw:NM',
        finish: 'normal',
        source: 'manual',
        priceMxnCents,
        capturedDate: new Date('2026-09-07T00:00:00.000Z'),
        isManualOverride: true,
        refKind: 'market',
      },
    });
  }

  /** La MISMA escritura que usa la consola: `PUT …/variant-controls/:cardId/:finish` (§M2-B.2). */
  function putControls(slug: string, body: Record<string, unknown>, token = adminToken) {
    return h.api('PUT', `/admin/pricing/variant-controls/${cardId(slug)}/normal`, {
      token,
      json: { productType: 'raw', gradeKey: 'raw:NM', ...body },
    });
  }

  /** La consola, con los filtros de identidad puestos en MI set (aísla del resto del catálogo). */
  async function consola(query = '') {
    const sep = query.startsWith('&') || query === '' ? '' : '&';
    const res = await h.api(
      'GET',
      `/admin/pricing/bounties?setId=${SET_ID}${sep}${query.replace(/^&/, '&')}`,
      { token: adminToken },
    );
    expect(res.status).toBe(200);
    return res.body as {
      data: any[];
      page: number;
      pageSize: number;
      total: number;
      counts: Record<string, number>;
      truncated: boolean;
    };
  }

  const filaDe = (body: { data: any[] }, slug: string) => body.data.find((d) => d.cardId === cardId(slug));

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedE2E(h.prisma);
    adminToken = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    operatorToken = await h.login(E2E_USERS.operator.email, E2E_USERS.operator.password);
    curve = (await h.api<PricingCurve>('GET', '/admin/pricing/curve', { token: adminToken })).body;
    expect(curve?.buy?.points?.length).toBeGreaterThan(0);

    await h.prisma.cardSet.create({
      data: { id: SET_ID, externalId: SET_ID, name: 'E2E Bounty Console' },
    });
    // Las cinco suertes de §M2-B.0 + una fila que NO es bounty (predicado de alcance).
    await makeCard('activa', '1', 'BC Activa');
    await makeCard('rebasada', '2', 'BC Rebasada');
    await makeCard('tie', '3', 'BC Empate');
    await makeCard('invalida', '4', 'BC Invalida');
    await makeCard('completada', '5', 'BC Completada');
    await makeCard('apagada', '6', 'BC Apagada');
    await makeCard('solo-override', '7', 'BC Solo Override');
    for (const slug of ['activa', 'rebasada', 'tie', 'invalida', 'completada', 'apagada', 'solo-override']) {
      await setMarket(slug, MARKET_BASE);
    }
  });

  afterAll(async () => {
    // Limpieza total: la suite comparte base y una fila de bounty viva contaminaría la vitrina
    // pública de cualquier spec posterior.
    await h?.prisma.variantPriceOverride.deleteMany({ where: { card: { setId: SET_ID } } });
    await h?.prisma.priceReference.deleteMany({ where: { card: { setId: SET_ID } } });
    await h?.prisma.card.deleteMany({ where: { setId: SET_ID } });
    await h?.prisma.cardSet.deleteMany({ where: { id: SET_ID } });
    await h?.close();
  });

  describe('⭐ B-1 — el bounty REBASADO se ve, y se ve PRIMERO (criterio 184(a))', () => {
    it('un bounty válido nace `activa`, sale en la vitrina pública y la consola lo cuenta', async () => {
      // Mercado $100 ⇒ la curva paga $40; el bounty pide $50 ⇒ es EFECTIVO.
      const price = curveBuy(MARKET_BASE) + 1000;
      const put = await putControls('activa', { bounty: { enabled: true, priceCents: price, targetQty: 2 } });
      expect(put.status).toBe(200);

      const body = await consola();
      const fila = filaDe(body, 'activa');
      expect(fila).toMatchObject({
        state: 'activa',
        setId: SET_ID,
        setName: 'E2E Bounty Console',
        productType: 'raw',
        gradeKey: 'raw:NM',
        finish: 'normal',
        progress: { targetQty: 2, acquiredQty: 0, remainingQty: 2 },
      });
      expect(fila.pricing.bounty).toMatchObject({ priceCents: price, effective: true });
      expect(fila.updatedBy).toBeTruthy();

      // Vive en la vitrina pública mientras es efectivo (la otra mitad del par de B-2).
      const vitrina = await h.api('GET', '/buylist/bounties');
      expect(vitrina.status).toBe(200);
      expect((vitrina.body as any).data.some((d: any) => d.cardId === cardId('activa'))).toBe(true);
    });

    it('⭐ sube el MERCADO hasta rebasarlo: desaparece de la vitrina y APARECE aquí como `rebasada`', async () => {
      const price = curveBuy(MARKET_BASE) + 1000;
      const put = await putControls('rebasada', { bounty: { enabled: true, priceCents: price, targetQty: 3 } });
      expect(put.status).toBe(200);
      expect((await consola()).data.find((d) => d.cardId === cardId('rebasada')).state).toBe('activa');

      // El barrido mueve el mercado: ahora la curva paga MÁS que el bounty. Nadie apagó nada.
      await setMarket('rebasada', MARKET_BASE * 4);

      const vitrina = await h.api('GET', '/buylist/bounties');
      expect((vitrina.body as any).data.some((d: any) => d.cardId === cardId('rebasada'))).toBe(false);

      const body = await consola();
      const fila = filaDe(body, 'rebasada');
      // La fila NO se cae de `data` por ser «no efectiva»: es justo la que hay que ver.
      expect(fila.state).toBe('rebasada');
      expect(fila.pricing.bounty.effective).toBe(false);
      // Y trae AL LADO la tarifa vigente contra la que se compara (las dos puertas: subir o apagar).
      expect(fila.pricing.bounty.curveQuoteCents).toBe(curveBuy(MARKET_BASE * 4));
      expect(fila.pricing.bounty.curveQuoteCents).toBeGreaterThan(fila.pricing.bounty.priceCents);
      // `attention_first` (default) la pone POR DELANTE de la activa.
      expect(body.data[0].cardId).toBe(cardId('rebasada'));
      // El bounty rebasado NO se auto-apaga: sigue encendido, y la decisión es del dueño.
      expect(fila.pricing.bounty.enabled).toBe(true);
    });

    it('⭐ B-2 — el EMPATE (bounty == tarifa vigente) sale `rebasada` aquí y AUSENTE de la vitrina', async () => {
      // Se escribe por encima de la curva (el alta rechaza el empate) y luego el mercado sube hasta
      // igualarlo EXACTAMENTE. Un `>=` en vez de `>` en cualquiera de las dos superficies rompe una
      // de las dos mitades de este test.
      const mercadoFinal = MARKET_BASE * 3;
      const price = curveBuy(mercadoFinal);
      expect(price).toBeGreaterThan(curveBuy(MARKET_BASE)); // el alta lo acepta con el mercado bajo
      const put = await putControls('tie', { bounty: { enabled: true, priceCents: price, targetQty: 2 } });
      expect(put.status).toBe(200);

      await setMarket('tie', mercadoFinal);

      const fila = filaDe(await consola(), 'tie');
      expect(fila.pricing.bounty.curveQuoteCents).toBe(fila.pricing.bounty.priceCents); // empate exacto
      expect(fila.state).toBe('rebasada');
      const vitrina = await h.api('GET', '/buylist/bounties');
      expect((vitrina.body as any).data.some((d: any) => d.cardId === cardId('tie'))).toBe(false);
    });
  });

  describe('§M2-B.0 — las cuatro suertes están representadas y ninguna se colapsa (criterio 184(c))', () => {
    it('B-8 — `completada` (se auto-apagó al lograrlo) ≠ `apagada` (la apagó una persona)', async () => {
      // `apagada`: el camino REAL de la pantalla — se enciende y se apaga desde la misma escritura.
      const price = curveBuy(MARKET_BASE) + 1000;
      expect((await putControls('apagada', { bounty: { enabled: true, priceCents: price, targetQty: 2 } })).status).toBe(200);
      expect((await putControls('apagada', { bounty: { enabled: false } })).status).toBe(200);

      // `completada`: el estado que deja el auto-apagado del SPEI (transacción de pago, §4.26e).
      expect((await putControls('completada', { bounty: { enabled: true, priceCents: price, targetQty: 2 } })).status).toBe(200);
      await h.prisma.variantPriceOverride.updateMany({
        where: { cardId: cardId('completada') },
        data: { bountyEnabled: false, bountyAcquiredQty: 2, bountyCompletedAt: new Date() },
      });

      const body = await consola();
      expect(filaDe(body, 'apagada').state).toBe('apagada');
      expect(filaDe(body, 'completada').state).toBe('completada');
      // Fundirlas borraría el PORQUÉ dejó de pagarse, que es el dato que la pantalla no puede perder.
      expect(body.counts.apagada).toBe(1);
      expect(body.counts.completada).toBe(1);
    });

    it('`invalida` (encendida SIN precio utilizable) se VE, y no se cuela dentro de `activa`', async () => {
      // No es alcanzable por la API (`BOUNTY_PRICE_REQUIRED` lo impide) y SÍ es representable en la
      // BD —restore, fixture, bug—: por eso el estado existe y por eso el fixture se escribe directo.
      await h.prisma.variantPriceOverride.create({
        data: {
          cardId: cardId('invalida'),
          productType: 'raw',
          gradeKey: 'raw:NM',
          finish: 'normal',
          bountyEnabled: true,
          bountyPriceCents: null,
          bountyTargetQty: 2,
        },
      });
      const body = await consola();
      expect(filaDe(body, 'invalida').state).toBe('invalida');
      expect(body.counts.invalida).toBe(1);
    });

    it('predicado de ALCANCE: una fila con SOLO overrides de precio NO es un bounty y no aparece', async () => {
      expect((await putControls('solo-override', { sellOverrideCents: 12345 })).status).toBe(200);
      const body = await consola();
      expect(filaDe(body, 'solo-override')).toBeUndefined();
      // …pero la fila existe (el `where` la excluyó, no es que la escritura fallara).
      const row = await h.prisma.variantPriceOverride.findFirst({ where: { cardId: cardId('solo-override') } });
      expect(row?.sellOverrideCents).toBe(12345);
    });
  });

  describe('§M2-B.1 — `counts`, `total` y los filtros contra SQL real (criterio 184(b))', () => {
    it('INVARIANTE: sin filtro `state`, `total` == la suma de las CINCO claves', async () => {
      const body = await consola();
      const { activa, rebasada, invalida, completada, apagada } = body.counts;
      expect(Object.keys(body.counts).sort()).toEqual(['activa', 'apagada', 'completada', 'invalida', 'rebasada']);
      expect(activa + rebasada + invalida + completada + apagada).toBe(body.total);
      expect(body.total).toBe(6); // las seis filas con historia de bounty del set
      expect(body.truncated).toBe(false);
    });

    it('B-10 — con `?state=rebasada` el `data` trae solo rebasadas y `counts` SIGUE viendo el resto', async () => {
      const body = await consola('&state=rebasada');
      expect(body.data.every((d) => d.state === 'rebasada')).toBe(true);
      expect(body.total).toBe(body.data.length); // `total` SÍ obedece a todos los filtros
      expect(body.counts.rebasada).toBeGreaterThanOrEqual(2);
      // Si los conteos obedecieran al `state`, el usuario perdería el mapa justo al usarlo.
      expect(body.counts.activa).toBeGreaterThan(0);
      expect(body.counts.apagada).toBeGreaterThan(0);
    });

    it('B-9 — con la paginación puesta, la cifra de rebasados NO cambia (criterio 184(b))', async () => {
      const completa = await consola();
      const p1 = await consola('&pageSize=1&page=1&sort=updated_desc');
      const p3 = await consola('&pageSize=1&page=3&sort=updated_desc');
      expect(p1.data).toHaveLength(1);
      expect(p1.counts).toEqual(completa.counts);
      expect(p3.counts).toEqual(completa.counts);
      expect(p1.total).toBe(completa.total);
    });

    it('`state` es repetible y los filtros de identidad (`q`, `finish`, `setId`) filtran de verdad', async () => {
      const dos = await consola('&state=rebasada&state=apagada');
      expect(new Set(dos.data.map((d) => d.state))).toEqual(new Set(['rebasada', 'apagada']));

      const porNombre = await consola('&q=BC Activa');
      expect(porNombre.data.map((d) => d.cardId)).toEqual([cardId('activa')]);
      // `q` busca por nombre O número de la carta.
      expect((await consola('&q=2')).data.map((d) => d.cardId)).toEqual([cardId('rebasada')]);
      // Un acabado sin filas deja la lista vacía (y el `q` no se pisa con el alcance).
      expect((await consola('&finish=holofoil')).total).toBe(0);
      // Y otro set no ve nada de éste.
      const otroSet = await h.api('GET', '/admin/pricing/bounties?setId=no-existe', { token: adminToken });
      expect(otroSet.body.total).toBe(0);
      expect(otroSet.body.counts).toEqual({ activa: 0, rebasada: 0, invalida: 0, completada: 0, apagada: 0 });
    });
  });

  describe('§M2-B.1/§M2-B.3 — SEC-A1: rol, entrada válida y el número que NO decide', () => {
    it('B-6 — `vault_operator` recibe `403`; sin token, `401`', async () => {
      const operador = await h.api('GET', '/admin/pricing/bounties', { token: operatorToken });
      expect(operador.status).toBe(403);
      const anonimo = await h.api('GET', '/admin/pricing/bounties');
      expect(anonimo.status).toBe(401);
    });

    it('`state`/`sort`/`finish`/`pageSize` fuera de rango ⇒ `400 VALIDATION_ERROR` (nunca un clamp mudo)', async () => {
      for (const q of ['state=outbid', 'sort=cheapest', 'finish=galaxy', 'pageSize=500', 'page=0']) {
        const res = await h.api('GET', `/admin/pricing/bounties?${q}`, { token: adminToken });
        expect([q, res.status]).toEqual([q, 400]);
        expect(res.body.error?.code ?? res.body.code).toBe('VALIDATION_ERROR');
      }
    });

    it('B-5 — un `curveQuoteCents` en el BODY del `PUT` no compra nada: sigue el `422 BOUNTY_BELOW_RULE`', async () => {
      // La cifra que la pantalla enseñó NO participa en la decisión: el servidor re-deriva curva y
      // mercado en el instante del write (§M2-B.3). `curveQuoteCents`/`effective`/`state` son SALIDA.
      const bajoLaCurva = curveBuy(MARKET_BASE) - 1;
      const res = await putControls('activa', {
        bounty: { enabled: true, priceCents: bajoLaCurva, targetQty: 2 },
        curveQuoteCents: 1,
        effective: true,
        state: 'activa',
      });
      expect(res.status).toBe(422);
      expect(res.body.error?.code ?? res.body.code).toBe('BOUNTY_BELOW_RULE');
    });

    it('la escritura de la fila se hace con el endpoint REUSADO, y la consola la refleja al momento', async () => {
      // Criterio 184(e): editar precio/objetivo/encendido desde la fila FUNCIONA — y es el mismo
      // `PUT` de siempre, sin `force` ni «guardar de todas formas».
      const nuevo = curveBuy(MARKET_BASE * 4) + 500;
      const res = await putControls('rebasada', { bounty: { enabled: true, priceCents: nuevo, targetQty: 5 } });
      expect(res.status).toBe(200);
      const fila = filaDe(await consola(), 'rebasada');
      expect(fila.state).toBe('activa'); // subir el precio por encima de la curva lo revive
      expect(fila.progress).toEqual({ targetQty: 5, acquiredQty: 0, remainingQty: 5 });
    });
  });

  describe('§M2-B.7 — lo que la respuesta NO trae (y no se aproxima)', () => {
    it('⛔ ninguna fila trae `outbidSince` ni ninguna antigüedad del rebase', async () => {
      // No existe la columna y NO es derivable: `updatedAt` dice cuándo tocó alguien la fila, no
      // cuándo el mercado la rebasó. Una antigüedad falsa junto a una decisión de dinero es peor
      // que ninguna. Si el dueño la quiere, es otro pase (DDL + observador) y pasa por el arquitecto.
      const body = await consola();
      for (const fila of body.data) {
        expect(fila).not.toHaveProperty('outbidSince');
        expect(JSON.stringify(fila)).not.toContain('outbidSince');
      }
      // Tampoco la posición de inventario: `acquiredQty` es «cuánto llevo de esta cacería».
      expect(body.data.every((d) => !('positionQty' in d) && !('positionUnavailable' in d))).toBe(true);
    });

    it('la curva del entorno es la que se usó en todo el spec (si no, los empates de arriba no medían nada)', () => {
      expect(curveBuy(MARKET_BASE)).toBe(resolveBuyFromCurve(MARKET_BASE, DEFAULT_PRICING_CURVE).cents);
    });
  });
});
