/**
 * robust-market.spec.ts — v1.91⟨precios⟩ (M-75) — pruebas MONEY-SAFE del árbitro + candado.
 *
 * 🔒 Incluye el CANARIO DEL CANDADO (criterio 889(c), OBLIGATORIO, DINERO): siembra base=MX$1.84 + UNA
 * cotización fresca de una sola familia ×55, corre la resolución y asevera que NO publica el disparado y
 * que abre caso. La demostración de que MUERDE (quitar la rama de revisión ⇒ rojo) se hace sobre una
 * COPIA del árbol (ver BACKEND_NOTES §91), no aquí.
 */
import {
  ArbiterCandidate,
  ArbiterDials,
  DEFAULT_PRICE_ARBITER_SOURCES,
  decideLock,
  familyOf,
  jumpFactorMilli,
  resolveRobustMarket,
  validatePriceArbiterSources,
  validatePriceConsensusTolerancePct,
  validatePriceJumpFactor,
} from './robust-market';

const NOW = '2026-10-11';
const DIALS: ArbiterDials = {
  freshnessDays: 7,
  admittedSources: DEFAULT_PRICE_ARBITER_SOURCES,
  consensusTolerancePct: 25,
};

function c(source: string, priceMxnCents: number, capturedDate = NOW): ArbiterCandidate {
  return { source, priceMxnCents, capturedDate };
}

describe('familyOf — tcgcsv_singles y tcgdex son ECO (una familia tcgplayer); cardmarket es independiente', () => {
  it('agrupa correctamente', () => {
    expect(familyOf('tcgcsv_singles')).toBe('tcgplayer');
    expect(familyOf('tcgdex')).toBe('tcgplayer');
    expect(familyOf('cardmarket')).toBe('cardmarket');
    expect(familyOf('poketrace')).toBe('live:poketrace');
  });
});

