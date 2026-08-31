import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import {
  FeaturedCarousel,
  LEAD_IMAGE_CAP_MS,
  PROGRAMMATIC_SETTLE_MS,
  ROTATION_REST_MS,
  USER_INPUT_WINDOW_MS,
} from './FeaturedCarousel';
import * as api from '@/lib/api';
import type { CardDTO, GroupedListingSummaryDTO } from '@/types/contract';

/**
 * ROTACIÓN AUTOMÁTICA DEL CARRUSEL (P-49, DESIGN_SYSTEM §23) — la red de seguridad que no existía.
 *
 * ══ QUÉ SIMULA ESTE ARCHIVO Y QUÉ MIDE DE VERDAD ══════════════════════════════════════════════
 * jsdom **no tiene layout**: `offsetLeft`, `clientWidth` y `scrollWidth` son 0 para todo y
 * `getBoundingClientRect()` devuelve ceros. Así que la geometría de la pista se **inyecta** con
 * `Object.defineProperty` (helper `applyFakeLayout`) — eso es una simulación declarada, no una
 * medición: estos tests **no** demuestran que la teja aterrice visualmente flush con el borde.
 * Lo que sí miden de verdad, porque no depende del layout:
 *   · la máquina de estados completa (§23.5) y sus etiquetas,
 *   · cuándo arranca y cuándo NO arranca el temporizador (§23.3, §23.7),
 *   · qué se renderiza y qué no (§23.4d),
 *   · el `scrollLeft` exacto al que se desplaza la pista en cada tic (jsdom SÍ almacena `scrollLeft`),
 *   · que el DOM de las tejas no cambia entre tics (R1).
 * El aterrizaje visual y la holgura de la fila en 390/640/1024 son QA de navegador (§23.14 b/f).
 *
 * ══ LO QUE ESTE ARCHIVO NO PUEDE CUBRIR (y por qué) ═══════════════════════════════════════════
 *   · **`Element.prototype.scrollTo` no existe en jsdom** ⇒ el desplazamiento real corre por la
 *     caída `scrollLeft = n` de `scrollTrackTo`. El `behavior:'smooth'` vs `'auto'` de §23.7 se
 *     prueba en `carouselGeometry.test.ts` (rama con `scrollTo` inyectado), no aquí.
 *   · **Asignar `scrollLeft` en jsdom no emite `scroll`** ⇒ los eventos de scroll se disparan a
 *     mano. Que el navegador real no confunda nuestro propio tic con un swipe se prueba por su
 *     costura (`PROGRAMMATIC_SETTLE_MS`), no por observación.
 *   · **No hay `IntersectionObserver` en jsdom** ⇒ la suspensión por «menos del 50 % visible»
 *     (§23.5) **no está cubierta**. Es E2E de navegador.
 *   · **No hay `prefers-reduced-motion` real** ⇒ se controla con un `matchMedia` propio; lo que se
 *     verifica es la lógica del componente, que es exactamente donde §8.2 dice que debe vivir.
 */

vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn() }),
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

// ─── fixtures ────────────────────────────────────────────────────────────────────────────────────

function card(id: string, name: string): CardDTO {
  return {
    id,
    externalId: `base1-${id}`,
    name,
    number: '4',
    rarity: 'Rare Holo',
    supertype: 'Pokémon',
    subtypes: ['Stage 2'],
    setId: 'base1',
    setName: 'Base Set',
    imageSmallUrl: `https://img.example/${id}-small.png`,
    imageLargeUrl: `https://img.example/${id}-large.png`,
    availableFinishes: ['normal'],
  };
}

function grp(c: CardDTO): GroupedListingSummaryDTO {
  return {
    representativeInventoryItemId: `inv-${c.id}`,
    productType: 'raw',
    rawCondition: 'NM',
    finish: 'normal',
    gradeKey: 'raw:NM',
    stockCount: 1,
    salePriceCents: 140800,
    currency: 'MXN',
    card: c,
  };
}

const NAMES = ['Charizard', 'Blastoise', 'Venusaur', 'Alakazam', 'Machamp', 'Gengar', 'Mewtwo', 'Mew'];
const EIGHT = NAMES.map((n, i) => grp(card(`c-${i}`, n)));

function mockCatalog(data: GroupedListingSummaryDTO[]) {
  vi.spyOn(api, 'getCatalog').mockResolvedValue({
    data,
    page: 1,
    pageSize: data.length,
    total: data.length,
  });
}

