import { PricingService } from '../src/modules/pricing/pricing.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { FxService } from '../src/modules/pricing/fx.service';
import { makeRefsRawQuery } from './helpers/refs-raw-emulate';

/**
 * P-53 ALTO-4 (§3/§4) — CANARIOS de la INVERSIÓN de precedencia en los DOS lectores de dinero que aún
 * cortaban la ventana por `capturedDate` CRUDO: `getReference` (F4, checkout single-item + buylist
 * single-line) y `getReferenceByCardProduct` (F5, buylist de producto separado).
 *
 * El arreglo DELEGA: `getReference` → `getReferencesBatch` (ventana `COALESCE(evidenceDate,capturedDate)`
 * vía `$queryRaw`) y `getReferenceByCardProduct` → `getReferencesByCardProductBatch` (lee SIN cota y
 * reduce con `isBetterRef`). Ambos eliminan el `take: SAME_DAY_REF_CANDIDATES(=32)`.
 *
 * ── Por qué el mock modela LOS DOS mundos (rojo-primero real) ──────────────────────────────────────
 * El `build` de abajo entrega a la vez:
 *   · `$queryRaw = makeRefsRawQuery(rows)` — la ventana REAL (`max_auto_date` por frescura efectiva) que
 *     usa la vía DELEGADA (getReferencesBatch);
 *   · `findMany` que modela la vía CAPADA vieja: la lectura con `take` ordena `capturedDate desc` y
 *     corta (la primaria congelada, `capturedDate` viejo, QUEDA FUERA del top-32 como en la BD real); la
 *     lectura DIRIGIDA de manuales (where con `isManualOverride`) trae solo las manuales; y la lectura
 *     SIN `take` y SIN predicado manual (la hermana de lote F6) trae TODAS las filas.
 * Así, si se revierte F4/F5 al patrón capado (conservando ESTE spec), la primaria cae fuera de la
 * ventana y gana el fallback peor ⇒ **rojo**. Con la delegación vigente ⇒ **verde**. El emulador de la
 * ventana es el MISMO que muerde el canario de `getReferencesBatch` (pricing.references-batch.spec.ts).
 */

// `OLD` es ANTERIOR a la 32ª fila más fresca del barrido (fallbackSweep abarca 2026-08-10…2026-09-18,
// así que su 32ª más reciente es ~2026-08-18): con `OLD = 2026-06-01` la primaria congelada cae FUERA del
// top-32 por `capturedDate` crudo. Es el escenario que hace MORDER al canario cuando F4/F5 no delegan (la
// vía capada vieja excluye a la primaria); con la delegación su `evidenceDate=HOY` la reintroduce.
const OLD = new Date('2026-06-01T00:00:00Z');
const TODAY = new Date('2026-09-18T00:00:00Z');

/** El fallback de MENOR precedencia (pokemontcg_io) que el barrido diario escribe con capturedDate=HOY. */
function freshFallback(over: Partial<any> = {}): any {
  return {
    cardId: 'c1',
    productType: 'raw',
    gradeKey: 'raw:NM',
    finish: 'normal',
    priceMxnCents: 50000,
    priceUsdCents: null,
    isManualOverride: false,
    source: 'pokemontcg_io',
    capturedDate: TODAY,
    evidenceDate: null,
    cardProductId: null,
    refKind: 'market',
    ...over,
  };
}

/**
 * La primaria BUENA: tcgcsv_singles (mayor precedencia), precio estable ⇒ el escritor write-on-change
 * CONGELA su `capturedDate` (viejo) y solo avanza `evidenceDate` a HOY.
 */
function frozenPrimary(over: Partial<any> = {}): any {
  return {
    cardId: 'c1',
    productType: 'raw',
    gradeKey: 'raw:NM',
    finish: 'normal',
    priceMxnCents: 100000,
    priceUsdCents: null,
    isManualOverride: false,
    source: 'tcgcsv_singles',
    capturedDate: OLD,
    evidenceDate: TODAY,
    cardProductId: null,
    refKind: 'market',
    ...over,
  };
}

/** ≥32 barridos automáticos del fallback, TODOS con capturedDate reciente (fresco) — para que el
 *  `take:32` viejo desalojara a la primaria congelada. El más reciente empata con HOY. */
