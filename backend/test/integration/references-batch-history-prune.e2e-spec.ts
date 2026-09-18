/**
 * references-batch-history-prune.e2e-spec.ts — H-PERF-1 MONEY-SAFE contra Postgres REAL.
 * Propiedad: backend.
 *
 * El arreglo de perf-catalog-2 poda el histórico de `PriceReference` EN LA BD (ventana `max_auto_date`
 * en `getReferencesBatch`; `SELECT DISTINCT` en `getPricedRawFinishesBatch`) para no materializar una
 * fila por día por carta. La barra es MONEY-SAFE: la SALIDA debe ser idéntica a la del algoritmo previo
 * (traer TODO el histórico y desempatar con `pickBestRef`/`isBetterRef`).
 *
 * Esta suite lo PRUEBA sobre datos con HISTORIA PROFUNDA (200 días) y las ramas adversarias de
 * `isBetterRef`: override manual cross-day (gana a la automática fresca), multi-fuente el mismo día
 * (sourceRank), multi-`cardProductId` el mismo día (NULLS LAST), y `graded_estimate` (excluido por
 * `MONEY_REF_WHERE`). El ORÁCULO es una relectura INDEPENDIENTE del histórico completo reducida con
 * `pickBestRef` — exactamente lo que el método hacía en Node y ahora resuelve la BD. Filas con
 * `priceUsdCents=null` (MXN congelado) para desacoplar la FX y que la comparación sea determinista.
 */
import { randomUUID } from 'crypto';
import { E2EHarness } from './helpers/e2e-app';
import {
  PricingService,
  MONEY_REF_WHERE,
  BASE_CARD_REF_WHERE,
  pickBestRef,
} from '../../src/modules/pricing/pricing.service';
import { variantKey } from '../../src/common/variant-key';