// ─── matchMedia controlable (prefers-reduced-motion en caliente) ─────────────────────────────────

const REDUCED = '(prefers-reduced-motion: reduce)';
type Entry = { matches: boolean; listeners: Set<() => void> };
const media = new Map<string, Entry>();

function entryFor(query: string): Entry {
  let e = media.get(query);
  if (!e) {
    e = { matches: false, listeners: new Set() };
    media.set(query, e);
  }
  return e;
}

function installMatchMedia() {
  media.clear();
  window.matchMedia = ((query: string) => {
    const e = entryFor(query);
    return {
      get matches() {
        return e.matches;
      },
      media: query,
      onchange: null,
      addEventListener: (_: string, cb: () => void) => e.listeners.add(cb),
      removeEventListener: (_: string, cb: () => void) => e.listeners.delete(cb),
      addListener: (cb: () => void) => e.listeners.add(cb),
      removeListener: (cb: () => void) => e.listeners.delete(cb),
      dispatchEvent: () => false,
    };
  }) as unknown as typeof window.matchMedia;
}

/** Cambia la preferencia y NOTIFICA — es el «en caliente» de §23.7, no una lectura al montar. */
function setReducedMotion(value: boolean) {
  const e = entryFor(REDUCED);
  e.matches = value;
  act(() => {
    e.listeners.forEach((cb) => cb());
  });
}

// ─── layout inyectado ────────────────────────────────────────────────────────────────────────────

const GUTTER = 20;
const LEAD_W = 236;
const TILE_W = 160;
const GAP = 16;
const VIEWPORT = 390;
/** Puntos de snap resultantes con 8 tejas; el tope de la pista queda en 1118. */
const SNAPS = [0, 272, 448, 624, 800, 976, 1152, 1328];
const MAX_SCROLL = SNAPS[7] + TILE_W + GUTTER - VIEWPORT; // 1118

function applyFakeLayout(track: HTMLElement, { clientWidth = VIEWPORT, scrollWidth = SNAPS[7] + TILE_W + GUTTER } = {}) {
  const children = Array.from(track.children) as HTMLElement[];
  let x = GUTTER;
  children.forEach((child, i) => {
    const pos = x;
    Object.defineProperty(child, 'offsetLeft', { configurable: true, get: () => pos });
    x += (i === 0 ? LEAD_W : TILE_W) + GAP;
  });
  Object.defineProperty(track, 'offsetLeft', { configurable: true, get: () => 0 });
  Object.defineProperty(track, 'clientLeft', { configurable: true, get: () => 0 });
  Object.defineProperty(track, 'clientWidth', { configurable: true, get: () => clientWidth });
  Object.defineProperty(track, 'scrollWidth', { configurable: true, get: () => scrollWidth });
}

// ─── utilidades ──────────────────────────────────────────────────────────────────────────────────

async function settle(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function getTrack() {
  return screen.getByRole('group', { name: 'Piezas destacadas — pista desplazable' });
}

function getSection() {
  return screen.getByRole('region', { name: 'Piezas destacadas del catálogo' });
}

function toggle() {
  return screen.queryByRole('button', { name: /rotación automática|desde el principio/i });
}

function statusLine() {
  return document.querySelector('[role="status"]') as HTMLElement;
}

/**
 * Monta el carrusel, deja resolver la consulta, inyecta el layout y dispara el `resize` que hace
 * que el componente vuelva a medir (única forma de que `overflows` pase a `true` en jsdom).
 * `loadLeadImage: false` deja la precondición 3 de §23.3 sin cumplir, a propósito.
 */
async function mountCarousel({
  data = EIGHT,
  loadLeadImage = true,
  layout,
}: {
  data?: GroupedListingSummaryDTO[];
  loadLeadImage?: boolean;
  layout?: Parameters<typeof applyFakeLayout>[1];
} = {}) {
  mockCatalog(data);
  const view = renderWithProviders(<FeaturedCarousel />, 'es');
  await settle(0);
  const track = getTrack();
  applyFakeLayout(track, layout);
  await act(async () => {
    window.dispatchEvent(new Event('resize'));
  });
  if (loadLeadImage) {
    await act(async () => {
      fireEvent.load(screen.getByAltText(NAMES[0]));
    });
  }
  return { ...view, track };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.useFakeTimers();
  installMatchMedia();
  window.location.hash = '';
});