function fallbackSweep(over: Partial<any> = {}): any[] {
  const rows: any[] = [];
  for (let d = 0; d < 40; d++) {
    const day = new Date('2026-08-10T00:00:00Z');
    day.setUTCDate(day.getUTCDate() + d); // 2026-08-10 … 2026-09-18 (== TODAY en d=39)
    rows.push(freshFallback({ capturedDate: day, priceMxnCents: 50000 + d, ...over }));
  }
  return rows;
}

/**
 * Mock que sirve a las CUATRO vías (F4 vieja/nueva, F5 vieja/nueva) con las MISMAS filas:
 *  - `$queryRaw`  → ventana real (delegación de F4).
 *  - `findMany` con `where.OR` de manual → lectura dirigida de manuales (F4/F5 viejas).
 *  - `findMany` con `take` → bloque reciente CAPADO por `capturedDate desc` (F4/F5 viejas).
 *  - `findMany` sin `take` ni predicado manual → hermana de lote F6 SIN cota (delegación de F5).
 */
function build(rows: any[]) {
  const findMany = jest.fn(async (args: any) => {
    const whereStr = JSON.stringify(args?.where ?? {});
    if (whereStr.includes('isManualOverride')) {
      return rows.filter((r) => r.isManualOverride || r.source === 'manual');
    }
    if (args?.take != null) {
      return [...rows]
        .sort((a, b) => b.capturedDate.getTime() - a.capturedDate.getTime())
        .slice(0, args.take);
    }
    return rows; // F6: lee sin cota (todas las filas de la clave).
  });
  const prisma = {
    priceReference: { findMany },
    $queryRaw: makeRefsRawQuery(rows),
  } as unknown as PrismaService;
  const fx = { getCurrent: jest.fn(async () => null) } as unknown as FxService;
  const svc = new PricingService(prisma, {} as SettingsService, fx, {} as any, {} as any, {} as any);
  return { svc, findMany };
}

// ===========================================================================================
// C1 — F4 `getReference` (checkout single-item + buylist single-line)
// ===========================================================================================
describe('PricingService.getReference — P-53 ALTO-4: la primaria congelada gana al fallback fresco (F4)', () => {
  it('C1 (muerde): primaria tcgcsv_singles capturedDate VIEJO + evidenceDate=HOY GANA al fallback pokemontcg_io capturedDate=HOY', async () => {
    // 1 primaria congelada + 40 barridos automáticos del fallback (todos con capturedDate reciente).
    // VÍA VIEJA (capada): el top-32 por capturedDate desc son fallbacks; la primaria (capturedDate OLD)
    //   queda FUERA ⇒ gana 50000+ ⇒ ROJO.
    // VÍA NUEVA (delegación → ventana COALESCE): la primaria cuenta como fresca (evidencia HOY) ⇒ entra
    //   y gana al fallback por precedencia de fuente a igual fecha efectiva ⇒ 100000.
    const rows = [frozenPrimary(), ...fallbackSweep()];
    const { svc } = build(rows);
    const info = await svc.getReference('c1', 'raw', 'raw:NM', 'normal');
    expect(info).toMatchObject({
      status: 'priced',
      referenceMxnCents: 100000,
      source: 'tcgcsv_singles',
    });
  });

  it('C1 · gemelo CA-10: con evidenceDate=null en TODAS (día del deploy) gana el fallback fresco — IDÉNTICO a hoy', async () => {
    // Misma forma pero SIN evidencia: COALESCE = capturedDate ⇒ la primaria conserva capturedDate viejo,
    // queda fuera de la ventana y gana el fallback fresco. El arreglo NO cambia este resultado (invariante
    // del deploy). El fallback más reciente del barrido (d=39, capturedDate=HOY) es 50039.
    const rows = [frozenPrimary({ evidenceDate: null }), ...fallbackSweep()];
    const { svc } = build(rows);
    const info = await svc.getReference('c1', 'raw', 'raw:NM', 'normal');
    expect(info).toMatchObject({ status: 'priced', source: 'pokemontcg_io' });
    expect(info.referenceMxnCents).toBe(50000 + 39);
    expect(info.referenceMxnCents).not.toBe(100000); // la primaria congelada NO gana sin evidencia.
  });
});

