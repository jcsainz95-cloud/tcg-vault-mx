import { AdminBountiesService } from '../src/modules/pricing/admin-bounties.service';
import { MasterSetService } from '../src/modules/inventory/master-set.service';
import { VariantControlsService } from '../src/modules/pricing/variant-controls.service';
import { PricingService, PriceInfo } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { FxService } from '../src/modules/pricing/fx.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { DEFAULT_PRICING_CURVE, resolveBuyFromCurve } from '../src/common/pricing-curve';
import { variantKey } from '../src/common/variant-key';
import type { VariantPricingDTO } from '../src/modules/pricing/variant-pricing';

/**
 * `pricing.variant-market.spec.ts` — ⭐ **CANDADO B-14** (`API_CONTRACT §M2-B.6`, v1.62.2):
 * **el valor de mercado que se pinta es el de ESA variante, sale del MISMO composer que la curva, y
 * donde no hay referencia sale `pending` — jamás un `0`, jamás el precio de otro acabado.**
 *
 * Norma: `API_CONTRACT §DTOs base`, bloque `<!-- CANON: mercado-de-la-variante -->` (**fuente única**;
 * aquí se **cita y no se transcribe** — §0-B.3 regla 8). Diseño: `ARCHITECTURE §4.42j`.
 *
 * ### Por qué el candado mide LA COSA y no el nombre del campo
 * Un test que solo mirase `market.referenceMxnCents` se tapa cambiando un solo lado: bastaría emitir
 * el número por una vía propia para que (a) y (b) pasaran mientras la curva cotiza otra cosa. Por eso
 * la parte **(c)** ata el `market` emitido al `suggestedCents`/`curveQuoteCents` que **el mismo
 * composer** produjo: *emitir un mercado que la curva no vio rompe (c) aunque (a) y (b) pasen*.
 *
 * ### UN fixture, UNA carta, y las tres seams que lo leen
 * - `normal` — referencia de **MX$1,000** ⇒ (a) `priced`.
 * - `reverse_holo` — **ninguna** fila de referencia ⇒ (b) `pending` + los cuatro campos nulos.
 * - `holofoil` — fila **degenerada** `priceMxnCents = 0` (representable, y `getReferencesBatch` la
 *   devuelve como `priced: 0`) ⇒ (e) `pending`, **no** `priced: 0`.
 * Los tres acabados con **bounty en alcance**, y el mismo fixture leído por la **consola**
 * (`GET /admin/pricing/bounties`), por el **binder** (`GET /admin/master-set/:setId`, scope
 * `platform`) y por la respuesta del **`PUT …/variant-controls/…`** ⇒ (d) mismo `market`.
 *
 * ⛔ **Lo que NO se re-asierta aquí:** la clasificación `state`, `counts`, orden y techo
 * (`admin-bounties.list.spec.ts`), ni las validaciones del `PUT` (`pricing.variant-controls.spec.ts`).
 * Dos candados sobre la misma regla se tapan entre sí.
 */

const SET = { id: 'b14-set', name: 'B14 Set' };
const CARD_ID = 'b14-card';
const FINISHES = ['normal', 'reverse_holo', 'holofoil'] as const;
type B14Finish = (typeof FINISHES)[number];

/** MX$1,000 — la referencia de `normal`, y el número que NINGÚN otro acabado puede enseñar. */
const REF_NORMAL_CENTS = 1000_00;
/** La fecha de captura de esa fila: se COPIA, no se sella con hoy (B-15). */
const REF_NORMAL_DATE = '2026-07-30';

/**
 * **La única fuente de mercado del fixture**: lo que `getReference`/`getReferencesBatch` devuelven
 * para cada acabado. `undefined` = **no hay entrada en el `Map`** (ninguna fila de referencia).
 *
 * ⚠️ El `priced: 0` del holofoil **no es un doble caprichoso**: es literalmente lo que el cuerpo real
 * de `getReferencesBatch` produce ante una fila con `priceMxnCents = 0` — y esto se comprueba abajo,
 * contra el cuerpo real, para que (e) no dependa de una suposición del test.
 */
const MARKET_BY_FINISH: Record<B14Finish, PriceInfo | undefined> = {
  normal: {
    status: 'priced',
    referenceMxnCents: REF_NORMAL_CENTS,
    source: 'tcgcsv_singles',
    capturedDate: REF_NORMAL_DATE,
  },
  reverse_holo: undefined,
  holofoil: {
    status: 'priced',
    referenceMxnCents: 0,
    source: 'tcgcsv_singles',
    capturedDate: '2026-09-07',
  },
};