afterEach(() => {
  vi.useRealTimers();
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════

describe('§23.3 · cuándo arranca (y cuándo no) — R2: la rotación nunca coexiste con carga', () => {
  it('los primeros 7 s la pista está QUIETA, y al cumplirse el reposo avanza UNA teja', async () => {
    const { track } = await mountCarousel();
    await settle(ROTATION_REST_MS - 1);
    expect(track.scrollLeft).toBe(0);
    await settle(1);
    expect(track.scrollLeft).toBe(SNAPS[1]);
  });

  it('NO arranca mientras la foto de la teja líder no ha cargado', async () => {
    const { track } = await mountCarousel({ loadLeadImage: false });
    // Sin `load` no hay reposo que contar: el cronómetro de los 7 s ni siquiera está armado.
    await settle(LEAD_IMAGE_CAP_MS - 1);
    expect(track.scrollLeft).toBe(0);
    // Y a los 7 s —el reposo completo si la foto hubiera cargado— la pista sigue quieta.
    await settle(ROTATION_REST_MS - LEAD_IMAGE_CAP_MS + 1);
    expect(track.scrollLeft).toBe(0);
  });

  it('el tope de 3 s desbloquea la rotación si la imagen remota nunca llega', async () => {
    const { track } = await mountCarousel({ loadLeadImage: false });
    // El avance va en dos tramos porque `act` no aplica el `setState` del tope hasta salir del
    // bloque; en el navegador el reposo de 7 s arranca en el instante mismo del tope.
    await settle(LEAD_IMAGE_CAP_MS);
    await settle(ROTATION_REST_MS - 1);
    expect(track.scrollLeft).toBe(0);
    await settle(1);
    expect(track.scrollLeft).toBe(SNAPS[1]);
  });

  it('no hay rotación ni conmutador mientras el estante está en skeleton', async () => {
    mockCatalog(EIGHT);
    renderWithProviders(<FeaturedCarousel />, 'es');
    expect(screen.queryByRole('group')).toBeNull();
    expect(toggle()).toBeNull();
    await settle(0);
  });

  it('cada tic avanza exactamente UNA teja, nunca una página', async () => {
    const { track } = await mountCarousel();
    const seen: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      await settle(ROTATION_REST_MS);
      seen.push(track.scrollLeft);
    }
    expect(seen).toEqual([SNAPS[1], SNAPS[2], SNAPS[3], SNAPS[4], SNAPS[5]]);
  });
});

describe('§23.7 · prefers-reduced-motion ⇒ movimiento CERO (R4)', () => {
  it('con la preferencia activa el temporizador NO arranca y el conmutador NO se renderiza', async () => {
    setReducedMotion(true);
    const { track } = await mountCarousel();
    expect(toggle()).toBeNull();
    await settle(ROTATION_REST_MS * 6);
    expect(track.scrollLeft).toBe(0);
  });

  it('se detiene EN VIVO si la preferencia se activa a media rotación (§23.14 g)', async () => {
    const { track } = await mountCarousel();
    await settle(ROTATION_REST_MS);
    expect(track.scrollLeft).toBe(SNAPS[1]);
    expect(toggle()).not.toBeNull();

    setReducedMotion(true);

    // El conmutador desaparece en ese instante: un freno sobre algo quieto es una afirmación falsa.
    expect(toggle()).toBeNull();
    await settle(ROTATION_REST_MS * 4);
    expect(track.scrollLeft).toBe(SNAPS[1]);
  });

  it('nunca «más lento»: desactivarla vuelve a rotar con el reposo COMPLETO de 7 s, sin tic de golpe', async () => {
    setReducedMotion(true);
    const { track } = await mountCarousel();
    await settle(ROTATION_REST_MS * 3);
    expect(track.scrollLeft).toBe(0);

    setReducedMotion(false);
    await settle(ROTATION_REST_MS - 1);
    expect(track.scrollLeft).toBe(0);
    await settle(1);
    expect(track.scrollLeft).toBe(SNAPS[1]);
  });

  it('las flechas SIGUEN funcionando con movimiento reducido (la preferencia quita movimiento, no información)', async () => {
    const { track } = await mountCarousel();
    setReducedMotion(true);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    });
    expect(track.scrollLeft).toBe(SNAPS[1]);
  });
});

