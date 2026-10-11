/**
 * accessory-cart.ts — 💰 la aritmética PURA del carrito de accesorios (API_CONTRACT §AC.4, §AC.19.4). Sin BD.
 *
 * - `allocateQuoteStock`: el orden normativo de existencias de `quote` (§AC.19.4 paso 4): **paquetes primero**, en el
 *   orden de la petición (`index`), todo o nada; **luego** los renglones sueltos con el remanente, recortados a
 *   `min(pedido, remanente)`. El paquete no se parte y el suelto sí: así se vende lo más posible.
 * - `wantsOf`: el apartado ÚNICO por accesorio de `session` (§AC.19.4 paso 5): Σ sueltos + Σ componentes. La sesión es
 *   estricta (todo o nada), ⛔ no aplica el orden de `quote`.
 * - `lineIvaCents`: el IVA informado de UNA línea (§AC.2 (4)): `lineTotal − taxBaseCentsOf(lineTotal, r)`.
 * - `sameLooseCart`: el «mismo multiconjunto (accessoryId, quantity)» del reuso (§AC.4).
 */
import { taxBaseCentsOf } from '../../common/money';

export interface LooseWant {
  accessoryId: string;
  quantity: number;
}

export interface BundleNeed {
  /** Posición en `deckPulls` de la petición. */
  index: number;
  components: { accessoryId: string; quantity: number }[];
}

export interface QuoteAllocation {
  acceptedBundleIndexes: number[];
  rejectedBundleIndexes: number[];
  /** Por renglón suelto, en el orden recibido: lo pedido, lo cotizado y el remanente que tenía cuando le tocó. */
  loose: { accessoryId: string; requested: number; quoted: number; remaining: number }[];
}

export function allocateQuoteStock(
  bundles: readonly BundleNeed[],
  loose: readonly LooseWant[],
  available: ReadonlyMap<string, number>,
): QuoteAllocation {
  const left = new Map<string, number>(available);
  const get = (id: string) => Math.max(0, left.get(id) ?? 0);
  const accepted: number[] = [];
  const rejected: number[] = [];
  // 1. Paquetes primero, en el orden de la petición; todo o nada.
  for (const b of [...bundles].sort((x, y) => x.index - y.index)) {
    const need = new Map<string, number>();
    for (const c of b.components) need.set(c.accessoryId, (need.get(c.accessoryId) ?? 0) + c.quantity);
    if (![...need].every(([id, q]) => get(id) >= q)) {
      rejected.push(b.index);
      continue;
    }
    for (const [id, q] of need) left.set(id, get(id) - q);
    accepted.push(b.index);
  }
  // 2. Luego los sueltos, con el remanente.
  const out: QuoteAllocation['loose'] = [];
  for (const l of loose) {
    const remaining = get(l.accessoryId);
    const quoted = Math.min(l.quantity, remaining);
    left.set(l.accessoryId, remaining - quoted);
    out.push({ accessoryId: l.accessoryId, requested: l.quantity, quoted, remaining });
  }
  return { acceptedBundleIndexes: accepted, rejectedBundleIndexes: rejected, loose: out };
}

export function wantsOf(loose: readonly LooseWant[], bundles: readonly BundleNeed[]): Map<string, number> {
  const out = new Map<string, number>();
  const add = (id: string, q: number) => out.set(id, (out.get(id) ?? 0) + q);
  for (const l of loose) add(l.accessoryId, l.quantity);
  for (const b of bundles) for (const c of b.components) add(c.accessoryId, c.quantity);
  return out;
}

export function lineIvaCents(lineTotalCents: number, ivaRatePct: number): number {
  return lineTotalCents - taxBaseCentsOf(lineTotalCents, ivaRatePct);
}

export function sameLooseCart(a: readonly LooseWant[], b: readonly LooseWant[]): boolean {
  const key = (xs: readonly LooseWant[]) => {
    const m = new Map<string, number>();
    for (const x of xs) m.set(x.accessoryId, (m.get(x.accessoryId) ?? 0) + x.quantity);
    return [...m]
      .sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))
      .map(([id, q]) => `${id}:${q}`)
      .join('|');
  };
  return key(a) === key(b);
}
