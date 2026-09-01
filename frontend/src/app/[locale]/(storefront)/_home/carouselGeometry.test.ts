import { describe, it, expect } from 'vitest';
import {
  SCROLL_TOLERANCE,
  nextScrollTarget,
  pageScrollTarget,
  prevScrollTarget,
  readTrackGeometry,
  scrollTrackTo,
  trackOverflows,
  type TrackGeometry,
} from './carouselGeometry';

/**
 * Geometría del carrusel (§23.3, R6). Estas son las pruebas que **sí** puede correr jsdom: el
 * cálculo del destino es aritmética pura sobre números, y ahí es donde vive la regla dura («una
 * teja por tic, aterrizando en su punto de snap»). Lo único que jsdom no puede darnos es el layout
 * real — por eso `readTrackGeometry` se prueba con las propiedades del DOM sobrescritas a mano, y
 * eso es una simulación declarada, no una medición.
 */

const GUTTER = 20;
const LEAD_W = 236;
const TILE_W = 160;
const GAP = 16;
const VIEWPORT = 390;

/** Posición de layout de cada teja: gutter + anchos + gaps acumulados. */
function tilePositions(count: number): number[] {
  const out: number[] = [];
  let x = GUTTER;
  for (let i = 0; i < count; i += 1) {
    out.push(x);
    x += (i === 0 ? LEAD_W : TILE_W) + GAP;
  }
  return out;
}

function fakeTrack(count: number, scrollLeft = 0): HTMLElement {
  const track = document.createElement('div');
  const positions = tilePositions(count);
  positions.forEach((pos, i) => {
    const child = document.createElement('a');
    Object.defineProperty(child, 'offsetLeft', { configurable: true, get: () => pos });
    track.appendChild(child);
  });
  const contentWidth = positions[count - 1] + TILE_W + GUTTER;
  Object.defineProperty(track, 'offsetLeft', { configurable: true, get: () => 0 });
  Object.defineProperty(track, 'clientLeft', { configurable: true, get: () => 0 });
  Object.defineProperty(track, 'clientWidth', { configurable: true, get: () => VIEWPORT });
  Object.defineProperty(track, 'scrollWidth', { configurable: true, get: () => contentWidth });
  track.scrollLeft = scrollLeft;
  return track;
}

function geom(over: Partial<TrackGeometry> = {}): TrackGeometry {
  return {
    scrollLeft: 0,
    maxScroll: 1118,
    clientWidth: VIEWPORT,
    offsets: [0, 272, 448, 624, 800, 976, 1152, 1328],
    ...over,
  };
}

describe('carouselGeometry · readTrackGeometry', () => {
  it('la primera teja reposa en 0 (el origen del scroller conserva el gutter de la página)', () => {
    const g = readTrackGeometry(fakeTrack(8));
    expect(g.offsets[0]).toBe(0);
  });

  it('el punto de snap de cada teja sale de su offsetLeft, no de un ancho × 0,8', () => {
    const g = readTrackGeometry(fakeTrack(8));
    // 20 (gutter) + 236 (líder) + 16 (gap) = 272 · luego 160 + 16 por teja.
    expect(g.offsets).toEqual([0, 272, 448, 624, 800, 976, 1152, 1328]);
    // El paso de la flecha (0,8 × 390 = 312) NO coincide con ningún punto de snap: ése era el
    // defecto de §23.15 nº2 — un reposo a 312 deja la teja 1 cortada por el borde izquierdo.
    expect(g.offsets).not.toContain(Math.round(VIEWPORT * 0.8));
  });

  it('maxScroll = scrollWidth − clientWidth y nunca es negativo', () => {
    expect(readTrackGeometry(fakeTrack(8)).maxScroll).toBe(20 + 236 + 7 * 176 + 20 - VIEWPORT);
    const narrow = fakeTrack(1);
    Object.defineProperty(narrow, 'scrollWidth', { configurable: true, get: () => 10 });
    expect(readTrackGeometry(narrow).maxScroll).toBe(0);
  });

  it('trackOverflows distingue «hay pista» de «todo cabe» (§23.4d nº3)', () => {
    expect(trackOverflows(geom())).toBe(true);
    expect(trackOverflows(geom({ maxScroll: 0 }))).toBe(false);
    expect(trackOverflows(geom({ maxScroll: SCROLL_TOLERANCE }))).toBe(false);
  });
});