/** Lo que la CURVA REAL paga por MX$1,000 (no se reimplementa la matemática en el test). */
const CURVE_BUY_AT_REF = resolveBuyFromCurve(REF_NORMAL_CENTS, DEFAULT_PRICING_CURVE).cents as number;

/** El `market` que el contrato exige por acabado. Se escribe UNA vez y lo comparan las tres seams. */
const EXPECTED_MARKET: Record<B14Finish, VariantPricingDTO['market']> = {
  // (a)
  normal: {
    status: 'priced',
    referenceMxnCents: REF_NORMAL_CENTS,
    capturedDate: REF_NORMAL_DATE,
    source: 'tcgcsv_singles',
  },
  // (b) — los CUATRO a la vez, y ni rastro del MX$1,000 del otro acabado.
  reverse_holo: { status: 'pending', referenceMxnCents: null, capturedDate: null, source: null },
  // (e) — la fila degenerada NO se emite «fiel al dato».
  holofoil: { status: 'pending', referenceMxnCents: null, capturedDate: null, source: null },
};

/** Fila M-30 (bounty en alcance) de un acabado. */
function overrideRow(finish: B14Finish) {
  return {
    id: `vpo-${finish}`,
    cardId: CARD_ID,
    productType: 'raw' as const,
    gradeKey: 'raw:NM',
    finish,
    sellOverrideCents: null,
    buyOverrideCents: null,
    bountyEnabled: true,
    // Por encima de la curva del acabado con mercado ⇒ ninguna fila nace `rebasada` por accidente.
    bountyPriceCents: CURVE_BUY_AT_REF + 1000,
    bountyTargetQty: 2,
    bountyAcquiredQty: 0,
    bountyCompletedAt: null,
    updatedBy: 'admin-1',
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
  };
}

const CARD = {
  id: CARD_ID,
  setId: SET.id,
  name: 'B14 Carta',
  number: '1',
  numberSort: 1,
  numberPrefix: '',
  rarity: 'Rare Holo',
  rarityCanonical: 'rara',
  imageSmallUrl: null,
  availableFinishes: [...FINISHES],
};

/** El `Map` que devuelve `getReferencesBatch` para el fixture (sin entrada ⇒ sin fila). */
function refsMap(): Map<string, PriceInfo> {
  const m = new Map<string, PriceInfo>();
  for (const finish of FINISHES) {
    const info = MARKET_BY_FINISH[finish];
    if (info) m.set(variantKey({ cardId: CARD_ID, productType: 'raw', gradeKey: 'raw:NM', finish }), info);
  }
  return m;
}

// ---------------------------------------------------------------------------
// Seam 1 — la CONSOLA de bounties (`GET /admin/pricing/bounties`, §M2-B.1)
// ---------------------------------------------------------------------------

async function consolaRows() {
  const rows = FINISHES.map((finish) => ({ ...overrideRow(finish), card: { ...CARD, set: SET } }));
  const prisma = {
    variantPriceOverride: { findMany: jest.fn(async () => rows) },
  } as unknown as PrismaService;
  const pricing = {
    loadPricingCurve: jest.fn(async () => DEFAULT_PRICING_CURVE),
    getReferencesBatch: jest.fn(async () => refsMap()),
  } as unknown as PricingService;
  const res = await new AdminBountiesService(prisma, pricing).list({
    page: 1,
    pageSize: 20,
    sort: 'attention_first',
  });
  // Se compara sobre el JSON REAL: una clave `undefined` desaparece en el cable, y «omitir el bloque
  // `market`» es una de las tres cosas que B-14(b) declara ROJAS.
  return new Map(
    (JSON.parse(JSON.stringify(res.data)) as any[]).map((d) => [d.finish as B14Finish, d]),
  );
}

// ---------------------------------------------------------------------------
// Seam 2 — el BINDER (`GET /admin/master-set/:setId`, scope `platform`)
// ---------------------------------------------------------------------------

