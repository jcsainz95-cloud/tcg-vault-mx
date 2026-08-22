import { ConfigService } from '@nestjs/config';
import { SetValueService, SET_VALUE_RULE } from '../src/modules/catalog/set-value.service';
import { BASE_CARD_REF_WHERE } from '../src/modules/pricing/pricing.service';
import { SetPriceSyncJobService } from '../src/jobs/set-price-sync.service';
import { SetValueSnapshotJobService } from '../src/jobs/set-value-snapshot.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';

/**
 * v1.9-set-chart — Gráfica PÚBLICA del valor de un set (ARCHITECTURE §4.12; API_CONTRACT §2).
 * Cubre: computeSetValue (excluye sin-precio, cuenta priced/total, sin doble conteo, sin N+1),
 * resolveFeaturedSet (cascada env → snapshot → releaseDate → null), valueHistory (change y estados
 * vacíos), set-price-sync (NO filtra bóveda + escalate=false) y los endpoints con/sin snapshots.
 */

/**
 * P-32: construye una fila de PriceReference con los campos que `computeSetValue` selecciona y que
 * el desempate determinista `isBetterRef` necesita (capturedDate, source, cardProductId). Defaults
 * seguros para los tests que solo se fijan en el valor/dedupe por carta.
 */
function ref(partial: {
  cardId: string;
  priceMxnCents: number;
  capturedDate: Date;
  source?: string;
  cardProductId?: string | null;
  priceUsdCents?: number | null;
  isManualOverride?: boolean;
}) {
  return {
    priceUsdCents: null,
    isManualOverride: false,
    source: 'tcgcsv_singles',
    cardProductId: null,
    ...partial,
  };
}

function buildService(prisma: any, config: Partial<ConfigService> = {}) {
  const cfg = { get: jest.fn().mockReturnValue(undefined), ...config } as unknown as ConfigService;
  // v1.x-fx-live: SetValueService recalcula el MXN "hoy" con la FX vigente. Stub sin FX (fxSnapshotSafe
  // → null) ⇒ liveMxnCents devuelve el priceMxnCents almacenado (congelado), como en el modelo previo.
  const pricing = {
    fxSnapshotSafe: jest.fn().mockResolvedValue(null),
    liveMxnCents: (ref: { priceMxnCents: number }) => ref.priceMxnCents,
  } as unknown as PricingService;
  return new SetValueService(prisma as PrismaService, cfg, pricing);
}