describe('resolveRobustMarket — el árbitro de mediana por familia (§PRE.B)', () => {
  it('3+ frescas ⇒ MEDIANA (ignora el outlier): [184,190,10221] ⇒ 190 (criterio 873)', () => {
    const r = resolveRobustMarket(
      [c('tcgcsv_singles', 184), c('tcgdex', 190), c('cardmarket', 10221)],
      DIALS,
      NOW,
    );
    expect(r.robustMarketMxnCents).toBe(190);
    expect(r.sourceCount).toBe(3);
  });

  it('conteo par ⇒ promedio entero round((a+b)/2) de las dos centrales', () => {
    // [100, 200, 201, 500] centrales 200 y 201 ⇒ round(200.5)=201
    const r = resolveRobustMarket(
      [c('tcgcsv_singles', 100), c('tcgdex', 200), c('cardmarket', 201), c('poketrace', 500)],
      { ...DIALS, admittedSources: ['tcgcsv_singles', 'tcgdex', 'cardmarket', 'poketrace'] },
      NOW,
    );
    expect(r.robustMarketMxnCents).toBe(201);
  });

  it('2 cotizaciones ⇒ promedio entero round((a+b)/2)', () => {
    const r = resolveRobustMarket([c('tcgcsv_singles', 100), c('cardmarket', 151)], DIALS, NOW);
    expect(r.robustMarketMxnCents).toBe(126); // round(125.5)
    expect(r.familyCount).toBe(2);
  });

  it('1 cotización ⇒ esa', () => {
    const r = resolveRobustMarket([c('tcgdex', 777)], DIALS, NOW);
    expect(r.robustMarketMxnCents).toBe(777);
    expect(r.familyCount).toBe(1);
  });

  it('0 frescas admitidas ⇒ null (PRICE_PENDING)', () => {
    const r = resolveRobustMarket([], DIALS, NOW);
    expect(r.robustMarketMxnCents).toBeNull();
    expect(r.sourceCount).toBe(0);
  });

  it('💰 pokemontcg_io NUNCA vota, aunque lo metan en el dial (criterio 883)', () => {
    const r = resolveRobustMarket(
      [c('pokemontcg_io', 10221), c('tcgcsv_singles', 184)],
      { ...DIALS, admittedSources: ['pokemontcg_io', 'tcgcsv_singles', 'tcgdex', 'cardmarket'] },
      NOW,
    );
    expect(r.robustMarketMxnCents).toBe(184); // solo tcgcsv_singles votó
    expect(r.sourceCount).toBe(1);
    expect(r.quotes.find((q) => q.source === 'pokemontcg_io')).toBeUndefined();
  });

  it('💰 pokemonpricetracker y manual tampoco votan', () => {
    const r = resolveRobustMarket(
      [c('pokemonpricetracker', 9999), c('manual', 8888), c('cardmarket', 150)],
      { ...DIALS, admittedSources: ['pokemonpricetracker', 'manual', 'cardmarket', 'tcgcsv_singles', 'tcgdex'] },
      NOW,
    );
    expect(r.robustMarketMxnCents).toBe(150);
    expect(r.sourceCount).toBe(1);
  });

  it('💰 el dato STALE no vota (>7 días); queda en quotes marcado stale (criterio 881)', () => {
    const r = resolveRobustMarket(
      [c('tcgcsv_singles', 184, NOW), c('cardmarket', 10221, '2026-10-01')], // 10 días atrás ⇒ stale
      DIALS,
      NOW,
    );
    expect(r.robustMarketMxnCents).toBe(184);
    expect(r.sourceCount).toBe(1);
    const stale = r.quotes.find((q) => q.source === 'cardmarket');
    expect(stale?.stale).toBe(true);
  });

  it('frescura: exactamente 7 días atrás SÍ vota; 8 días NO', () => {
    expect(resolveRobustMarket([c('tcgdex', 100, '2026-10-04')], DIALS, NOW).sourceCount).toBe(1); // 7 días
    expect(resolveRobustMarket([c('tcgdex', 100, '2026-10-03')], DIALS, NOW).sourceCount).toBe(0); // 8 días
  });

  it('consenso ⇔ ≥2 familias y todas dentro de ±tol de la mediana', () => {
    // dos familias cercanas ⇒ consenso
    const ok = resolveRobustMarket([c('tcgcsv_singles', 100), c('cardmarket', 110)], DIALS, NOW);
    expect(ok.consensus).toBe(true);
    // dos familias lejanas (>25%) ⇒ sin consenso
    const no = resolveRobustMarket([c('tcgcsv_singles', 100), c('cardmarket', 10000)], DIALS, NOW);
    expect(no.consensus).toBe(false);
    // una sola familia (aunque 2 filas) ⇒ nunca consenso
    const single = resolveRobustMarket([c('tcgcsv_singles', 100), c('tcgdex', 101)], DIALS, NOW);
    expect(single.familyCount).toBe(1);
    expect(single.consensus).toBe(false);
  });
});

describe('decideLock — el árbol del candado ×5 (§PRE.C)', () => {
  it('salto normal (<5×) ⇒ PUBLICA el robusto', () => {
    const r = resolveRobustMarket([c('tcgcsv_singles', 200), c('cardmarket', 210)], DIALS, NOW);
    const d = decideLock(r, 100, 5); // 2.1× < 5
    expect(d.outcome).toBe('publish');
    expect(d.publishMxnCents).toBe(205);
    expect(d.openCase).toBe(false);
  });

  it('salto GRANDE (≥5×) + consenso de 2 familias ⇒ PUBLICA (el mercado se movió)', () => {
    const r = resolveRobustMarket([c('tcgcsv_singles', 1000), c('cardmarket', 1100)], DIALS, NOW);
    const d = decideLock(r, 100, 5); // ~10.5× pero 2 familias concuerdan
    expect(r.consensus).toBe(true);
    expect(d.outcome).toBe('publish');
    expect(d.openCase).toBe(false);
  });

  it('sin base + consenso ⇒ PUBLICA (primer precio sano); sin base + fuente única ⇒ REVISIÓN', () => {
    const withCons = resolveRobustMarket([c('tcgcsv_singles', 100), c('cardmarket', 110)], DIALS, NOW);
    expect(decideLock(withCons, null, 5).outcome).toBe('publish');
    const single = resolveRobustMarket([c('tcgdex', 100)], DIALS, NOW);
    const d = decideLock(single, null, 5);
    expect(d.outcome).toBe('review');
    expect(d.openCase).toBe(true);
  });

  it('0 frescas con base ⇒ pending + abre caso, conserva el último sano', () => {
    const r = resolveRobustMarket([], DIALS, NOW);
    const d = decideLock(r, 184, 5);
    expect(d.outcome).toBe('pending');
    expect(d.conservedMxnCents).toBe(184);
    expect(d.openCase).toBe(true);
    expect(d.publishMxnCents).toBeNull();
  });

  it('jumpFactorMilli: ×55 = round(10221*1000/184) = 55549', () => {
    expect(jumpFactorMilli(10221, 184)).toBe(55549);
    expect(jumpFactorMilli(100, null)).toBe(0);
  });
});