describe('§23.4d · el control NO se renderiza cuando no puede funcionar', () => {
  it('pista que no desborda ⇒ sin conmutador (nada que frenar)', async () => {
    await mountCarousel({ layout: { clientWidth: 4000, scrollWidth: 4000 } });
    expect(toggle()).toBeNull();
  });

  it('una sola teja ⇒ sin conmutador', async () => {
    mockCatalog([EIGHT[0]]);
    renderWithProviders(<FeaturedCarousel />, 'es');
    await settle(0);
    expect(toggle()).toBeNull();
  });

  it('estante vacío ⇒ ni pista ni conmutador', async () => {
    mockCatalog([]);
    renderWithProviders(<FeaturedCarousel />, 'es');
    await settle(0);
    expect(screen.queryByRole('group')).toBeNull();
    expect(toggle()).toBeNull();
  });

  it('nunca `disabled` ni `loading`: cuando existe, está operable (§23.4c)', async () => {
    await mountCarousel();
    const button = toggle()!;
    expect(button).toBeEnabled();
    expect(button).not.toHaveAttribute('aria-pressed');
  });
});

describe('§23.5 nivel 1 · suspensión silenciosa (hover, foco, pestaña)', () => {
  it('el puntero encima detiene el temporizador y NO cambia la etiqueta del conmutador', async () => {
    const { track } = await mountCarousel();
    act(() => {
      getSection().dispatchEvent(new Event('pointerenter'));
    });
    expect(toggle()).toHaveAccessibleName('Pausar la rotación automática');
    await settle(ROTATION_REST_MS * 3);
    expect(track.scrollLeft).toBe(0);
  });

  it('al retirar el puntero espera los 7 s COMPLETOS: nunca un tic inmediato (§23.14 c)', async () => {
    const { track } = await mountCarousel();
    act(() => {
      getSection().dispatchEvent(new Event('pointerenter'));
    });
    await settle(ROTATION_REST_MS - 1);
    act(() => {
      getSection().dispatchEvent(new Event('pointerleave'));
    });
    await settle(ROTATION_REST_MS - 1);
    expect(track.scrollLeft).toBe(0);
    await settle(1);
    expect(track.scrollLeft).toBe(SNAPS[1]);
  });

  it('el foco dentro de la sección suspende, y el foco de teclado NO pelea con el scroll (§23.14 d)', async () => {
    const { track } = await mountCarousel();
    await act(async () => {
      fireEvent.focusIn(track);
    });
    await settle(ROTATION_REST_MS * 4);
    expect(track.scrollLeft).toBe(0);
    // Mientras el usuario navega con teclado la pista queda en `polite` (§23.9b).
    expect(track).toHaveAttribute('aria-live', 'polite');
    expect(toggle()).toHaveAccessibleName('Pausar la rotación automática');

    await act(async () => {
      fireEvent.focusOut(track, { relatedTarget: document.body });
    });
    await settle(ROTATION_REST_MS);
    expect(track.scrollLeft).toBe(SNAPS[1]);
  });

  it('la pestaña oculta suspende, y al volver NO se acumulan tics (§23.14 n)', async () => {
    const { track } = await mountCarousel();
    const spy = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await settle(ROTATION_REST_MS * 8);
    expect(track.scrollLeft).toBe(0);

    spy.mockReturnValue('visible');
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await settle(ROTATION_REST_MS);
    // UN solo tic, no ocho: al reanudar se reinicia el reposo, no se recuperan los tics perdidos.
    expect(track.scrollLeft).toBe(SNAPS[1]);
  });
});

