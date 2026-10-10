/**
 * box-fit.ts — 💰 LA CAJA DECIDE EL ENVÍO (API_CONTRACT §AC.7, v1.86 + v1.86.1). PURO: sin BD, sin reloj.
 *
 * - `units`: una por UNIDAD de cada renglón `accessory` con `category ≠ energy` y las cuatro medidas capturadas. Cartas,
 *   sellado, energías sueltas y paquetes NO entran (no hay medidas en la BD y F3 prohíbe inventarlas; P-AC-5,
 *   `ARCHITECTURE §4.AC (f)`). Una energía con medidas capturadas tampoco entra (v1.86.1, AC-B45).
 * - `boxes`: las `ShippingPackage` `active ∧ customerFeeCents IS NOT NULL` (las lee quien llama).
 * - `units` vacío o `boxes` vacío ⇒ `null`: la tarifa de hoy, bit a bit (I-AC-5, criterio 725).
 * - Una caja sirve ⇔ cada unidad, con sus medidas ORDENADAS, cabe en las de la caja ordenadas (mm = cm × 10) ∧
 *   Σ volumen(unidades) ≤ volumen(caja). Gana la que sirve con MENOR volumen; desempate `customerFeeCents`, `sortOrder`,
 *   `code`. Ninguna sirve ⇒ la de MAYOR volumen (mismo desempate) con `review = true` (F3, criterio 728): solo un aviso
 *   para quien prepara; ⛔ no retiene nada ni genera cargo posterior.
 * - Tarifa al cliente: `max(E_base, customerFeeCents)` (recomendación de P-AC-2). Si el dueño contesta «la de la caja»,
 *   se quita el `max` en `shippingFeeWithBox` y nada más cambia.
 */

export interface FitUnit {
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  weightG: number;
}

export interface FitBox {
  code: string;
  label: string;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  customerFeeCents: number;
  sortOrder: number;
}

export interface BoxChoice {
  box: FitBox;
  review: boolean;
}

/** Lo que se congela en `Order.shippingBoxSnapshot` (§AC.1). */
export interface ShippingBoxSnapshot {
  code: string;
  label: string;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  customerFeeCents: number;
  baseFeeCents: number;
  contentWeightG: number;
}

/** El renglón visto por la caja: cantidad y lo que se lee del accesorio. */
export interface FitSourceLine {
  quantity: number;
  accessory: { category: string; lengthMm: number | null; widthMm: number | null; heightMm: number | null; weightG: number | null };
}

const sortedDesc = (a: number, b: number, c: number): [number, number, number] => {
  const s = [a, b, c].sort((x, y) => y - x);
  return [s[0], s[1], s[2]];
};

const boxMm = (b: FitBox) => sortedDesc(b.lengthCm * 10, b.widthCm * 10, b.heightCm * 10);
const boxVolume = (b: FitBox) => b.lengthCm * 10 * (b.widthCm * 10) * (b.heightCm * 10);
const unitVolume = (u: FitUnit) => u.lengthMm * u.widthMm * u.heightMm;

/** `customerFeeCents`, `sortOrder`, `code` — el desempate de §AC.7. */
function tieBreak(a: FitBox, b: FitBox): number {
  if (a.customerFeeCents !== b.customerFeeCents) return a.customerFeeCents - b.customerFeeCents;
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  return a.code < b.code ? -1 : a.code > b.code ? 1 : 0;
}

function fits(units: readonly FitUnit[], box: FitBox, totalVolume: number): boolean {
  const [bl, bw, bh] = boxMm(box);
  for (const u of units) {
    const [ul, uw, uh] = sortedDesc(u.lengthMm, u.widthMm, u.heightMm);
    if (ul > bl || uw > bw || uh > bh) return false;
  }
  return totalVolume <= boxVolume(box);
}

export function chooseBox(units: FitUnit[], boxes: FitBox[]): BoxChoice | null {
  if (units.length === 0 || boxes.length === 0) return null;
  const total = units.reduce((a, u) => a + unitVolume(u), 0);
  const candidates = boxes.filter((b) => fits(units, b, total));
  if (candidates.length > 0) {
    const best = [...candidates].sort((a, b) => boxVolume(a) - boxVolume(b) || tieBreak(a, b))[0];
    return { box: best, review: false };
  }
  const biggest = [...boxes].sort((a, b) => boxVolume(b) - boxVolume(a) || tieBreak(a, b))[0];
  return { box: biggest, review: true };
}

/** Una `FitUnit` por unidad de cada renglón que NO es energía y tiene las cuatro medidas (⛔ medidas inventadas). */
export function fitUnitsOf(lines: readonly FitSourceLine[]): FitUnit[] {
  const out: FitUnit[] = [];
  for (const l of lines) {
    const a = l.accessory;
    if (a.category === 'energy') continue;
    if (a.lengthMm == null || a.widthMm == null || a.heightMm == null || a.weightG == null) continue;
    for (let i = 0; i < l.quantity; i += 1) out.push({ lengthMm: a.lengthMm, widthMm: a.widthMm, heightMm: a.heightMm, weightG: a.weightG });
  }
  return out;
}

/** Tarifa al cliente con IVA dentro: `null` ⇒ `E_base`; con caja ⇒ `max(E_base, customerFeeCents)` (P-AC-2). */
export function shippingFeeWithBox(baseFeeCents: number, choice: BoxChoice | null): number {
  if (!choice) return baseFeeCents;
  return Math.max(baseFeeCents, choice.box.customerFeeCents);
}

/** El snapshot que congela la sesión (`baseFeeCents = E_base`, `contentWeightG = Σ weightG` de las unidades). */
export function boxSnapshotOf(choice: BoxChoice | null, baseFeeCents: number, units: readonly FitUnit[]): ShippingBoxSnapshot | null {
  if (!choice) return null;
  const b = choice.box;
  return {
    code: b.code,
    label: b.label,
    lengthCm: b.lengthCm,
    widthCm: b.widthCm,
    heightCm: b.heightCm,
    customerFeeCents: b.customerFeeCents,
    baseFeeCents,
    contentWeightG: units.reduce((a, u) => a + u.weightG, 0),
  };
}
