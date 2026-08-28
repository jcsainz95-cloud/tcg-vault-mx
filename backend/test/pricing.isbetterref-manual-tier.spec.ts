import { isBetterRef, pickBestRef, RefRow } from '../src/modules/pricing/pricing.service';

/**
 * §4.27f-2 (P47-2, ALTA) — el override MANUAL es TIER SUPERIOR ABSOLUTO y DURABLE cross-day.
 *
 * ANTES del fix `isBetterRef` comparaba `capturedDate` por encima del tier manual/no-manual, así que
 * un override manual solo ganaba el MISMO día: una `tcgcsv_singles` de HOY superseemplazaba un override
 * manual de ayer (money-losing — la decisión humana se perdía sin que el admin la tocara). El fix iza la
 * comparación manual/no-manual POR ENCIMA de `capturedDate`: el manual gana SIEMPRE, sin mirar la fecha.
 *
 * Es precedencia de LECTURA (no hay migración ni re-resolución): la siguiente lectura de la MISMA fila
 * elige el override manual sin re-escribir nada.
 */
const DAY_OLD = new Date('2026-08-01T00:00:00Z');
const DAY_NEW = new Date('2026-08-24T00:00:00Z');

function row(over: Partial<RefRow>): RefRow {
  return {
    priceMxnCents: 1000,
    priceUsdCents: null,
    isManualOverride: false,
    source: 'tcgcsv_singles',
    capturedDate: DAY_NEW,
    cardProductId: null,
    ...over,
  };
}

describe('isBetterRef — tier manual absoluto, durable cross-day (P47-2)', () => {
  it('(a) override manual VIEJO gana sobre tcgcsv_singles de HOY', () => {
    const manualOld = row({
      isManualOverride: true,
      source: 'manual',
      capturedDate: DAY_OLD,
      priceMxnCents: 9900,
    });
    const autoToday = row({
      source: 'tcgcsv_singles',
      capturedDate: DAY_NEW,
      priceMxnCents: 1200,
    });
    // El manual viejo es mejor que la automática fresca (tier superior, sin mirar fecha).
    expect(isBetterRef(manualOld, autoToday)).toBe(true);
    // Y NO al revés: la automática fresca NO supersede al manual.
    expect(isBetterRef(autoToday, manualOld)).toBe(false);
    // pickBestRef coincide sin importar el orden de entrada.
    expect(pickBestRef([autoToday, manualOld])).toBe(manualOld);
    expect(pickBestRef([manualOld, autoToday])).toBe(manualOld);
  });

  it('(b) dos fuentes automáticas de distinta fecha: gana la más fresca', () => {
    const autoOld = row({ source: 'tcgcsv_singles', capturedDate: DAY_OLD, priceMxnCents: 800 });
    const autoNew = row({ source: 'tcgcsv_singles', capturedDate: DAY_NEW, priceMxnCents: 1300 });
    expect(isBetterRef(autoNew, autoOld)).toBe(true);
    expect(isBetterRef(autoOld, autoNew)).toBe(false);
    expect(pickBestRef([autoOld, autoNew])).toBe(autoNew);
    expect(pickBestRef([autoNew, autoOld])).toBe(autoNew);
  });

  it('(c) override manual nuevo supersede a override manual viejo (dentro del tier gana el fresco)', () => {
    const manualOld = row({
      isManualOverride: true,
      source: 'manual',
      capturedDate: DAY_OLD,
      priceMxnCents: 5000,
    });
    const manualNew = row({
      isManualOverride: true,
      source: 'manual',
      capturedDate: DAY_NEW,
      priceMxnCents: 7000,
    });
    expect(isBetterRef(manualNew, manualOld)).toBe(true);
    expect(isBetterRef(manualOld, manualNew)).toBe(false);
    expect(pickBestRef([manualOld, manualNew])).toBe(manualNew);
    expect(pickBestRef([manualNew, manualOld])).toBe(manualNew);
  });

  it('money-safe: una tcgcsv_singles STALE NO le gana a un residuo fresco (no se iza sourceRank sobre fecha)', () => {
    // Ambas automáticas: tcgcsv_singles (rank 1) VIEJA vs pokemontcg_io (rank 3) de HOY. La fecha manda
    // dentro del tier ⇒ gana la fresca aunque su fuente sea de menor precedencia (evita money-losing).
    const staleStrong = row({ source: 'tcgcsv_singles', capturedDate: DAY_OLD, priceMxnCents: 500 });
    const freshWeak = row({ source: 'pokemontcg_io', capturedDate: DAY_NEW, priceMxnCents: 1400 });
    expect(isBetterRef(freshWeak, staleStrong)).toBe(true);
    expect(isBetterRef(staleStrong, freshWeak)).toBe(false);
  });

  it('mismo tier y día: la precedencia de fuente desempata (determinismo)', () => {
    const singles = row({ source: 'tcgcsv_singles', capturedDate: DAY_NEW });
    const ppt = row({ source: 'pokemonpricetracker', capturedDate: DAY_NEW });
    expect(isBetterRef(singles, ppt)).toBe(true); // rank 1 < rank 2.
    expect(isBetterRef(ppt, singles)).toBe(false);
  });

  it('reconoce el tier manual por el flag isManualOverride aunque source no sea "manual"', () => {
    const flaggedOld = row({
      isManualOverride: true,
      source: 'tcgcsv_singles',
      capturedDate: DAY_OLD,
      priceMxnCents: 9000,
    });
    const autoToday = row({ source: 'tcgcsv_singles', capturedDate: DAY_NEW, priceMxnCents: 1000 });
    expect(isBetterRef(flaggedOld, autoToday)).toBe(true);
  });
});