describe('§23.5 nivel 2 · la intervención del usuario pausa PARA SIEMPRE (R5)', () => {
  it('un swipe del usuario pausa, anuncia y no se reactiva solo', async () => {
    const { track } = await mountCarousel();
    await act(async () => {
      fireEvent.pointerDown(track);
      track.scrollLeft = 500;
      fireEvent.scroll(track);
    });
    expect(toggle()).toHaveAccessibleName('Reanudar la rotación automática');
    expect(statusLine()).toHaveTextContent('Rotación automática pausada.');
    await settle(ROTATION_REST_MS * 6);
    expect(track.scrollLeft).toBe(500);
  });

  it('la rueda/trackpad sobre la pista también pausa', async () => {
    const { track } = await mountCarousel();
    await act(async () => {
      fireEvent.wheel(track);
      track.scrollLeft = 300;
      fireEvent.scroll(track);
    });
    expect(toggle()).toHaveAccessibleName('Reanudar la rotación automática');
  });

  it('el foco que el navegador persigue hasta una teja fuera de pantalla también pausa (§23.5)', async () => {
    const { track } = await mountCarousel();
    await act(async () => {
      fireEvent.focus(track);
      track.scrollLeft = 800;
      fireEvent.scroll(track);
    });
    expect(toggle()).toHaveAccessibleName('Reanudar la rotación automática');
  });

  /**
   * REGRESIÓN DE NAVEGADOR (verificada en Chromium, ver `USER_INPUT_WINDOW_MS`): el motor aplica
   * `scroll-snap` ~1 s después de hidratar y mueve `scrollLeft` de 0 al gutter POR SU CUENTA. Con la
   * regla de §23.5 aplicada al pie de la letra —«cualquier desplazamiento que no hayamos
   * originado»— el carrusel se pausaba solo antes de su primer tic y la función salía muerta.
   */
  it('un re-snap del NAVEGADOR (scroll sin entrada del usuario) NO pausa', async () => {
    const { track } = await mountCarousel();
    await act(async () => {
      track.scrollLeft = 32;
      fireEvent.scroll(track);
    });
    expect(toggle()).toHaveAccessibleName('Pausar la rotación automática');
    expect(statusLine()).toHaveTextContent('');
    await settle(ROTATION_REST_MS);
    expect(track.scrollLeft).toBe(SNAPS[1]);
  });

  it('pasada la ventana de la entrada del usuario, un scroll del motor tampoco pausa', async () => {
    const { track } = await mountCarousel();
    await act(async () => {
      fireEvent.pointerDown(track);
    });
    await settle(USER_INPUT_WINDOW_MS + 1);
    await act(async () => {
      track.scrollLeft = 60;
      fireEvent.scroll(track);
    });
    expect(toggle()).toHaveAccessibleName('Pausar la rotación automática');
  });

  it('pulsar una flecha pausa para siempre (flechas y rotación no se disputan la pista)', async () => {
    const { track } = await mountCarousel();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    });
    expect(toggle()).toHaveAccessibleName('Reanudar la rotación automática');
    const after = track.scrollLeft;
    await settle(ROTATION_REST_MS * 6);
    expect(track.scrollLeft).toBe(after);
  });

  it('nuestro PROPIO tic no se confunde con una intervención (la costura de §23.5)', async () => {
    const { track } = await mountCarousel();
    await settle(ROTATION_REST_MS);
    // El navegador emite `scroll` durante el deslizamiento suave del tic. Aunque el usuario esté
    // tocando la pista en ese momento, el movimiento es NUESTRO y no debe pausar.
    await act(async () => {
      fireEvent.pointerDown(track);
      fireEvent.scroll(track);
    });
    expect(toggle()).toHaveAccessibleName('Pausar la rotación automática');
    // Pasada la ventana de reposo del scroll suave, el mismo gesto ya es del usuario.
    await settle(PROGRAMMATIC_SETTLE_MS);
    await act(async () => {
      fireEvent.pointerDown(track);
      fireEvent.scroll(track);
    });
    expect(toggle()).toHaveAccessibleName('Reanudar la rotación automática');
  });

  it('llegar por el ancla #piezas-destacadas detiene la rotación, sin rebobinar', async () => {
    window.location.hash = '#piezas-destacadas';
    const { track } = await mountCarousel();
    expect(toggle()).toHaveAccessibleName('Reanudar la rotación automática');
    await settle(ROTATION_REST_MS * 4);
    expect(track.scrollLeft).toBe(0);
  });

  it('el conmutador NO emite por el canal de estado: el nombre accesible ya lo dice (§23.9c)', async () => {
    await mountCarousel();
    await act(async () => {
      fireEvent.click(toggle()!);
    });
    expect(toggle()).toHaveAccessibleName('Reanudar la rotación automática');
    expect(statusLine()).toHaveTextContent('');
  });

  it('PAUSAR ⟷ REANUDAR: reanudar vuelve a rotar con su reposo completo', async () => {
    const { track } = await mountCarousel();
    await act(async () => {
      fireEvent.click(toggle()!);
    });
    await settle(ROTATION_REST_MS * 3);
    expect(track.scrollLeft).toBe(0);

    await act(async () => {
      fireEvent.click(toggle()!);
    });
    expect(toggle()).toHaveAccessibleName('Pausar la rotación automática');
    await settle(ROTATION_REST_MS);
    expect(track.scrollLeft).toBe(SNAPS[1]);
  });
});

