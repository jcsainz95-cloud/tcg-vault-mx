/**
 * dyn.featured-selection.pure.spec.ts — v1.113⟨portada⟩ (API_CONTRACT §DYN.2.3): `selectFeatured`, la función PURA del
 * sorteo diario de Destacadas. Oráculo escrito a mano desde el pseudocódigo del contrato.
 *   pool      = top poolSize por (P desc, K asc)
 *   recientes = firstListedAt > effectiveFrom − windowDays·24 h; top 10 por (P desc, K asc)
 *   na        = sorteo sin reemplazo de min(newArrivalSlots, |recientes|)            → posiciones 1..|na|
 *   resto     = sorteo sin reemplazo de min(random + newArrival − |na|, |pool \ na|) → siguientes posiciones
 */
import {
  FEATURED_NEW_ARRIVAL_TOP,
  FeaturedCandidate,
  featuredKeyOf,
  seededRng,
  selectFeatured,
} from '../src/modules/catalog/featured-selection';

const EF = new Date('2026-12-01T12:00:00.000Z');
const DIALS = { poolSize: 60, randomSlots: 8, newArrivalSlots: 2, windowDays: 7 };
const daysAgo = (d: number) => new Date(EF.getTime() - d * 86_400_000);

function cand(i: number, priceCents: number, firstListedAt: Date | null = daysAgo(100)): FeaturedCandidate {
  return { cardId: `c${String(i).padStart(3, '0')}`, productType: 'raw', gradeKey: 'raw:NM', finish: 'normal', priceCents, firstListedAt };
}

describe('§DYN.2.3 — selectFeatured', () => {
  it('constante del contrato: recientes = top 10', () => expect(FEATURED_NEW_ARRIVAL_TOP).toBe(10));

  it('DYN-B1 (puro) — los de `pool` salen SIEMPRE del top-60 por P (100 candidatos, 50 semillas)', () => {
    const cands = Array.from({ length: 100 }, (_, i) => cand(i, 1000 + i * 7)); // c099 la más cara
    const top60 = new Set(
      [...cands].sort((a, b) => b.priceCents - a.priceCents).slice(0, 60).map(featuredKeyOf),
    );
    for (let s = 0; s < 50; s++) {
      const r = selectFeatured(cands, EF, DIALS, seededRng(`seed-${s}`));
      expect(r.poolCount).toBe(60);
      const pool = r.items.filter((x) => x.slotKind === 'pool');
      expect(pool).toHaveLength(10); // sin recientes ⇒ los 10 lugares del pool (923)
      for (const it of pool) expect(top60.has(featuredKeyOf(it))).toBe(true);
    }
  });

  it('empate de P ⇒ K asc decide quién entra al pool (determinista)', () => {
    const cands = [cand(2, 500), cand(1, 500), cand(3, 100)];
    const r = selectFeatured(cands, EF, { ...DIALS, poolSize: 1, randomSlots: 1, newArrivalSlots: 0 }, seededRng('x'));
    expect(r.items.map((x) => x.cardId)).toEqual(['c001']);
  });

  it('DYN-B4 (puro) — publicadas hace 1, 3 y 8 días: la de 8 nunca `new_arrival`; las elegidas en 1-2; nada repetido', () => {
    const cands = [
      cand(1, 900, daysAgo(1)),
      cand(3, 800, daysAgo(3)),
      cand(8, 950, daysAgo(8)),
      ...Array.from({ length: 30 }, (_, i) => cand(100 + i, 500 + i)),
    ];
    for (let s = 0; s < 30; s++) {
      const r = selectFeatured(cands, EF, DIALS, seededRng(`na-${s}`));
      const na = r.items.filter((x) => x.slotKind === 'new_arrival');
      expect(na.map((x) => x.position).sort()).toEqual([1, 2]);
      expect(new Set(na.map((x) => x.cardId))).toEqual(new Set(['c001', 'c003']));
      expect(new Set(r.items.map(featuredKeyOf)).size).toBe(r.items.length);
      expect(r.items.map((x) => x.position)).toEqual(r.items.map((_, i) => i + 1));
      expect(r.newArrivalCandidates).toBe(2);
      expect(r.items).toHaveLength(10);
    }
  });

  it('justo en el borde de la ventana (= 7 días exactos) NO es reciente (`>` estricto)', () => {
    const r = selectFeatured([cand(1, 900, daysAgo(7)), cand(2, 100)], EF, DIALS, seededRng('b'));
    expect(r.items.every((x) => x.slotKind === 'pool')).toBe(true);
  });

  it('recientes: solo el top 10 por P entra al sorteo (las baratas de la semana no)', () => {
    const recientes = Array.from({ length: 15 }, (_, i) => cand(i, 100 + i, daysAgo(1))); // c014 la más cara
    for (let s = 0; s < 40; s++) {
      const r = selectFeatured(recientes, EF, DIALS, seededRng(`t-${s}`));
      for (const x of r.items.filter((i) => i.slotKind === 'new_arrival')) {
        expect(Number(x.cardId.slice(1))).toBeGreaterThanOrEqual(5);
      }
    }
  });

  it('sin recientes, o con el dial en 0 ⇒ todo `pool`', () => {
    const cands = [cand(1, 900, daysAgo(1)), ...Array.from({ length: 20 }, (_, i) => cand(10 + i, 100))];
    const r = selectFeatured(cands, EF, { ...DIALS, newArrivalSlots: 0 }, seededRng('z'));
    expect(r.items.every((x) => x.slotKind === 'pool')).toBe(true);
    expect(r.items).toHaveLength(8);
  });

  it('DYN-B6 — 5 elegibles ⇒ 5 sin repetir; 0 ⇒ selección vacía', () => {
    const five = Array.from({ length: 5 }, (_, i) => cand(i, 100 * (i + 1)));
    const r = selectFeatured(five, EF, DIALS, seededRng('5'));
    expect(r.items).toHaveLength(5);
    expect(new Set(r.items.map(featuredKeyOf)).size).toBe(5);
    expect(selectFeatured([], EF, DIALS, seededRng('0')).items).toEqual([]);
  });

  it('una reciente que también está en el pool no sale dos veces', () => {
    const cands = [cand(1, 99_999, daysAgo(1)), ...Array.from({ length: 9 }, (_, i) => cand(10 + i, 100))];
    const r = selectFeatured(cands, EF, DIALS, seededRng('dup'));
    expect(r.items).toHaveLength(10);
    expect(new Set(r.items.map(featuredKeyOf)).size).toBe(10);
  });

  it('`seededRng` es reproducible (misma semilla ⇒ mismo sorteo) — la auditoría puede rehacerlo', () => {
    const cands = Array.from({ length: 80 }, (_, i) => cand(i, 1000 + i));
    const a = selectFeatured(cands, EF, DIALS, seededRng('abc'));
    const b = selectFeatured(cands, EF, DIALS, seededRng('abc'));
    expect(a).toEqual(b);
  });
});