async function binderVariants() {
  const prisma = {
    cardSet: { findMany: jest.fn(), findUnique: jest.fn(async () => ({ id: SET.id, name: SET.name })) },
    card: { groupBy: jest.fn(), findMany: jest.fn(async () => [CARD]) },
    inventoryItem: { groupBy: jest.fn(async () => []), findMany: jest.fn(async () => []) },
    user: { findUnique: jest.fn() },
    $queryRaw: jest.fn(async () => []),
  } as unknown as PrismaService;
  const overridesByKey = new Map(
    FINISHES.map((finish) => [`${CARD_ID}|raw|raw:NM|${finish}`, overrideRow(finish)]),
  );
  const pricing = {
    loadPricingCurve: jest.fn(async () => DEFAULT_PRICING_CURVE),
    decideSalePrice: jest.fn(PricingService.prototype.decideSalePrice),
    getReferencesBatch: jest.fn(async () => refsMap()),
    getSeparateProductsByCard: jest.fn(async () => new Map()),
    getPricedRawFinishesBatch: jest.fn(async () => new Map()),
    gradeKeyFor: jest.fn(() => 'raw:NM'),
    tryGradeKeyFor: jest.fn(() => 'raw:NM'),
    getVariantOverridesBatch: jest.fn(async () => overridesByKey),
    getVariantOverride: jest.fn(async () => null),
  } as unknown as PricingService;
  const res = await new MasterSetService(prisma, pricing).binder(SET.id);
  const cell = JSON.parse(JSON.stringify(res.cells.find((c) => c.cardId === CARD_ID)));
  return new Map<B14Finish, any>(cell.variants.map((v: any) => [v.finish as B14Finish, v]));
}

// ---------------------------------------------------------------------------
// Seam 3 — la respuesta del `PUT …/variant-controls/:cardId/:finish` (§M2-B.2)
// ---------------------------------------------------------------------------

async function putControls(finish: B14Finish) {
  const existing = overrideRow(finish);
  const prisma = {
    card: { findUnique: jest.fn(async () => CARD) },
    variantPriceOverride: {
      findUnique: jest.fn(async () => existing),
      upsert: jest.fn(async () => existing),
      delete: jest.fn(async () => existing),
    },
  } as unknown as PrismaService;
  const pricing = {
    loadPricingCurve: jest.fn(async () => DEFAULT_PRICING_CURVE),
    // La MISMA fuente de mercado del fixture, por acabado: `getReference` es la versión single.
    getReference: jest.fn(async (_c: string, _p: string, _g: string, f: B14Finish) => {
      return MARKET_BY_FINISH[f] ?? { status: 'pending' as const };
    }),
  } as unknown as PricingService;
  const audit = { log: jest.fn(async () => undefined) } as unknown as AuditService;
  const svc = new VariantControlsService(prisma, pricing, audit);
  // Escritura que NO toca el bounty (omitido = no se toca): lo que se mira es el estado RESUELTO.
  const res = await svc.update(CARD_ID, finish, {}, 'admin-1');
  return JSON.parse(JSON.stringify(res)) as { pricing: VariantPricingDTO };
}