describe('carouselGeometry · el tic avanza UNA teja (R6)', () => {
  it('desde el origen entra la teja 1, no una página', () => {
    expect(nextScrollTarget(geom({ scrollLeft: 0 }))).toBe(272);
  });

  it('cada tic avanza exactamente al siguiente punto de snap', () => {
    let scrollLeft = 0;
    const visited: number[] = [];
    for (let i = 0; i < 10; i += 1) {
      const target = nextScrollTarget(geom({ scrollLeft }));
      if (target === null) break;
      visited.push(target);
      scrollLeft = target;
    }
    // Los cinco puntos de snap alcanzables + el tope de la pista (la última teja no cabe entera).
    expect(visited).toEqual([272, 448, 624, 800, 976, 1118]);
  });

  it('devuelve null en el extremo — el MISMO predicado que apaga la flecha «siguiente» (§23.6)', () => {
    expect(nextScrollTarget(geom({ scrollLeft: 1118 }))).toBeNull();
  });

  it('nunca propone un destino más allá del tope, aunque el punto de snap lo rebase', () => {
    const target = nextScrollTarget(geom({ scrollLeft: 976 }));
    expect(target).toBe(1118);
    expect(target).toBeLessThanOrEqual(geom().maxScroll);
  });

  it('con una sola teja no hay tic posible', () => {
    expect(nextScrollTarget(geom({ offsets: [0], maxScroll: 0 }))).toBeNull();
  });
});

describe('carouselGeometry · prevScrollTarget', () => {
  it('retrocede una teja y llega al origen', () => {
    expect(prevScrollTarget(geom({ scrollLeft: 448 }))).toBe(272);
    expect(prevScrollTarget(geom({ scrollLeft: 272 }))).toBe(0);
    expect(prevScrollTarget(geom({ scrollLeft: 0 }))).toBeNull();
  });
});

describe('carouselGeometry · las flechas conservan el paso de página pero aterrizan en un snap', () => {
  it('avanza ~una página (0,8 × ancho) SIN pasarse, y el reposo es un punto de snap', () => {
    // 0,8 × 390 = 312 ⇒ la teja alcanzable más lejana sin pasarse es la 1 (272).
    const target = pageScrollTarget(geom({ scrollLeft: 0 }), 1);
    expect(target).toBe(272);
    expect(geom().offsets).toContain(target);
  });

  it('en una pista ancha salta varias tejas de golpe (el paso NO cambia, §23.13 nº13)', () => {
    // 0,8 × 1200 = 960 ⇒ se planta en el punto de snap 800, cuatro tejas más allá.
    expect(pageScrollTarget(geom({ scrollLeft: 0, clientWidth: 1200, maxScroll: 2000 }), 1)).toBe(800);
  });

  it('garantiza al menos UNA teja aunque la página sea más corta que la teja', () => {
    expect(pageScrollTarget(geom({ scrollLeft: 0, clientWidth: 100 }), 1)).toBe(272);
  });

  it('hacia atrás aterriza en un snap y no se pasa del origen', () => {
    expect(pageScrollTarget(geom({ scrollLeft: 976 }), -1)).toBe(800);
    expect(pageScrollTarget(geom({ scrollLeft: 272, clientWidth: 1200 }), -1)).toBe(0);
    expect(pageScrollTarget(geom({ scrollLeft: 0 }), -1)).toBeNull();
  });

  it('devuelve null en los extremos (nada que hacer ⇒ la flecha ya está apagada)', () => {
    expect(pageScrollTarget(geom({ scrollLeft: 1118 }), 1)).toBeNull();
  });
});

describe('carouselGeometry · scrollTrackTo', () => {
  it('usa scrollTo con opciones cuando existe (el navegador real)', () => {
    const el = document.createElement('div');
    const calls: unknown[] = [];
    (el as unknown as { scrollTo: unknown }).scrollTo = (arg: unknown) => calls.push(arg);
    scrollTrackTo(el, 272, 'smooth');
    expect(calls).toEqual([{ left: 272, behavior: 'smooth' }]);
  });

  it('cae a asignar scrollLeft donde scrollTo no existe (jsdom): movimiento CERO, no otra animación', () => {
    const el = document.createElement('div');
    expect((el as unknown as { scrollTo?: unknown }).scrollTo).toBeUndefined();
    scrollTrackTo(el, 272, 'smooth');
    expect(el.scrollLeft).toBe(272);
  });
});
