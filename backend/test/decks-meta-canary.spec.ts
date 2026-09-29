import { evaluateCanary, DeckCanarySummary, CanaryInput } from '../src/modules/decks-meta/canary';
import { CANARY_DEFAULTS, CanaryThresholds } from '../src/modules/decks-meta/limitless.config';

/**
 * DECKS-META Fase 2 — CANARY (gate DURO, spec §5). Un caso que PASA y un caso por cada umbral C1–C5
 * que DEBE fallar (spec §10, gate QA). Puro: sin I/O, umbrales inyectados.
 */
const T: CanaryThresholds = { ...CANARY_DEFAULTS }; // minDecks 6, cards [55,61], match 0.8, unmatchedSet 0.1

/** Un deck sano: 60 cartas por cantidad, 55 casadas de 60 (ratio 0.917), 0 unmatched_set. */
function healthyDeck(i: number): DeckCanarySummary {
  return {
    archetypeId: String(100 + i),
    slug: `deck-${i}`,
    name: `Deck ${i}`,
    cardsParsed: 15,
    sumQuantity: 60,
    matched: 55,
    total: 60,
    unmatchedSet: 0,
  };
}

function input(decks: DeckCanarySummary[], over: Partial<CanaryInput> = {}): CanaryInput {
  return { homeParseable: true, leadersWithListId: Math.max(decks.length, 6), decks, ...over };
}

describe('evaluateCanary (§5)', () => {
  it('CASO SANO: 6 decks a ~60 con buen match ⇒ PUBLISH, sin checks fallidos', () => {
    const r = evaluateCanary(input([0, 1, 2, 3, 4, 5].map(healthyDeck)), T);
    expect(r.verdict).toBe('PUBLISH');
    expect(r.reason).toBeNull();
    expect(r.checks.every((c) => c.ok)).toBe(true);
    expect(r.inBandDeckCount).toBe(6);
  });

  it('C1 FALLA: menos de minDecks arquetipos en banda ⇒ NO_PUBLISH', () => {
    const r = evaluateCanary(input([0, 1, 2, 3, 4].map(healthyDeck)), T);
    expect(r.verdict).toBe('NO_PUBLISH');
    expect(r.checks.find((c) => c.id === 'C1')!.ok).toBe(false);
    expect(r.reason).toContain('C1');
  });

  it('C2 FALLA: un deck a medio parsear (30 cartas) fuera de banda ⇒ NO_PUBLISH', () => {
    const decks = [0, 1, 2, 3, 4, 5].map(healthyDeck);
    decks[2] = { ...decks[2], sumQuantity: 30, matched: 28, total: 30 };
    const r = evaluateCanary(input(decks), T);
    expect(r.verdict).toBe('NO_PUBLISH');
    expect(r.checks.find((c) => c.id === 'C2')!.ok).toBe(false);
  });

  it('C3 FALLA: ratio de match global por debajo del piso (0.80) ⇒ NO_PUBLISH', () => {
    // 6 decks, cada uno 60 cartas pero solo 30 casadas ⇒ ratio 0.5.
    const decks = [0, 1, 2, 3, 4, 5].map((i) => ({ ...healthyDeck(i), matched: 30 }));
    const r = evaluateCanary(input(decks), T);
    expect(r.verdict).toBe('NO_PUBLISH');
    expect(r.checks.find((c) => c.id === 'C3')!.ok).toBe(false);
  });

  it('C4 FALLA: demasiadas líneas unmatched_set (>10%) ⇒ NO_PUBLISH', () => {
    // 12 unmatched_set de 60 por deck = 20% > 10%. Mantengo el ratio de match alto para aislar C4.
    const decks = [0, 1, 2, 3, 4, 5].map((i) => ({ ...healthyDeck(i), matched: 55, unmatchedSet: 12 }));
    const r = evaluateCanary(input(decks), T);
    expect(r.verdict).toBe('NO_PUBLISH');
    expect(r.checks.find((c) => c.id === 'C4')!.ok).toBe(false);
  });

  it('C5 FALLA: home no parseable ⇒ NO_PUBLISH aunque los decks estén sanos', () => {
    const r = evaluateCanary(input([0, 1, 2, 3, 4, 5].map(healthyDeck), { homeParseable: false }), T);
    expect(r.verdict).toBe('NO_PUBLISH');
    expect(r.checks.find((c) => c.id === 'C5')!.ok).toBe(false);
  });

  it('C5 FALLA: bloques con listId por debajo de minDecks ⇒ NO_PUBLISH', () => {
    const r = evaluateCanary(input([0, 1, 2, 3, 4, 5].map(healthyDeck), { leadersWithListId: 4 }), T);
    expect(r.verdict).toBe('NO_PUBLISH');
    expect(r.checks.find((c) => c.id === 'C5')!.ok).toBe(false);
  });

  it('umbrales configurables: bajar minDecks a 3 hace pasar un run de 3 decks sanos', () => {
    const r = evaluateCanary(input([0, 1, 2].map(healthyDeck), { leadersWithListId: 3 }), { ...T, minDecks: 3 });
    expect(r.verdict).toBe('PUBLISH');
  });

  it('sin decks ⇒ NO_PUBLISH (C1 y C2 fallan; nada que publicar)', () => {
    const r = evaluateCanary(input([]), T);
    expect(r.verdict).toBe('NO_PUBLISH');
  });
});