describe('E2E — getReferencesBatch/getPricedRawFinishesBatch podan histórico sin cambiar la salida (Postgres real)', () => {
  let h: E2EHarness;
  let pricing: PricingService;

  const setId = `hp-set-${randomUUID()}`;
  // i=6 (P-53 ALTO-3 §3): primaria tcgcsv_singles con capturedDate viejo + evidenceDate=HOY vs fallback
  // pokemontcg_io capturedDate=HOY. Sin frescura efectiva la primaria caería fuera de max_auto_date.
  const N = 7;
  const H = 200; // historia PROFUNDA: sin poda serían N*H filas leídas
  const cardIds: string[] = Array.from({ length: N }, (_, i) => `hp-card-${i}-${randomUUID()}`);
  const cpIds = new Map<number, string>();

  const day = (d: number) => {
    const x = new Date(Date.UTC(2026, 4, 1));
    x.setUTCDate(x.getUTCDate() + d);
    return x;
  };

  beforeAll(async () => {
    h = await E2EHarness.create();
    pricing = h.app.get(PricingService);
    await h.prisma.cardSet.create({ data: { id: setId, externalId: `hp-ext-${randomUUID()}`, name: 'HP Set' } });

    for (let i = 0; i < N; i++) {
      const cardId = cardIds[i];
      await h.prisma.card.create({
        data: { id: cardId, externalId: `hp-cext-${randomUUID()}`, setId, name: `HP${i}`, number: String(i), availableFinishes: ['normal'] },
      });
      const refs: any[] = [];
      // i<6: historia PROFUNDA (una automática fresca por día). i=6 arma a mano SOLO las dos filas del
      // caso ALTO-3 (sin este loop, para que no haya una tcgcsv_singles fresca que tape el escenario).
      if (i < 6) {
        for (let d = 0; d < H; d++) {
          refs.push({ id: `${cardId}-r-${d}`, cardId, productType: 'raw', gradeKey: 'raw:NM', finish: 'normal', source: 'tcgcsv_singles', cardProductId: null, priceUsdCents: null, priceMxnCents: 100000 + i * 1000 + d, capturedDate: day(d), isManualOverride: false, refKind: 'market' });
        }
      }
      if (i === 1) {
        // manual override VIEJO (día -3): debe ganar por tier a toda automática fresca.
        refs.push({ id: `${cardId}-man`, cardId, productType: 'raw', gradeKey: 'raw:NM', finish: 'normal', source: 'manual', cardProductId: null, priceUsdCents: null, priceMxnCents: 777777, capturedDate: day(-3), isManualOverride: true, refKind: 'market' });
      } else if (i === 2) {
        // same-day (día H-1) en OTRO cardProduct con fuente peor: sourceRank prefiere la NULL tcgcsv_singles.
        const cp = randomUUID();
        cpIds.set(i, cp);
        await h.prisma.cardProduct.create({ data: { id: cp, cardId, tcgplayerProductId: 970000000 + i, kind: 'set_base', name: 'base' } });
        refs.push({ id: `${cardId}-io`, cardId, productType: 'raw', gradeKey: 'raw:NM', finish: 'normal', source: 'pokemontcg_io', cardProductId: cp, priceUsdCents: null, priceMxnCents: 555555, capturedDate: day(H - 1), isManualOverride: false, refKind: 'market' });
      } else if (i === 3) {
        // multi-cardProductId same-day same-source: NULLS LAST ⇒ gana el set_base (no nulo).
        const cp = randomUUID();
        cpIds.set(i, cp);
        await h.prisma.cardProduct.create({ data: { id: cp, cardId, tcgplayerProductId: 970000000 + i, kind: 'set_base', name: 'base' } });
        refs.push({ id: `${cardId}-cp`, cardId, productType: 'raw', gradeKey: 'raw:NM', finish: 'normal', source: 'tcgcsv_singles', cardProductId: cp, priceUsdCents: null, priceMxnCents: 444444, capturedDate: day(H - 1), isManualOverride: false, refKind: 'market' });
      } else if (i === 4) {
        // graded_estimate FRESCO: MONEY_REF_WHERE lo excluye ⇒ no debe ganar (ni aparecer).
        refs.push({ id: `${cardId}-ge`, cardId, productType: 'raw', gradeKey: 'raw:NM', finish: 'normal', source: 'manual', cardProductId: null, priceUsdCents: null, priceMxnCents: 999999, capturedDate: day(H + 10), isManualOverride: true, refKind: 'graded_estimate' });
      } else if (i === 6) {
        // P-53 ALTO-3 (§3): la primaria «buena» — USD estable, el escritor diario CONGELA capturedDate
        // (día -5, viejo) y solo avanza evidenceDate a HOY (día H-1). El fallback de MENOR precedencia
        // (pokemontcg_io, cardProductId=null) lo escribe refreshCardPrices con capturedDate=HOY.
        refs.push({ id: `${cardId}-primary`, cardId, productType: 'raw', gradeKey: 'raw:NM', finish: 'normal', source: 'tcgcsv_singles', cardProductId: null, priceUsdCents: null, priceMxnCents: 123456, capturedDate: day(-5), evidenceDate: day(H - 1), isManualOverride: false, refKind: 'market' });
        refs.push({ id: `${cardId}-fallback`, cardId, productType: 'raw', gradeKey: 'raw:NM', finish: 'normal', source: 'pokemontcg_io', cardProductId: null, priceUsdCents: null, priceMxnCents: 654321, capturedDate: day(H - 1), isManualOverride: false, refKind: 'market' });
      }
      // i===5: deck_exclusive fresco en otro cardProduct: BASE_CARD_REF_WHERE lo excluye.
      if (i === 5) {
        const cp = randomUUID();
        await h.prisma.cardProduct.create({ data: { id: cp, cardId, tcgplayerProductId: 970000000 + i, kind: 'deck_exclusive', name: 'deck' } });
        refs.push({ id: `${cardId}-deck`, cardId, productType: 'raw', gradeKey: 'raw:NM', finish: 'normal', source: 'tcgcsv_singles', cardProductId: cp, priceUsdCents: null, priceMxnCents: 888888, capturedDate: day(H + 5), isManualOverride: false, refKind: 'market' });
      }
      await h.prisma.priceReference.createMany({ data: refs });
    }
  });

  afterAll(async () => {
    await h.prisma.priceReference.deleteMany({ where: { cardId: { in: cardIds } } });
    await h.prisma.cardProduct.deleteMany({ where: { cardId: { in: cardIds } } });
    await h.prisma.card.deleteMany({ where: { id: { in: cardIds } } });
    await h.prisma.cardSet.deleteMany({ where: { id: setId } });
    await h?.close();
  });

  /** ORÁCULO: relee TODO el histórico (algoritmo previo) y desempata con pickBestRef. */
  async function referenceMap() {
    const rows = await h.prisma.priceReference.findMany({
      where: {
        cardId: { in: cardIds },
        productType: { in: ['raw'] },
        gradeKey: { in: ['raw:NM'] },
        finish: { in: ['normal'] },
        AND: [MONEY_REF_WHERE, BASE_CARD_REF_WHERE],
      },
      orderBy: { capturedDate: 'desc' },
    });
    const byKey = new Map<string, any[]>();
    for (const r of rows) {
      const k = variantKey({ cardId: r.cardId, productType: r.productType, gradeKey: r.gradeKey, finish: r.finish });
      (byKey.get(k) ?? byKey.set(k, []).get(k)!).push(r);
    }
    const out: Record<string, { referenceMxnCents: number; source: string; capturedDate: string }> = {};
    for (const [k, rs] of byKey) {
      const best = pickBestRef(rs as any)!;
      // priceUsdCents=null ⇒ liveMxnCents = priceMxnCents (FX desacoplada).
      out[k] = { referenceMxnCents: best.priceMxnCents, source: best.source, capturedDate: best.capturedDate.toISOString().slice(0, 10) };
    }
    return out;
  }

  it('getReferencesBatch == oráculo (histórico completo + pickBestRef) byte-a-byte, con historia profunda y ramas adversarias', async () => {
    const items = cardIds.map((cardId) => ({ cardId, productType: 'raw' as const, gradeKey: 'raw:NM', finish: 'normal' as const }));
    const got = await pricing.getReferencesBatch(items as any);
    const gotObj: Record<string, any> = {};
    for (const [k, v] of got) gotObj[k] = { referenceMxnCents: v.referenceMxnCents, source: v.source, capturedDate: v.capturedDate };
    const oracle = await referenceMap();
    expect(gotObj).toEqual(oracle);

    // Sanidad de que las ramas adversarias están VIVAS (no un empate trivial):
    expect(gotObj[variantKey({ cardId: cardIds[1], productType: 'raw', gradeKey: 'raw:NM', finish: 'normal' })].referenceMxnCents).toBe(777777); // manual cross-day gana
    expect(gotObj[variantKey({ cardId: cardIds[2], productType: 'raw', gradeKey: 'raw:NM', finish: 'normal' })].referenceMxnCents).toBe(100000 + 2 * 1000 + (H - 1)); // sourceRank: la NULL tcgcsv_singles, no la pokemontcg_io
    expect(gotObj[variantKey({ cardId: cardIds[3], productType: 'raw', gradeKey: 'raw:NM', finish: 'normal' })].referenceMxnCents).toBe(444444); // NULLS LAST: gana el set_base
    expect(gotObj[variantKey({ cardId: cardIds[4], productType: 'raw', gradeKey: 'raw:NM', finish: 'normal' })].referenceMxnCents).toBe(100000 + 4 * 1000 + (H - 1)); // graded_estimate excluido
    expect(gotObj[variantKey({ cardId: cardIds[5], productType: 'raw', gradeKey: 'raw:NM', finish: 'normal' })].referenceMxnCents).toBe(100000 + 5 * 1000 + (H - 1)); // deck_exclusive excluido
    // P-53 ALTO-3 (§3): la primaria (capturedDate viejo + evidenceDate=HOY) GANA al fallback fresco de
    // menor precedencia. Sin frescura efectiva en la ventana `max_auto_date`, la primaria caería fuera y
    // se serviría el fallback (654321) — la inversión de §4.27f que este canario cierra en SQL REAL.
    const c6 = gotObj[variantKey({ cardId: cardIds[6], productType: 'raw', gradeKey: 'raw:NM', finish: 'normal' })];
    expect(c6.referenceMxnCents).toBe(123456);
    expect(c6.source).toBe('tcgcsv_singles');
  });

  it('getPricedRawFinishesBatch == oráculo (conjunto de pares (cardId,finish) con market>0)', async () => {
    const got = await pricing.getPricedRawFinishesBatch(cardIds);
    const gotPairs = [...got.entries()].flatMap(([c, s]) => [...s].map((f) => `${c}|${f}`)).sort();

    const rows = await h.prisma.priceReference.findMany({
      where: { cardId: { in: cardIds }, productType: 'raw', gradeKey: 'raw:NM', priceMxnCents: { gt: 0 }, AND: [MONEY_REF_WHERE, BASE_CARD_REF_WHERE] },
      select: { cardId: true, finish: true },
      distinct: ['cardId', 'finish'],
    });
    const oraclePairs = rows.map((r) => `${r.cardId}|${r.finish}`).sort();
    expect(gotPairs).toEqual(oraclePairs);
  });
});
