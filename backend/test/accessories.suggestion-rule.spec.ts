/**
 * accessories.suggestion-rule.spec.ts — **AC-B23** (mitad pura) · API_CONTRACT §AC.3 «suggestions», criterios 718/719.
 *
 * La regla, literal del contrato: candidatos = `active ∧ disponible > 0 ∧ category ≠ energy ∧ id ∉ exclude` (el filtro
 * de candidatos es de la consulta; aquí se fija el ORDEN y el CORTE, y que la regla tampoco deja pasar energías ni
 * agotados si se los dan):
 *   1. los `suggested`, por `lower(name)`;
 *   2. los más vendidos en 30 días (Σ quantity), descendente, desempate por `lower(name)`;
 *   3. el resto, por `lower(name)`.
 * Se corta en N (dial `accessory_suggestion_count`, 0..6; 0 apaga).
 */
import { rankSuggestions, SuggestionCandidate } from '../src/modules/accessories/suggestion-rule';

const c = (id: string, name: string, over: Partial<SuggestionCandidate> = {}): SuggestionCandidate => ({
  id,
  name,
  category: 'sleeves',
  suggested: false,
  availableQty: 5,
  soldLast30d: 0,
  ...over,
});

describe('AC-B23 — rankSuggestions (regla pura de «¿Te falta algo?»)', () => {
  it('2 «Sugerido» + 5 activos, N=3 ⇒ los 2 sugeridos (por nombre) + el más vendido en 30 días', () => {
    const cands = [
      c('a', 'Toploader'),
      c('b', 'binder azul', { suggested: true }),
      c('c', 'Playmat', { soldLast30d: 4 }),
      c('d', 'Deck box', { soldLast30d: 9 }),
      c('e', 'Alfombrilla'),
      c('f', 'Aaa fundas', { suggested: true }),
      c('g', 'Zeta'),
    ];
    expect(rankSuggestions(cands, 3).map((x) => x.id)).toEqual(['f', 'b', 'd']);
  });

  it('orden completo: sugeridos → vendidos desc (empate por nombre sin mayúsculas) → resto por nombre', () => {
    const cands = [
      c('r2', 'zz resto'),
      c('v1', 'beta', { soldLast30d: 3 }),
      c('s1', 'Mango', { suggested: true, soldLast30d: 100 }),
      c('v2', 'Alfa', { soldLast30d: 3 }),
      c('r1', 'AA resto'),
      c('v3', 'gama', { soldLast30d: 7 }),
    ];
    expect(rankSuggestions(cands, 6).map((x) => x.id)).toEqual(['s1', 'v3', 'v2', 'v1', 'r1', 'r2']);
  });

  it('el dial cambia N: 0 ⇒ nada; 1 ⇒ uno; más que candidatos ⇒ todos', () => {
    const cands = [c('a', 'a', { suggested: true }), c('b', 'b')];
    expect(rankSuggestions(cands, 0)).toEqual([]);
    expect(rankSuggestions(cands, 1).map((x) => x.id)).toEqual(['a']);
    expect(rankSuggestions(cands, 6).map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('nunca energía ni agotado, aunque la consulta se los pasara (P-EN-2, `D-AC-3`)', () => {
    const cands = [
      c('en', 'Energía Fuego', { category: 'energy', soldLast30d: 50 }),
      c('ago', 'Agotado', { availableQty: 0, suggested: true }),
      c('ok', 'Funda'),
    ];
    expect(rankSuggestions(cands, 6).map((x) => x.id)).toEqual(['ok']);
  });
});