/**
 * 🔒💰 CANARIO DEL CANDADO — criterio 889(c), OBLIGATORIO. La resolución es DETERMINISTA (funciones puras,
 * sin reloj salvo `NOW` explícito, sin carrera) ⇒ 1 tirada basta.
 */
describe('🔒 CANARIO DEL CANDADO (criterio 889c, DINERO)', () => {
  it('base=184¢ + UNA fresca de una sola familia ×55 (10221¢) ⇒ NO publica 10221, conserva 184, abre caso', () => {
    const robust = resolveRobustMarket([c('tcgdex', 10221, NOW)], DIALS, NOW); // UNA familia tcgplayer
    expect(robust.robustMarketMxnCents).toBe(10221);
    expect(robust.familyCount).toBe(1);
    expect(robust.consensus).toBe(false);

    const decision = decideLock(robust, 184, 5);

    // 1) NO publica el disparado.
    expect(decision.outcome).toBe('review');
    expect(decision.publishMxnCents).not.toBe(10221);
    expect(decision.publishMxnCents).toBeNull();
    // 2) Conserva el último sano (184) o PRICE_PENDING.
    expect(decision.conservedMxnCents).toBe(184);
    // 3) Abre un PriceReviewCase open.
    expect(decision.openCase).toBe(true);
    // El factor queda registrado ×1000.
    expect(decision.jumpFactorMilli).toBe(55549);
  });

  it('mismo salto PERO con 2 familias que concuerdan (10221 y 10000) ⇒ SÍ publica (el candado deja pasar el movimiento real)', () => {
    const robust = resolveRobustMarket([c('tcgdex', 10221, NOW), c('cardmarket', 10000, NOW)], DIALS, NOW);
    expect(robust.familyCount).toBe(2);
    expect(robust.consensus).toBe(true);
    const decision = decideLock(robust, 184, 5);
    expect(decision.outcome).toBe('publish');
    expect(decision.openCase).toBe(false);
  });
});

describe('validadores de diales (§PRE.G)', () => {
  it('priceJumpFactor: número ≥ 1', () => {
    expect(validatePriceJumpFactor(5)).toBeNull();
    expect(validatePriceJumpFactor(1)).toBeNull();
    expect(validatePriceJumpFactor(0.5)).not.toBeNull();
    expect(validatePriceJumpFactor('5')).not.toBeNull();
  });
  it('priceConsensusTolerancePct: entero [0,100]', () => {
    expect(validatePriceConsensusTolerancePct(25)).toBeNull();
    expect(validatePriceConsensusTolerancePct(0)).toBeNull();
    expect(validatePriceConsensusTolerancePct(101)).not.toBeNull();
    expect(validatePriceConsensusTolerancePct(25.5)).not.toBeNull();
  });
  it('priceArbiterSources: lista no vacía de fuentes elegibles, sin pokemontcg_io/PPT/manual, sin duplicados', () => {
    expect(validatePriceArbiterSources(['tcgcsv_singles', 'tcgdex', 'cardmarket'])).toBeNull();
    expect(validatePriceArbiterSources([])).not.toBeNull();
    expect(validatePriceArbiterSources(['pokemontcg_io'])).not.toBeNull();
    expect(validatePriceArbiterSources(['manual'])).not.toBeNull();
    expect(validatePriceArbiterSources(['tcgdex', 'tcgdex'])).not.toBeNull();
  });
});