describe('SetValueService.computeSetValue — SEC-A1, batch sin N+1', () => {
  it('SUMA la referencia más reciente por carta; excluye sin-precio y cuenta priced/total', async () => {
    const prisma: any = {
      card: {
        findMany: jest.fn().mockResolvedValue([{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }]),
      },
      priceReference: {
        // Orden capturedDate DESC (como pide el service). c1 tiene 2 filas → gana la MÁS RECIENTE por
        // el desempate determinista; c3 no tiene precio → se excluye del total pero cuenta en total.
        findMany: jest.fn().mockResolvedValue([
          ref({ cardId: 'c1', priceMxnCents: 5000, capturedDate: new Date('2026-08-15') }), // reciente
          ref({ cardId: 'c2', priceMxnCents: 3000, capturedDate: new Date('2026-08-15') }),
          ref({ cardId: 'c1', priceMxnCents: 4000, capturedDate: new Date('2026-08-10') }), // vieja → NO
        ]),
      },
    };
    const svc = buildService(prisma);
    const res = await svc.computeSetValue('set1');

    expect(res.totalValueMxnCents).toBe(8000); // 5000 (c1 reciente) + 3000 (c2); c3 sin precio
    expect(res.pricedCardCount).toBe(2);
    expect(res.totalCardCount).toBe(3);

    // Sin N+1: exactamente 2 queries (cartas del set + sus referencias en lote).
    expect(prisma.card.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.priceReference.findMany).toHaveBeenCalledTimes(1);
    // Filtro fijo de la regla de valor compartida (TD-1): raw / raw:NM / normal.
    const where = prisma.priceReference.findMany.mock.calls[0][0].where;
    expect(SET_VALUE_RULE).toEqual({ productType: 'raw', gradeKey: 'raw:NM', finish: 'normal' });
    expect(where).toMatchObject({
      productType: SET_VALUE_RULE.productType,
      gradeKey: SET_VALUE_RULE.gradeKey,
      finish: SET_VALUE_RULE.finish,
    });
    expect(where.cardId).toEqual({ in: ['c1', 'c2', 'c3'] });
    // P-32: EXCLUYE deck_exclusive/promo — el where lleva el filtro compartido BASE_CARD_REF_WHERE.
    expect(where.OR).toEqual(BASE_CARD_REF_WHERE.OR);
  });

  it('P-32: excluye deck_exclusive/promo y toma el precio del set_base (no el producto separado)', async () => {
    // c1 tiene, el MISMO día, la fila del set_base (tcgcsv_singles, cardProductId set) y la genérica
    // (pokemontcg.io, cardProductId=null). El desempate determinista (fuente) elige el set_base. La
    // fila de deck_exclusive/promo ya NO llega aquí (BASE_CARD_REF_WHERE la filtra en la query).
    const prisma: any = {
      card: { findMany: jest.fn().mockResolvedValue([{ id: 'c1' }]) },
      priceReference: {
        findMany: jest.fn().mockResolvedValue([
          ref({ cardId: 'c1', priceMxnCents: 5200, capturedDate: new Date('2026-08-15'), source: 'tcgcsv_singles', cardProductId: 'prod-base' }),
          ref({ cardId: 'c1', priceMxnCents: 4900, capturedDate: new Date('2026-08-15'), source: 'pokemontcg_io', cardProductId: null }),
        ]),
      },
    };
    const svc = buildService(prisma);
    const res = await svc.computeSetValue('set1');
    // Gana el set_base (tcgcsv_singles > pokemontcg.io por precedencia de fuente), NO 4900 ni una suma.
    expect(res.totalValueMxnCents).toBe(5200);
    expect(res.pricedCardCount).toBe(1);
  });

  it('set sin cartas → todo en cero, sin consultar referencias', async () => {
    const prisma: any = {
      card: { findMany: jest.fn().mockResolvedValue([]) },
      priceReference: { findMany: jest.fn() },
    };
    const svc = buildService(prisma);
    const res = await svc.computeSetValue('vacio');
    expect(res).toEqual({ totalValueMxnCents: 0, pricedCardCount: 0, totalCardCount: 0 });
    expect(prisma.priceReference.findMany).not.toHaveBeenCalled();
  });

  it('propaga la cota temporal capturedDate <= asOf cuando se pasa fecha', async () => {
    const prisma: any = {
      card: { findMany: jest.fn().mockResolvedValue([{ id: 'c1' }]) },
      priceReference: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const svc = buildService(prisma);
    const asOf = new Date('2026-08-16T00:00:00Z');
    await svc.computeSetValue('set1', asOf);
    const where = prisma.priceReference.findMany.mock.calls[0][0].where;
    expect(where.capturedDate).toEqual({ lte: asOf });
  });
});

describe('SetValueService.resolveFeaturedSet — cascada §4.12b', () => {
  it('1) env HOME_FEATURED_SET_ID → CardSet local por externalId', async () => {
    const set = { id: 'local-1', externalId: 'sv8', name: 'Surging Sparks' };
    const prisma: any = { cardSet: { findUnique: jest.fn().mockResolvedValue(set) } };
    const svc = buildService(prisma, { get: jest.fn().mockReturnValue('sv8') } as any);
    const res = await svc.resolveFeaturedSet();
    expect(res).toBe(set);
    expect(prisma.cardSet.findUnique).toHaveBeenCalledWith({ where: { externalId: 'sv8' } });
  });

  it('2) sin env resoluble → set con mayor totalValueMxnCents en su ÚLTIMO snapshot', async () => {
    const best = { id: 'setB', name: 'B' };
    const prisma: any = {
      cardSet: {
        findUnique: jest
          .fn()
          // primera llamada = externalId (no aplica, env vacío) — no se invoca; luego por id del mejor
          .mockResolvedValue(best),
      },
      setValueSnapshot: {
        // Orden setId asc, asOfDate desc: el service toma el primer (más reciente) por set.
        findMany: jest.fn().mockResolvedValue([
          { setId: 'setA', totalValueMxnCents: 1000 },
          { setId: 'setA', totalValueMxnCents: 999 },
          { setId: 'setB', totalValueMxnCents: 5000 }, // mayor → gana
          { setId: 'setB', totalValueMxnCents: 4000 },
        ]),
      },
    };
    const svc = buildService(prisma);
    const res = await svc.resolveFeaturedSet();
    expect(res).toBe(best);
    expect(prisma.cardSet.findUnique).toHaveBeenCalledWith({ where: { id: 'setB' } });
  });

  it('3) sin snapshots → CardSet más reciente por releaseDate', async () => {
    const recent = { id: 'recent', name: 'Recent', releaseDate: '2024/11/08' };
    const prisma: any = {
      cardSet: {
        findUnique: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(recent),
      },
      setValueSnapshot: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const svc = buildService(prisma);
    const res = await svc.resolveFeaturedSet();
    expect(res).toBe(recent);
    expect(prisma.cardSet.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { releaseDate: 'desc' } }),
    );
  });

  it('4) sin ningún CardSet → null', async () => {
    const prisma: any = {
      cardSet: { findUnique: jest.fn(), findFirst: jest.fn().mockResolvedValue(null) },
      setValueSnapshot: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const svc = buildService(prisma);
    expect(await svc.resolveFeaturedSet()).toBeNull();
  });

  it('env presente pero sin CardSet local → cae al fallback (no rompe)', async () => {
    const recent = { id: 'recent', releaseDate: '2024/01/01' };
    const prisma: any = {
      cardSet: {
        findUnique: jest.fn().mockResolvedValue(null), // externalId no existe local
        findFirst: jest.fn().mockResolvedValue(recent),
      },
      setValueSnapshot: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const svc = buildService(prisma, { get: jest.fn().mockReturnValue('sv-inexistente') } as any);
    const res = await svc.resolveFeaturedSet();
    expect(res).toBe(recent);
  });
});

describe('SetValueService.valueHistory — points + change', () => {
  function withSnapshots(snaps: any[]) {
    const prisma: any = { setValueSnapshot: { findMany: jest.fn().mockResolvedValue(snaps) } };
    return buildService(prisma);
  }

  it('sin snapshots → points [] y change flat con pct null', async () => {
    const svc = withSnapshots([]);
    const res = await svc.valueHistory('set1', '1m');
    expect(res.points).toEqual([]);
    expect(res.change).toEqual({ absMxnCents: 0, pct: null, direction: 'flat' });
  });

  it('serie ascendente → direction up, abs y pct correctos, con pricedCardCount por punto', async () => {
    const svc = withSnapshots([
      { asOfDate: new Date('2026-07-16'), totalValueMxnCents: 128450000, pricedCardCount: 182 },
      { asOfDate: new Date('2026-08-15'), totalValueMxnCents: 131920000, pricedCardCount: 184 },
    ]);
    const res = await svc.valueHistory('set1', '1m');
    expect(res.range).toBe('1m');
    expect(res.points).toEqual([
      { date: '2026-07-16', valueMxnCents: 128450000, pricedCardCount: 182 },
      { date: '2026-08-15', valueMxnCents: 131920000, pricedCardCount: 184 },
    ]);
    expect(res.change.absMxnCents).toBe(3470000);
    expect(res.change.pct).toBe(2.7); // round(3470000/128450000*100, 2)
    expect(res.change.direction).toBe('up');
  });

  it('P-32: base semilla (0 → 1 carta priceada) NO es base válida → sin cambio (flat/null), no un % absurdo', async () => {
    // Regresión P-32: antes esto daba direction 'up' comparando contra un snapshot semilla; el %
    // resultante era irreal. Ahora un snapshot con cobertura ínfima vs el último no es base válida.
    const svc = withSnapshots([
      { asOfDate: new Date('2026-08-01'), totalValueMxnCents: 0, pricedCardCount: 0 },
      { asOfDate: new Date('2026-08-15'), totalValueMxnCents: 10000, pricedCardCount: 1 },
    ]);
    const res = await svc.valueHistory('set1', 'bogus');
    expect(res.range).toBe('1m'); // rango inválido cae a 1m
    expect(res.change).toEqual({ absMxnCents: 0, pct: null, direction: 'flat' });
  });

  it('P-32: snapshot SEMILLA (1/180 priceadas, valor ínfimo) NO infla el %; base = punto comparable', async () => {
    // Reproduce el bug: día 1 con 1 carta priceada (MX$10) y luego el set completo. El % debe medirse
    // contra un punto con cobertura comparable (no el semilla), evitando el +157,463% reportado.
    const svc = withSnapshots([
      { asOfDate: new Date('2026-07-01'), totalValueMxnCents: 1000, pricedCardCount: 1 }, // semilla
      { asOfDate: new Date('2026-08-01'), totalValueMxnCents: 1500000, pricedCardCount: 180 },
      { asOfDate: new Date('2026-08-15'), totalValueMxnCents: 1575632, pricedCardCount: 182 },
    ]);
    const res = await svc.valueHistory('set1', 'all');
    // Base = 2026-08-01 (180 >= ceil(182/2)=91); NO el semilla del 2026-07-01 (1 < 91).
    expect(res.change.absMxnCents).toBe(75632); // 1575632 - 1500000
    expect(res.change.pct).toBe(5.04); // round(75632/1500000*100, 2)
    expect(res.change.direction).toBe('up');
    // NADA cerca del +157,463% del bug.
    expect(res.change.pct!).toBeLessThan(100);
  });
});

describe('SetValueService — endpoints públicos con/sin snapshots', () => {
  it('featuredSetHistory sin ningún CardSet → set null, points [], change flat', async () => {
    const prisma: any = {
      cardSet: { findUnique: jest.fn(), findFirst: jest.fn().mockResolvedValue(null) },
      setValueSnapshot: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const svc = buildService(prisma);
    const res = await svc.featuredSetHistory('1m');
    expect(res.set).toBeNull();
    expect(res.points).toEqual([]);
    expect(res.change).toEqual({ absMxnCents: 0, pct: null, direction: 'flat' });
  });

  it('featuredSetHistory con set destacado y sin snapshots → set resuelto, points []', async () => {
    const set = { id: 'setX', externalId: 'sv8', name: 'Surging Sparks', series: 'S&V', releaseDate: '2024/11/08' };
    const prisma: any = {
      cardSet: { findUnique: jest.fn().mockResolvedValue(set) },
      setValueSnapshot: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const svc = buildService(prisma, { get: jest.fn().mockReturnValue('sv8') } as any);
    const res = await svc.featuredSetHistory('3m');
    expect(res.set).toEqual({ id: 'setX', name: 'Surging Sparks', series: 'S&V', releaseDate: '2024/11/08' });
    expect(res.range).toBe('3m');
    expect(res.points).toEqual([]);
  });

  it('setHistoryById con set inexistente → 404 NOT_FOUND', async () => {
    const prisma: any = { cardSet: { findUnique: jest.fn().mockResolvedValue(null) } };
    const svc = buildService(prisma);
    await expect(svc.setHistoryById('nope', '1m')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('setHistoryById con set y snapshots → set no-null y serie', async () => {
    const set = { id: 'setX', name: 'X', series: null, releaseDate: null };
    const prisma: any = {
      cardSet: { findUnique: jest.fn().mockResolvedValue(set) },
      setValueSnapshot: {
        findMany: jest.fn().mockResolvedValue([
          { asOfDate: new Date('2026-08-15'), totalValueMxnCents: 500, pricedCardCount: 5 },
        ]),
      },
    };
    const svc = buildService(prisma);
    const res = await svc.setHistoryById('setX', 'all');
    expect(res.set).toEqual({ id: 'setX', name: 'X', series: undefined, releaseDate: undefined });
    expect(res.points).toHaveLength(1);
  });
});

describe('SetValueSnapshotJobService — upsert idempotente por día', () => {
  it('computa el valor del set destacado HOY y hace upsert por (setId, asOfDate)', async () => {
    const set = { id: 'setX', externalId: 'sv8' };
    const prisma: any = {
      cardSet: { findUnique: jest.fn().mockResolvedValue(set) },
      card: { findMany: jest.fn().mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]) },
      priceReference: {
        findMany: jest
          .fn()
          .mockResolvedValue([ref({ cardId: 'c1', priceMxnCents: 700, capturedDate: new Date('2026-08-15') })]),
      },
      setValueSnapshot: { upsert: jest.fn(async ({ create }: any) => create) },
    };
    const svc = buildService(prisma, { get: jest.fn().mockReturnValue('sv8') } as any);
    const job = new SetValueSnapshotJobService(svc);
    const res = await job.run();

    expect(res).toMatchObject({ setId: 'setX', totalValueMxnCents: 700, pricedCardCount: 1, totalCardCount: 2 });
    const call = prisma.setValueSnapshot.upsert.mock.calls[0][0];
    expect(call.where.setId_asOfDate.setId).toBe('setX');
    expect(call.where.setId_asOfDate.asOfDate).toBeInstanceOf(Date);
    expect(call.create.totalValueMxnCents).toBe(700);
    expect(call.update.pricedCardCount).toBe(1);
  });

  it('sin set destacado → no upsert, setId null', async () => {
    const prisma: any = {
      cardSet: { findUnique: jest.fn(), findFirst: jest.fn().mockResolvedValue(null) },
      setValueSnapshot: { findMany: jest.fn().mockResolvedValue([]), upsert: jest.fn() },
    };
    const svc = buildService(prisma);
    const job = new SetValueSnapshotJobService(svc);
    const res = await job.run();
    expect(res.setId).toBeNull();
    expect(prisma.setValueSnapshot.upsert).not.toHaveBeenCalled();
  });
});

describe('SetPriceSyncJobService — precia el set SIN filtrar bóveda (DEV-3)', () => {
  it('recorre Card WHERE setId=<featured> (sin InventoryItem) y usa escalate=false', async () => {
    const set = { id: 'setX' };
    const cards = [
      { id: 'c1', externalId: 'sv8-1' },
      { id: 'c2', externalId: 'sv8-2' },
    ];
    const prisma: any = { card: { findMany: jest.fn().mockResolvedValue(cards) } };
    const pricing = {
      syncCardPrice: jest.fn().mockResolvedValue({ status: 'priced' }),
    } as unknown as PricingService;
    const setValue = {
      resolveFeaturedSet: jest.fn().mockResolvedValue(set),
    } as unknown as SetValueService;

    const job = new SetPriceSyncJobService(prisma as PrismaService, pricing, setValue);
    const res = await job.run();

    // Recorre por setId, NO por InventoryItem (cierra DEV-3).
    expect(prisma.card.findMany).toHaveBeenCalledWith({ where: { setId: 'setX' } });
    // Reusa syncCardPrice con la MISMA regla compartida (TD-1) que la lectura y escalate=false.
    expect(pricing.syncCardPrice).toHaveBeenCalledTimes(2);
    expect(pricing.syncCardPrice).toHaveBeenCalledWith(
      cards[0],
      SET_VALUE_RULE.productType,
      SET_VALUE_RULE.gradeKey,
      SET_VALUE_RULE.finish,
      'catalog',
      undefined,
      false,
    );
    expect(res).toEqual({ setId: 'setX', priced: 2, total: 2 });
  });

  it('sin set destacado → no consulta cartas, priced 0', async () => {
    const prisma: any = { card: { findMany: jest.fn() } };
    const pricing = { syncCardPrice: jest.fn() } as unknown as PricingService;
    const setValue = { resolveFeaturedSet: jest.fn().mockResolvedValue(null) } as unknown as SetValueService;
    const job = new SetPriceSyncJobService(prisma as PrismaService, pricing, setValue);
    const res = await job.run();
    expect(res).toEqual({ setId: null, priced: 0, total: 0 });
    expect(prisma.card.findMany).not.toHaveBeenCalled();
  });
});