// ===========================================================================================
// C2 — F5 `getReferenceByCardProduct` (buylist de producto separado)
// ===========================================================================================
describe('PricingService.getReferenceByCardProduct — P-53 ALTO-4: la primaria congelada gana al fallback fresco (F5)', () => {
  const CP = 'cp-sep-1';

  it('C2 (muerde): primaria tcgcsv_singles capturedDate VIEJO + evidenceDate=HOY GANA al fallback pokemontcg_io capturedDate=HOY', async () => {
    // Mismas filas pero por `cardProductId`. VÍA VIEJA (capada): la primaria congelada cae fuera del
    // top-32 ⇒ gana el fallback ⇒ ROJO. VÍA NUEVA (delegación → F6 sin cota + isBetterRef): la primaria
    // cuenta como fresca por `evidenceDate ?? capturedDate` ⇒ gana por precedencia de fuente ⇒ 100000.
    const rows = [
      frozenPrimary({ cardProductId: CP }),
      ...fallbackSweep({ cardProductId: CP }),
    ];
    const { svc } = build(rows);
    const info = await svc.getReferenceByCardProduct(CP, 'raw', 'raw:NM', 'normal');
    expect(info).toMatchObject({
      status: 'priced',
      referenceMxnCents: 100000,
      source: 'tcgcsv_singles',
    });
  });

  it('C2 · gemelo CA-10: con evidenceDate=null en TODAS gana el fallback fresco — IDÉNTICO a hoy', async () => {
    const rows = [
      frozenPrimary({ cardProductId: CP, evidenceDate: null }),
      ...fallbackSweep({ cardProductId: CP }),
    ];
    const { svc } = build(rows);
    const info = await svc.getReferenceByCardProduct(CP, 'raw', 'raw:NM', 'normal');
    expect(info).toMatchObject({ status: 'priced', source: 'pokemontcg_io' });
    expect(info.referenceMxnCents).toBe(50000 + 39);
    expect(info.referenceMxnCents).not.toBe(100000);
  });
});

// ===========================================================================================
// Candados de no-regresión (§4): los lectores hoy correctos por leer SIN cota (F6, F7) NO deben
// reintroducir un corte por `capturedDate` crudo. Con 40 fallbacks frescos + 1 primaria congelada, un
// `take:32`-por-capturedDate futuro desalojaría a la primaria y volvería a invertir la precedencia.
// El F8 (ficha 360° admin) tiene su candado en admin.owned-item-refs.manual-override.spec.ts.
// ===========================================================================================
describe('P-53 ALTO-4 · candados de no-regresión — NO capar por capturedDate crudo (F6, F7)', () => {
  it('F6 getReferencesByCardProductBatch: la primaria congelada gana entre 40 fallbacks frescos', async () => {
    const CP = 'cp-lock-6';
    const rows = [
      frozenPrimary({ cardProductId: CP }),
      ...fallbackSweep({ cardProductId: CP }),
    ];
    const { svc } = build(rows);
    const map = await svc.getReferencesByCardProductBatch([
      { cardProductId: CP, productType: 'raw', gradeKey: 'raw:NM', finish: 'normal' },
    ]);
    const info = map.get(`${CP}|raw|raw:NM|normal`);
    expect(info).toMatchObject({ referenceMxnCents: 100000, source: 'tcgcsv_singles' });
  });

  it('F7 getSeparateProductsByCard: la primaria congelada del producto separado gana entre 40 fallbacks frescos', async () => {
    const CP = 'cp-lock-7';
    const refs = [
      frozenPrimary({ cardProductId: CP }),
      ...fallbackSweep({ cardProductId: CP }),
    ];
    // F7 lee cardProduct.findMany (los productos) + priceReference.findMany (las refs, SIN cota).
    const findManyRefs = jest.fn(async (args: any) => {
      if (args?.take != null) {
        return [...refs].sort((a, b) => b.capturedDate.getTime() - a.capturedDate.getTime()).slice(0, args.take);
      }
      return refs;
    });
    const prisma = {
      cardProduct: {
        findMany: jest.fn(async () => [
          { id: CP, cardId: 'c1', tcgplayerProductId: 777, kind: 'promo', name: 'Promo X', finishes: ['normal'] },
        ]),
      },
      priceReference: { findMany: findManyRefs },
    } as unknown as PrismaService;
    const fx = { getCurrent: jest.fn(async () => null) } as unknown as FxService;
    const svc = new PricingService(prisma, {} as SettingsService, fx, {} as any, {} as any, {} as any);
    const map = await svc.getSeparateProductsByCard(['c1']);
    const list = map.get('c1');
    expect(list).toHaveLength(1);
    expect(list![0].prices[0]).toMatchObject({ finish: 'normal', marketReferenceMxnCents: 100000 });
  });
});