describe('§23.6 · una pasada y para (R7)', () => {
  it('al llegar al extremo se detiene, el conmutador pasa a REPETIR y se anuncia el fin', async () => {
    const { track } = await mountCarousel();
    // 6 tics alcanzables + el 7.º que descubre que no queda pista.
    await settle(ROTATION_REST_MS * 7);
    expect(track.scrollLeft).toBe(MAX_SCROLL);
    expect(toggle()).toHaveAccessibleName('Repetir desde el principio');
    expect(statusLine()).toHaveTextContent('Fin de las piezas destacadas.');
    // La flecha «siguiente» queda apagada: TERMINADO es el MISMO predicado (§23.6).
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled();

    // Y no vuelve a moverse nunca: sin bucle, sin rebobinado automático.
    await settle(ROTATION_REST_MS * 6);
    expect(track.scrollLeft).toBe(MAX_SCROLL);
  });

  it('REPETIR vuelve al inicio de forma INSTANTÁNEA y arranca una pasada nueva', async () => {
    const { track } = await mountCarousel();
    await settle(ROTATION_REST_MS * 7);
    await act(async () => {
      fireEvent.click(toggle()!);
    });
    expect(track.scrollLeft).toBe(0);
    expect(toggle()).toHaveAccessibleName('Pausar la rotación automática');
    await settle(ROTATION_REST_MS);
    expect(track.scrollLeft).toBe(SNAPS[1]);
  });

  it('desde TERMINADO, retroceder con la flecha «anterior» deja PAUSADO (no vuelve a rotar solo)', async () => {
    const { track } = await mountCarousel();
    await settle(ROTATION_REST_MS * 7);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Anterior' }));
    });
    expect(toggle()).toHaveAccessibleName('Reanudar la rotación automática');
    const after = track.scrollLeft;
    await settle(ROTATION_REST_MS * 5);
    expect(track.scrollLeft).toBe(after);
  });
});

describe('§23.2 · rota la VENTANA, nunca el ROL (R1) — lo que protege el LCP', () => {
  it('la teja líder conserva identidad, sitio, imagen HD y fetchpriority en TODOS los tics', async () => {
    const { track } = await mountCarousel();
    const leadBefore = track.firstElementChild;
    const imgBefore = screen.getByAltText(NAMES[0]);
    expect(imgBefore).toHaveAttribute('src', 'https://img.example/c-0-large.png');
    expect(imgBefore).toHaveAttribute('fetchpriority', 'high');

    const order = () =>
      Array.from(track.children).map((el) => el.querySelector('img')?.getAttribute('alt'));
    const orderBefore = order();

    for (let i = 0; i < 7; i += 1) {
      await settle(ROTATION_REST_MS);
      // Misma referencia de nodo: el DOM de la pista es inmutable, no se remonta ni se reordena.
      expect(track.firstElementChild).toBe(leadBefore);
      expect(order()).toEqual(orderBefore);
      // Ninguna otra teja se convierte en HD (eso dispararía una descarga cada 7 s).
      expect(screen.getByAltText(NAMES[1])).toHaveAttribute('src', 'https://img.example/c-1-small.png');
      expect(screen.getByAltText(NAMES[1])).not.toHaveAttribute('fetchpriority');
    }
    expect(screen.getByAltText(NAMES[0])).toBe(imgBefore);
  });

  it('la numeración 01·02·03 no cambia de teja ni se usa como progreso (§23.10)', async () => {
    const { track } = await mountCarousel();
    const numbers = () =>
      Array.from(track.children).map((el) => el.querySelector('span[aria-hidden]')?.textContent ?? null);
    const before = numbers();
    expect(before).toEqual([null, '01', '02', '03', '04', '05', '06', '07']);
    await settle(ROTATION_REST_MS * 4);
    expect(numbers()).toEqual(before);
  });
});

