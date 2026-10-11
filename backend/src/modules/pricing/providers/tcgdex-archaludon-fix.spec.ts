import * as fs from 'fs';
import * as path from 'path';
import { usdToMxnCents } from '../../../common/money';
import { parseCardPricing } from './tcgdex-shape';
import {
  resolveRobustMarket,
  decideLock,
  ArbiterCandidate,
  DEFAULT_PRICE_ARBITER_SOURCES,
  DEFAULT_PRICE_ARBITER_FRESHNESS_DAYS,
  DEFAULT_PRICE_CONSENSUS_TOLERANCE_PCT,
  DEFAULT_PRICE_JUMP_FACTOR,
} from '../../../common/robust-market';

const FIX = path.join(__dirname, '../../../../test/fixtures/tcgdex');
const load = (f: string) => JSON.parse(fs.readFileSync(path.join(FIX, f), 'utf8'));

/**
 * 💰 EL ARREGLO DEL DUEÑO, DE PUNTA A PUNTA EN LA LÓGICA (M-75 §PRE, DINERO).
 *
 * Reproduce el bug medido (§PRE.0): Archaludon 070/131 **Holofoil** salía MX$102.21 porque una fila
 * residual que APLANA (`pokemontcg_io`) coronaba cuando la primaria por variante (`tcgcsv_singles`)
 * tenía hueco en Prismatic. Aquí se siembra ese estado y se demuestra que §PRE lo mata:
 *   - el residuo `pokemontcg_io` NO vota el árbitro (aplana, criterio 883);
 *   - las dos fuentes nuevas frescas (tcgdex $0.11 USD + cardmarket €0.10) se parsean de la fixture REAL,
 *     se hornean a MXN y dan la MEDIANA en CENTAVOS (no MX$102);
 *   - como hay 2 FAMILIAS que concuerdan en «barato», el candado PUBLICA (no abre caso).
 *
 * Determinista (funciones puras + fixtures): N=1 justificado (O-3).
 */
describe('§PRE — Archaludon MX$102 → centavos (fixtures REALES, parser+FX+árbitro+candado)', () => {
  const fxUsd = { rate: 18.5, bufferPct: 1.5 }; // tasa realista USD→MXN con colchón
  const fxEur = { rate: 20.2, bufferPct: 1.5 }; // EUR→MXN
  const nowIso = '2026-10-11';
  const dials = {
    freshnessDays: DEFAULT_PRICE_ARBITER_FRESHNESS_DAYS,
    admittedSources: DEFAULT_PRICE_ARBITER_SOURCES,
    consensusTolerancePct: DEFAULT_PRICE_CONSENSUS_TOLERANCE_PCT,
  };

  // Parsea la cotización HOLOFOIL de la fixture real de Archaludon.
  const quotes = parseCardPricing(load('card-sv08.5-070.json').pricing);
  const tpHolo = quotes.find((q) => q.feed === 'tcgplayer' && q.finish === 'holofoil')!; // 11 USD¢
  const cmHolo = quotes.find((q) => q.feed === 'cardmarket' && q.finish === 'holofoil')!; // 10 EUR¢
  const tcgdexMxn = usdToMxnCents(tpHolo.amountCents, fxUsd.rate, fxUsd.bufferPct);
  const cardmarketMxn = usdToMxnCents(cmHolo.amountCents, fxEur.rate, fxEur.bufferPct);

  it('las fixtures reales son de CENTAVOS, no de MX$102 (confirma que el bug era residuo PPT)', () => {
    expect(tpHolo.amountCents).toBe(11); // $0.11
    expect(cmHolo.amountCents).toBe(10); // €0.10
    expect(tcgdexMxn).toBeLessThan(1000); // < MX$10
    expect(cardmarketMxn).toBeLessThan(1000);
  });

  it('el residuo pokemontcg_io (MX$10221) NO entra al árbitro — aunque esté en las candidatas', () => {
    const candidates: ArbiterCandidate[] = [
      { source: 'pokemontcg_io', priceMxnCents: 10221, capturedDate: nowIso }, // el residuo aplanado
      { source: 'tcgdex', priceMxnCents: tcgdexMxn, capturedDate: nowIso },
      { source: 'cardmarket', priceMxnCents: cardmarketMxn, capturedDate: nowIso },
    ];
    const robust = resolveRobustMarket(candidates, dials, nowIso);
    // 2 frescas admitidas (tcgdex + cardmarket); pokemontcg_io excluido.
    expect(robust.sourceCount).toBe(2);
    expect(robust.quotes.some((q) => q.source === 'pokemontcg_io')).toBe(false);
    // El robusto es el promedio de las dos (centavos), JAMÁS 10221.
    expect(robust.robustMarketMxnCents).toBe(Math.round((tcgdexMxn + cardmarketMxn) / 2));
    expect(robust.robustMarketMxnCents!).toBeLessThan(1000);
    expect(robust.familyCount).toBe(2); // tcgplayer (tcgdex) + cardmarket
  });

  it('2 familias que concuerdan en «barato» ⇒ el candado PUBLICA el precio bueno, NO abre caso', () => {
    const candidates: ArbiterCandidate[] = [
      { source: 'tcgdex', priceMxnCents: tcgdexMxn, capturedDate: nowIso },
      { source: 'cardmarket', priceMxnCents: cardmarketMxn, capturedDate: nowIso },
    ];
    const robust = resolveRobustMarket(candidates, dials, nowIso);
    expect(robust.consensus).toBe(true); // 2 familias dentro de ±25%
    // Base sana previa = los mismos centavos (la carta ya valía barato). jumpFactor ~1 ⇒ publica.
    const decision = decideLock(robust, tcgdexMxn, DEFAULT_PRICE_JUMP_FACTOR);
    expect(decision.outcome).toBe('publish');
    expect(decision.openCase).toBe(false);
    expect(decision.publishMxnCents).toBe(robust.robustMarketMxnCents);
    expect(decision.publishMxnCents!).toBeLessThan(1000); // centavos, no MX$102
  });

  it('CONTRA-PRUEBA: si el residuo MX$102 fuera la base «sana» y solo lo viera UNA familia, el candado lo DETIENE', () => {
    // Mundo donde solo hay tcgdex fresco (barato) y la base vigente es el residuo inflado.
    const candidates: ArbiterCandidate[] = [{ source: 'tcgdex', priceMxnCents: tcgdexMxn, capturedDate: nowIso }];
    const robust = resolveRobustMarket(candidates, dials, nowIso);
    expect(robust.familyCount).toBe(1); // una sola familia
    const decision = decideLock(robust, 10221, DEFAULT_PRICE_JUMP_FACTOR); // base = residuo inflado
    // Salto grande (10221→centavos, ~55×) con una sola familia ⇒ REVISIÓN, nunca publica a ciegas.
    expect(decision.outcome).toBe('review');
    expect(decision.openCase).toBe(true);
    expect(decision.publishMxnCents).toBeNull();
  });
});
