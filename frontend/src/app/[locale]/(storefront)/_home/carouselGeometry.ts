/**
 * Geometría de la pista del carrusel «Piezas destacadas» (DESIGN_SYSTEM §23.3, §23.15 nº2).
 *
 * Todo lo que decide **a dónde** se desplaza la pista vive aquí, en funciones PURAS sobre números.
 * La razón es doble:
 *
 *  1. **R6 (§23.0):** «un solo paso por tic: una teja, aterrizando en su punto de `snap`». El destino
 *     se calcula desde el `offsetLeft` de la teja entrante — **nunca** con `scrollBy(clientWidth ×
 *     0,8)`, que es el paso de las *flechas* y deja media teja cortada por el borde izquierdo.
 *  2. **jsdom no tiene layout**: `getBoundingClientRect()` devuelve ceros y `offsetLeft`/`clientWidth`
 *     son 0 para todo. Separando la lectura del DOM (`readTrackGeometry`) del cálculo del destino
 *     (`nextScrollTarget`/`prevScrollTarget`/`pageScrollTarget`) el cálculo queda cubierto por tests
 *     de verdad, y lo único no cubierto es la lectura — tres accesos a propiedades del DOM.
 */

/** Holgura en px: el mismo 4 que ya usaba el apagado de las flechas (§20.3). */
export const SCROLL_TOLERANCE = 4;

/** Paso de las FLECHAS: ~una «página» (§20.3, §23.3 — las flechas no cambian de paso). */
export const ARROW_PAGE_FRACTION = 0.8;

export interface TrackGeometry {
  /** Posición actual del scroller. */
  scrollLeft: number;
  /** Tope de desplazamiento (`scrollWidth − clientWidth`), nunca negativo. */
  maxScroll: number;
  /** Ancho visible de la pista (el que fija el paso de la flecha). */
  clientWidth: number;
  /**
   * Punto de `snap` de cada teja, en coordenadas de `scrollLeft`. `offsets[0]` es **0** a propósito:
   * el reposo natural del scroller es su origen, y ahí la primera teja conserva el `gutter` de la
   * página (§20.3). De la 1 en adelante, el punto de snap es la distancia de la teja al borde de la
   * caja de padding de la pista, que es lo que `scroll-snap-align: start` alinea.
   */
  offsets: number[];
}

/** ¿La pista desborda? Si no, no hay nada que rotar ni que frenar (§23.4d nº3). */
export function trackOverflows(g: TrackGeometry): boolean {
  return g.maxScroll > SCROLL_TOLERANCE;
}

/**
 * Lee la geometría del DOM. `offsetLeft` es posición de LAYOUT (no cambia con el scroll) y la teja
 * y la pista comparten `offsetParent` (la pista no está posicionada), así que la resta da la
 * distancia real; `clientLeft` descuenta el borde izquierdo (hoy 0, pero la cuenta es la correcta).
 */
export function readTrackGeometry(track: HTMLElement): TrackGeometry {
  const children = Array.from(track.children) as HTMLElement[];
  const base = track.offsetLeft + track.clientLeft;
  return {
    scrollLeft: track.scrollLeft,
    maxScroll: Math.max(0, track.scrollWidth - track.clientWidth),
    clientWidth: track.clientWidth,
    offsets: children.map((child, i) => (i === 0 ? 0 : Math.max(0, child.offsetLeft - base))),
  };
}

function clamp(value: number, g: TrackGeometry): number {
  return Math.max(0, Math.min(value, g.maxScroll));
}

/**
 * Destino del **tic**: la teja siguiente, y solo esa (R6). `null` ⇒ no queda pista por delante, que
 * es **el mismo predicado que apaga la flecha «siguiente»** (`canNext === false`) y por tanto el que
 * lleva la rotación a TERMINADO (§23.6). Se compara contra el destino **ya recortado** al tope: si
 * la última teja no cabe entera, su punto de snap queda más allá de `maxScroll` y desplazarse ahí no
 * movería nada — eso ES el final, no un tic que se pierde.
 */
export function nextScrollTarget(g: TrackGeometry): number | null {
  const raw = g.offsets.find((o) => o > g.scrollLeft + SCROLL_TOLERANCE);
  if (raw === undefined) return null;
  const target = clamp(raw, g);
  return target > g.scrollLeft + SCROLL_TOLERANCE ? target : null;
}

/** Destino de un paso hacia atrás de UNA teja. `null` ⇒ ya está en el origen. */
export function prevScrollTarget(g: TrackGeometry): number | null {
  const candidates = g.offsets.filter((o) => o < g.scrollLeft - SCROLL_TOLERANCE);
  if (candidates.length === 0) return null;
  const target = clamp(candidates[candidates.length - 1], g);
  return target < g.scrollLeft - SCROLL_TOLERANCE ? target : null;
}

/**
 * Destino de una **flecha** (§20.3): sigue moviendo ~una página (`0,8 × clientWidth`) — §23.13 nº13
 * prohíbe cambiarle el paso —, pero **aterriza en el punto de snap de una teja** en vez de en un
 * píxel arbitrario. Ésa era la mitad del defecto que §23.15 nº2 señala: el 0,8 × ancho no es
 * múltiplo del paso de teja, así que la flecha dejaba reposos con media teja cortada por el borde
 * izquierdo. El paso no cambia; lo que cambia es que el aterrizaje ya no es a mitad de teja.
 *
 * Garantiza **al menos una teja** de avance/retroceso: con la pista muy ancha y una página muy
 * estrecha, redondear «a la teja más cercana» podría no mover nada.
 */
export function pageScrollTarget(g: TrackGeometry, dir: 1 | -1): number | null {
  const raw = g.scrollLeft + dir * Math.round(g.clientWidth * ARROW_PAGE_FRACTION);
  if (dir === 1) {
    const ahead = g.offsets.filter((o) => o > g.scrollLeft + SCROLL_TOLERANCE);
    if (ahead.length === 0) return null;
    const reachable = ahead.filter((o) => o <= raw);
    const target = clamp(reachable.length > 0 ? reachable[reachable.length - 1] : ahead[0], g);
    return target > g.scrollLeft + SCROLL_TOLERANCE ? target : null;
  }
  const behind = g.offsets.filter((o) => o < g.scrollLeft - SCROLL_TOLERANCE);
  if (behind.length === 0) return null;
  const reachable = behind.filter((o) => o >= raw);
  const target = clamp(reachable.length > 0 ? reachable[0] : behind[0], g);
  return target < g.scrollLeft - SCROLL_TOLERANCE ? target : null;
}

/**
 * Desplaza la pista. `scrollTo` con opciones no existe en jsdom (ni en navegadores muy viejos), así
 * que hay una única caída documentada: asignar `scrollLeft`, que es **movimiento cero** — nunca una
 * animación distinta ni un `scrollBy` disfrazado.
 */
export function scrollTrackTo(track: HTMLElement, left: number, behavior: ScrollBehavior): void {
  if (typeof track.scrollTo === 'function') {
    track.scrollTo({ left, behavior });
    return;
  }
  track.scrollLeft = left;
}