describe('⭐ B-14 — `pricing.market`: el mercado de ESA variante, del MISMO composer, nunca 0', () => {
  it('(a) el acabado CON referencia trae `priced` y el importe de SU fila, con su fecha y su fuente', async () => {
    const filas = await consolaRows();
    expect(filas.get('normal')!.pricing.market).toEqual(EXPECTED_MARKET.normal);
    expect(filas.get('normal')!.pricing.market.referenceMxnCents).toBe(1000_00);
  });

  it('(b) el acabado SIN NINGUNA fila trae `pending` y los cuatro campos nulos — ni el 1000_00 del otro acabado, ni un 0, ni el bloque omitido', async () => {
    const filas = await consolaRows();
    const reverse = filas.get('reverse_holo')!;
    // El bloque VIAJA (se mira sobre el JSON: `undefined` habría desaparecido en el cable).
    expect('market' in reverse.pricing).toBe(true);
    expect(reverse.pricing.market).toEqual(EXPECTED_MARKET.reverse_holo);
    // Las tres formas EXPLÍCITAS de estar en rojo, dichas una por una.
    expect(reverse.pricing.market.referenceMxnCents).not.toBe(REF_NORMAL_CENTS); // ⛔ el de OTRO acabado
    expect(reverse.pricing.market.referenceMxnCents).not.toBe(0); // ⛔ el 0 «fiel al dato»
    expect(reverse.pricing.market.status).toBe('pending');
    // Y la fecha del otro acabado tampoco se hereda (B-15 por el flanco de B-14).
    expect(reverse.pricing.market.capturedDate).toBeNull();
  });

  it('(c) ⭐ el AMARRE: sin mercado, `buy.suggestedCents`, `sell.suggestedCents` y `bounty.curveQuoteCents` son los TRES null; con mercado, los TRES no nulos', async () => {
    const filas = await consolaRows();

    const conMercado = filas.get('normal')!.pricing;
    expect(conMercado.buy.suggestedCents).not.toBeNull();
    expect(conMercado.sell.suggestedCents).not.toBeNull();
    expect(conMercado.bounty.curveQuoteCents).not.toBeNull();
    // La cifra no es «un no-nulo cualquiera»: es la que la curva REAL paga por ESE mercado.
    expect(conMercado.buy.suggestedCents).toBe(CURVE_BUY_AT_REF);
    expect(conMercado.bounty.curveQuoteCents).toBe(CURVE_BUY_AT_REF);

    for (const finish of ['reverse_holo', 'holofoil'] as const) {
      const p = filas.get(finish)!.pricing;
      expect(p.buy.suggestedCents).toBeNull();
      expect(p.sell.suggestedCents).toBeNull();
      expect(p.bounty.curveQuoteCents).toBeNull();
    }

    // La EQUIVALENCIA del contrato, enunciada sobre TODAS las filas de la respuesta: `market pending`
    // ⇔ los tres nulos. Un `market` resuelto por su cuenta rompe esto en cuanto las dos vías discrepen.
    for (const [, fila] of filas) {
      const pending = fila.pricing.market.status === 'pending';
      expect(fila.pricing.buy.suggestedCents === null).toBe(pending);
      expect(fila.pricing.sell.suggestedCents === null).toBe(pending);
      expect(fila.pricing.bounty.curveQuoteCents === null).toBe(pending);
    }
  });

  it('(d) el MISMO fixture leído por el BINDER y por el `PUT …/variant-controls/…` da EL MISMO `market`', async () => {
    const consola = await consolaRows();
    const binder = await binderVariants();

    for (const finish of FINISHES) {
      const esperado = EXPECTED_MARKET[finish];
      const put = await putControls(finish);
      expect(consola.get(finish)!.pricing.market).toEqual(esperado);
      expect(binder.get(finish)!.pricing.market).toEqual(esperado);
      expect(put.pricing.market).toEqual(esperado);
      // Y las tres seams entre sí, sin pasar por la constante (es el mismo composer o no lo es).
      expect(binder.get(finish)!.pricing.market).toEqual(consola.get(finish)!.pricing.market);
      expect(put.pricing.market).toEqual(consola.get(finish)!.pricing.market);
    }
  });

  it('(d-bis) en el binder, el campo PLANO de v1.27 y `pricing.market` son el MISMO número: redundancia, no divergencia', async () => {
    const binder = await binderVariants();
    for (const finish of FINISHES) {
      const v = binder.get(finish)!;
      expect(v.pricing.market.referenceMxnCents).toBe(v.marketReferenceMxnCents ?? null);
      expect(v.pricing.market.capturedDate).toBe(v.capturedDate ?? null);
    }
    // El acabado sin fila NO hereda el número del acabado base tampoco por la vía plana.
    expect(binder.get('reverse_holo')!.marketReferenceMxnCents).toBeNull();
  });

  it('(e) una `PriceReference` con `priceMxnCents = 0` sale `pending` + null, NUNCA `priced: 0`', async () => {
    const filas = await consolaRows();
    const holo = filas.get('holofoil')!;
    expect(holo.pricing.market).toEqual(EXPECTED_MARKET.holofoil);
    expect(holo.pricing.market.status).not.toBe('priced');
    expect(holo.pricing.market.referenceMxnCents).not.toBe(0);
    // Y la equivalencia sigue viva justo donde el `0` la habría roto (la curva ya dice `pending`).
    expect(holo.pricing.buy.suggestedCents).toBeNull();
  });

  it('(e-premisa) el cuerpo REAL de `getReferencesBatch` SÍ entrega `priced: 0` ante esa fila — por eso la regla es DEL EMISOR', async () => {
    // Sin esto, (e) probaría contra un doble inventado. Con esto queda claro que el `0` llega de
    // verdad hasta el composer y que quien tiene que negarse a emitirlo es el composer.
    const rows = [
      {
        cardId: CARD_ID,
        productType: 'raw',
        gradeKey: 'raw:NM',
        finish: 'holofoil',
        priceMxnCents: 0,
        priceUsdCents: null,
        isManualOverride: false,
        source: 'tcgcsv_singles',
        capturedDate: new Date('2026-09-07T00:00:00.000Z'),
        cardProductId: null,
        refKind: 'market',
      },
    ];
    const prisma = { priceReference: { findMany: jest.fn(async () => rows) } } as unknown as PrismaService;
    const svc = new PricingService(
      prisma,
      {} as SettingsService,
      {} as FxService,
      {} as never,
      {} as never,
      {} as never,
    );
    const map = await svc.getReferencesBatch([
      { cardId: CARD_ID, productType: 'raw', gradeKey: 'raw:NM', finish: 'holofoil' },
    ]);
    expect(map.get(`${CARD_ID}|raw|raw:NM|holofoil`)).toMatchObject({
      status: 'priced',
      referenceMxnCents: 0,
    });
  });
});