describe('§23.9 · anuncio a lectores de pantalla (patrón APG)', () => {
  it('la sección se anuncia como carrusel sin cambiar su aria-label (§22.6b-e sigue vigente)', async () => {
    await mountCarousel();
    const section = getSection();
    expect(section).toHaveAttribute('aria-roledescription', 'carrusel');
    expect(section).toHaveAttribute('aria-label', 'Piezas destacadas del catálogo');
    expect(section.getAttribute('aria-label')).not.toMatch(/rotaci|carrus|gradе|PSA/i);
  });

  it('la pista es un tope de tabulación CON NOMBRE y conmuta aria-live con el temporizador', async () => {
    const { track } = await mountCarousel();
    expect(track).toHaveAttribute('tabindex', '0');
    expect(track).toHaveAttribute('aria-live', 'off');
    await act(async () => {
      fireEvent.click(toggle()!);
    });
    expect(track).toHaveAttribute('aria-live', 'polite');
  });

  it('la línea de estado nace vacía y nunca es assertive', async () => {
    await mountCarousel();
    expect(statusLine()).toHaveTextContent('');
    expect(statusLine()).toHaveAttribute('aria-live', 'polite');
  });

  it('la teja sigue SIN aria-label: la cifra y el micro-aviso no se borran del árbol (§22.6b-h)', async () => {
    const { track } = await mountCarousel();
    Array.from(track.children).forEach((tile) => {
      expect(tile).not.toHaveAttribute('aria-label');
    });
  });
});

describe('§23.4 · anatomía y orden de tabulación del conmutador', () => {
  it('es el PRIMER control del carrusel en orden de DOM: antes de las flechas y de la pista', async () => {
    await mountCarousel();
    const button = toggle()!;
    const next = screen.getByRole('button', { name: 'Siguiente' });
    expect(button.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(button.compareDocumentPosition(getTrack()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('va pegado al H2, dentro del grupo del título (no en el grupo de las flechas)', async () => {
    await mountCarousel();
    const heading = screen.getByRole('heading', { level: 2 });
    expect(heading.parentElement).toBe(toggle()!.parentElement);
  });

  it('el nombre accesible EMPIEZA por la palabra visible (WCAG 2.5.3)', async () => {
    await mountCarousel();
    const button = toggle()!;
    expect(button).toHaveTextContent('Pausar');
    expect(button.getAttribute('aria-label')).toMatch(/^Pausar/);
  });

  it('área táctil por pseudo-elemento y ancho reservado — la fila no baila al cambiar de estado', async () => {
    await mountCarousel();
    const button = toggle()!;
    // §23.4b: 44×44 con `::after` (inset -16px/-8px), NUNCA con padding, y `min-width: 80px`.
    expect(button.className).toContain('after:-inset-y-4');
    expect(button.className).toContain('after:-inset-x-2');
    expect(button.className).toContain('min-w-[80px]');
    expect(button.className).not.toMatch(/\bp[xy]?-\d/);
    // Sin borde, sin fondo, sin radio, sin sombra.
    expect(button.className).not.toMatch(/\b(border|bg-|rounded|shadow)/);
    // El glifo va aria-hidden: la palabra es el portador.
    expect(button.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('la desaparición del conmutador no toca el grupo derecho (link y flechas siguen ahí)', async () => {
    await mountCarousel();
    const rightGroup = screen.getByRole('button', { name: 'Siguiente' }).parentElement!.parentElement!;
    const before = rightGroup.childElementCount;
    setReducedMotion(true);
    expect(toggle()).toBeNull();
    expect(rightGroup.childElementCount).toBe(before);
  });
});

describe('§23.15 nº2 · las flechas navegan por índice', () => {
  it('la flecha aterriza en un punto de snap, nunca a mitad de teja', async () => {
    const { track } = await mountCarousel();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    });
    expect(SNAPS).toContain(track.scrollLeft);
    // 0,8 × 390 = 312 era el reposo viejo: teja cortada por el borde izquierdo.
    expect(track.scrollLeft).not.toBe(Math.round(VIEWPORT * 0.8));
  });
});

describe('§23.12 · i18n', () => {
  it('en EN el conmutador dice Pause y su nombre accesible empieza por la palabra visible', async () => {
    mockCatalog(EIGHT);
    renderWithProviders(<FeaturedCarousel />, 'en');
    await settle(0);
    const track = screen.getByRole('group', { name: 'Featured pieces — scrollable track' });
    applyFakeLayout(track);
    await act(async () => {
      window.dispatchEvent(new Event('resize'));
    });
    const button = screen.getByRole('button', { name: 'Pause the automatic rotation' });
    expect(button).toHaveTextContent('Pause');
    expect(screen.getByRole('region', { name: 'Featured from the catalog' })).toHaveAttribute(
      'aria-roledescription',
      'carousel',
    );
  });
});
