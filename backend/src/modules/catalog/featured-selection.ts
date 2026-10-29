/**
 * featured-selection.ts — v1.113⟨portada⟩ (API_CONTRACT §DYN.2.3, ARCHITECTURE §4.DYN (c)): el sorteo diario de Destacadas,
 * PURO (sin BD, sin reloj, sin azar propio: el `rng` entra por parámetro, sembrado con la semilla que se guarda en
 * `FeaturedSelection.seed` ⇒ reproducible en auditoría).
 *
 * ⛔ Nada aquí ordena Destacadas «por precio» para SERVIRLAS: el precio solo decide quién ENTRA al pool (I-1); el orden servido
 * es el del sorteo.
 */
import { createHash } from 'node:crypto';
import { Finish, ProductType } from '@prisma/client';

/** §DYN.2.3 — las recién llegadas se sortean entre las 10 de mayor precio de la ventana (constante, PROJECT §DYN.1). */
export const FEATURED_NEW_ARRIVAL_TOP = 10;

export interface FeaturedKey {
  cardId: string;
  productType: ProductType;
  gradeKey: string;
  finish: Finish;
}

/** Un grupo vendible raw|graded (la teja de la rejilla, §4.9a) con su `P` del día y su «primera publicación». */
export interface FeaturedCandidate extends FeaturedKey {
  /** `P` — el precio exhibido (IVA dentro) del representante del grupo. */
  priceCents: number;
  /** MIN(firstListedAt) de las piezas VIVAS del grupo (ARCHITECTURE §4.DYN (c)); `null` ⇒ nunca es recién llegada. */
  firstListedAt: Date | null;
}

export interface FeaturedDials {
  poolSize: number;
  randomSlots: number;
  newArrivalSlots: number;
  windowDays: number;
}

export interface FeaturedPick extends FeaturedKey {
  position: number;
  slotKind: 'new_arrival' | 'pool';
}

export interface FeaturedSelectionResult {
  items: FeaturedPick[];
  poolCount: number;
  newArrivalCandidates: number;
}

/** La llave K como texto: también es el desempate `K asc` del contrato. */
export function featuredKeyOf(k: FeaturedKey): string {
  return `${k.cardId}|${k.productType}|${k.gradeKey}|${k.finish}`;
}

/** (P desc, K asc). */
function byValue(a: FeaturedCandidate, b: FeaturedCandidate): number {
  if (a.priceCents !== b.priceCents) return b.priceCents - a.priceCents;
  const ka = featuredKeyOf(a);
  const kb = featuredKeyOf(b);
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}

/** Sorteo SIN reemplazo de `n` elementos (Fisher–Yates parcial), en el orden en que salen. */
function draw<T>(from: readonly T[], n: number, rng: () => number): T[] {
  const a = [...from];
  const k = Math.max(0, Math.min(n, a.length));
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(rng() * (a.length - i));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, k);
}

/**
 * PRNG determinista a partir de una semilla de texto (los 32 bytes hex de `FeaturedSelection.seed`): SHA-256 ⇒ estado de
 * `sfc32`. No es criptográfico ni necesita serlo: la imprevisibilidad la da la SEMILLA (aleatoria, `randomBytes(32)`).
 */
export function seededRng(seed: string): () => number {
  const h = createHash('sha256').update(seed).digest();
  let a = h.readUInt32LE(0);
  let b = h.readUInt32LE(4);
  let c = h.readUInt32LE(8);
  let d = h.readUInt32LE(12);
  return () => {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

/** §DYN.2.3 `selectFeatured`. */
export function selectFeatured(
  cands: readonly FeaturedCandidate[],
  effectiveFrom: Date,
  dials: FeaturedDials,
  rng: () => number,
): FeaturedSelectionResult {
  const sorted = [...cands].sort(byValue);
  const pool = sorted.slice(0, Math.max(0, dials.poolSize));
  const windowStart = effectiveFrom.getTime() - dials.windowDays * 24 * 60 * 60 * 1000;
  const recientes = sorted
    .filter((c) => c.firstListedAt != null && c.firstListedAt.getTime() > windowStart)
    .slice(0, FEATURED_NEW_ARRIVAL_TOP);
  const na = draw(recientes, Math.min(dials.newArrivalSlots, recientes.length), rng);
  const naKeys = new Set(na.map(featuredKeyOf));
  const poolRest = pool.filter((c) => !naKeys.has(featuredKeyOf(c)));
  const rest = draw(poolRest, Math.min(dials.randomSlots + dials.newArrivalSlots - na.length, poolRest.length), rng);
  const items: FeaturedPick[] = [
    ...na.map((c) => ({ slotKind: 'new_arrival' as const, c })),
    ...rest.map((c) => ({ slotKind: 'pool' as const, c })),
  ].map(({ slotKind, c }, i) => ({
    position: i + 1,
    slotKind,
    cardId: c.cardId,
    productType: c.productType,
    gradeKey: c.gradeKey,
    finish: c.finish,
  }));
  return { items, poolCount: pool.length, newArrivalCandidates: recientes.length };
}
