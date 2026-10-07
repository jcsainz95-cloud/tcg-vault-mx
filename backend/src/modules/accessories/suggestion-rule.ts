/**
 * suggestion-rule.ts — «¿Te falta algo?» (API_CONTRACT §AC.3 `suggestions`, AC.5; criterios 718/719). PURA.
 *
 * Candidatos = `active ∧ disponible > 0 ∧ category ≠ energy ∧ id ∉ exclude` (la consulta filtra `active` y `exclude`;
 * aquí se vuelve a exigir disponible > 0 y no energía, para que la regla no dependa de que la consulta lo haga bien).
 * Orden:
 *   1. los `suggested`, por `lower(name)`;
 *   2. los más vendidos en 30 días (Σ quantity de renglones `accessory` en pedidos `settled` con `settledAt ≥ now − 30 d`),
 *      descendente, desempate por `lower(name)`;
 *   3. el resto, por `lower(name)`.
 * Se corta en N (dial `accessory_suggestion_count`). ⛔ Las energías NUNCA entran (P-EN-2, F3; `D-AC-3`).
 * Desempate final por `id` para que el orden sea total (dos nombres iguales no bailan entre peticiones).
 */
import { AccessoryCategory } from '@prisma/client';

export interface SuggestionCandidate {
  id: string;
  name: string;
  category: AccessoryCategory;
  suggested: boolean;
  availableQty: number;
  soldLast30d: number;
}

const byName = (a: SuggestionCandidate, b: SuggestionCandidate): number => {
  const x = a.name.toLowerCase();
  const y = b.name.toLowerCase();
  if (x !== y) return x < y ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
};

export function rankSuggestions<T extends SuggestionCandidate>(candidates: readonly T[], n: number): T[] {
  if (!Number.isInteger(n) || n <= 0) return [];
  const pool = candidates.filter((c) => c.category !== 'energy' && c.availableQty > 0);
  const suggested = pool.filter((c) => c.suggested).sort(byName);
  const sold = pool
    .filter((c) => !c.suggested && c.soldLast30d > 0)
    .sort((a, b) => (b.soldLast30d !== a.soldLast30d ? b.soldLast30d - a.soldLast30d : byName(a, b)));
  const rest = pool.filter((c) => !c.suggested && c.soldLast30d <= 0).sort(byName);
  return [...suggested, ...sold, ...rest].slice(0, n);
}
