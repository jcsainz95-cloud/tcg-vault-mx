import { PricingService } from '../src/modules/pricing/pricing.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { FxService } from '../src/modules/pricing/fx.service';
import { PokemonTcgIoProvider } from '../src/modules/pricing/providers/pokemontcg-io.provider';
import {
  PokeTraceProvider,
  PokemonPriceTrackerProvider,
} from '../src/modules/pricing/providers/graded-sealed.providers';

/**
 * M-31 MAYOR-3 (money-safe) — desempate DETERMINISTA en `getReference`.
 *
 * Escenario del import forzado (`sync {setId, force:true}` en Pitch Black): el price-ingest diario
 * escribe una fila `cardProductId=null` y el resolver de singles escribe otra `cardProductId=<set_base>`
 * el MISMO día para la MISMA (carta, productType, gradeKey, acabado). Con `orderBy capturedDate desc` a
 * secas (findFirst) la referencia/valuación era NO determinista: podía ganar cualquiera de las dos.
 *
 * Estos tests fijan la regla: a igual día y fuente, la fila de la VARIANTE RESUELTA (`cardProductId` no
 * nulo) gana sobre la genérica `cardProductId=null` (NULLS LAST), y la elección es ESTABLE sin importar
 * el orden en que la BD devuelva las filas. Además, la fuente de mayor precedencia (override manual)
 * gana aunque su `cardProductId` sea nulo (la fuente domina sobre el desempate por cardProductId).
 */
function build(rows: any[]) {
  const findManyArgs: any[] = [];
  const prisma: any = {
    priceReference: {
      findMany: jest.fn(async (args: any) => {
        findManyArgs.push(args);
        return rows;
      }),
    },
  };
  const fx: any = { getCurrent: jest.fn(async () => null) }; // fx null ⇒ liveMxnCents = priceMxnCents.
  const svc = new PricingService(
    prisma as PrismaService,
    {} as SettingsService,
    fx as FxService,
    {} as PokemonTcgIoProvider,
    {} as PokemonPriceTrackerProvider,
    {} as PokeTraceProvider,
  );
  return { svc, findManyArgs };
}

const DAY = new Date('2026-08-22T00:00:00Z');

function row(over: Partial<any>): any {
  return {
    cardId: 'c1',
    productType: 'raw',
    gradeKey: 'raw:NM',
    finish: 'normal',
    priceMxnCents: 1000,
    priceUsdCents: null,
    isManualOverride: false,
    source: 'tcgcsv_singles',
    capturedDate: DAY,
    cardProductId: null,
    ...over,
  };
}

describe('PricingService.getReference — desempate determinista money-safe (M-31 MAYOR-3)', () => {
  it('a igual día y fuente, la variante resuelta (cardProductId no nulo) gana sobre la fila null', async () => {
    // Fila del resolver (tcgcsv_singles, cardProductId=set_base, 1500) vs fila del ingest genérico
    // (tcgcsv_singles, cardProductId=null, 1000). Devueltas con la null PRIMERO a propósito.
    const rows = [
      row({ cardProductId: null, priceMxnCents: 1000 }),
      row({ cardProductId: 'cp-set-base', priceMxnCents: 1500 }),
    ];
    const { svc } = build(rows);
    const info = await svc.getReference('c1', 'raw', 'raw:NM', 'normal');
    expect(info.status).toBe('priced');
    expect(info.referenceMxnCents).toBe(1500); // la de la variante resuelta, NO la genérica.
  });

  it('la elección es ESTABLE sin importar el orden de las filas devueltas por la BD', async () => {
    const a = row({ cardProductId: null, priceMxnCents: 1000 });
    const b = row({ cardProductId: 'cp-set-base', priceMxnCents: 1500 });
    const first = await build([a, b]).svc.getReference('c1', 'raw', 'raw:NM', 'normal');
    const second = await build([b, a]).svc.getReference('c1', 'raw', 'raw:NM', 'normal');
    expect(first.referenceMxnCents).toBe(second.referenceMxnCents);
    expect(first.referenceMxnCents).toBe(1500);
  });

  it('el override manual del mismo día gana aunque su cardProductId sea nulo (la fuente domina)', async () => {
    const rows = [
      row({ cardProductId: 'cp-set-base', source: 'tcgcsv_singles', priceMxnCents: 1500 }),
      row({ cardProductId: null, source: 'manual', isManualOverride: true, priceMxnCents: 9900 }),
    ];
    const { svc } = build(rows);
    const info = await svc.getReference('c1', 'raw', 'raw:NM', 'normal');
    expect(info.referenceMxnCents).toBe(9900); // override manual (rank 0) por encima del desempate.
    expect(info.source).toBe('manual');
  });

  it('la fecha más reciente domina sobre la precedencia de fuente/cardProductId', async () => {
    const older = new Date('2026-08-21T00:00:00Z');
    const rows = [
      row({ cardProductId: 'cp-set-base', capturedDate: older, priceMxnCents: 1500 }),
      row({ cardProductId: null, capturedDate: DAY, priceMxnCents: 1000 }),
    ];
    const { svc } = build(rows);
    const info = await svc.getReference('c1', 'raw', 'raw:NM', 'normal');
    expect(info.referenceMxnCents).toBe(1000); // la de HOY, aunque sea la genérica null.
  });

  it('la lectura es acotada y determinista: orderBy con NULLS LAST + take', async () => {
    const { svc, findManyArgs } = build([row({ cardProductId: 'cp', priceMxnCents: 1500 })]);
    await svc.getReference('c1', 'raw', 'raw:NM', 'normal');
    expect(findManyArgs).toHaveLength(1);
    expect(findManyArgs[0].orderBy).toEqual([
      { capturedDate: 'desc' },
      { cardProductId: { sort: 'asc', nulls: 'last' } },
    ]);
    expect(typeof findManyArgs[0].take).toBe('number');
    expect(findManyArgs[0].take).toBeGreaterThan(0);
  });

  it('sin filas ⇒ pending (invariante: nunca 0, nunca referencia inventada)', async () => {
    const { svc } = build([]);
    const info = await svc.getReference('c1', 'raw', 'raw:NM', 'normal');
    expect(info.status).toBe('pending');
    expect(info.referenceMxnCents).toBeUndefined();
  });
});
