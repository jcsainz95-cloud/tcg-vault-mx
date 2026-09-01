import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import {
  FEATURED_CAROUSEL_ID,
  FeaturedCarousel,
  LEAD_IMAGE_CAP_MS,
  ROTATION_REST_MS,
  USER_INPUT_WINDOW_MS,
} from './FeaturedCarousel';
import * as api from '@/lib/api';
import type { CardDTO, GroupedListingSummaryDTO } from '@/types/contract';

/**
 * ROTACIÓN AUTOMÁTICA DEL CARRUSEL (P-49, DESIGN_SYSTEM §23) — la red de seguridad que no existía.
 *
 * ══ SIN CONMUTADOR: QUÉ CAMBIÓ EN ESTOS TESTS ═════════════════════════════════════════════════
 * El conmutador PAUSAR/REANUDAR/REPETIR se retiró (decisión del dueño; WCAG 2.2.2 es estándar del
 * W3C, no obligación legal para esta tienda) y la cadencia bajó de 7 s a 5 s. Se retiraron los
 * casos que probaban **exclusivamente el control** (su área táctil, su sitio en el orden de
 * tabulación, sus estados y sus claves i18n). Los cinco frenos automáticos —hover, foco,
 * intervención del usuario, visibilidad y `prefers-reduced-motion`— siguen probados aquí, con la
 * aserción reescrita para mirar **si la pista se mueve o no** (`expectFrozen` / `scrollLeft`) en vez
 * de la etiqueta de un botón que ya no existe.
 *
 * ⚠️ **CORRECCIÓN — aquí decía «no se retiró ni una sola cobertura de conducta viva», y era FALSO.**
 * QA lo midió a los dos lados del diff y tenía razón: reescribir §23.4d de «no se pinta el botón» a
 * «la pista no se mueve» **sí** perdió poder discriminante, porque en jsdom la pista tampoco se
 * mueve cuando el guard no existe (`nextScrollTarget` → `null` con geometría degenerada). Dos
 * mutantes que daban 2 rojos cada uno en `origin/main` pasaban 40/40 en verde aquí. Se cerró el
 * hueco añadiendo la aserción que sí discrimina —**el canal de estado mudo**, ver el bloque §23.4d—
 * y también el caso de la guarda de `pauseByIntervention` tras el fin (§23.6). La frase se deja
 * escrita con su corrección a propósito: el enunciado original estaba en un documento durable y
 * afirmaba de más sobre el propio trabajo de quien lo escribió.
 *
 * Lo que sí se sostiene, dicho sin exagerar: `scrollLeft` es evidencia de lo que el componente
 * **hizo**, y la etiqueta lo era de lo que **creía** — pero «no se movió» sola es ambigua en jsdom,
 * y hace falta emparejarla con «y no dijo nada» para que signifique lo que se quiere que signifique.
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
 *     mano, con el antecedente de usuario que cada caso quiera declarar. Que el motor de un navegador
 *     real no emita `scroll` con antecedente de usuario es **medición de navegador**, no de aquí
 *     (53 eventos / 0 con antecedente en una pasada completa; ver `handleScroll`).
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
  return screen.getByRole('region', { name: 'Piezas destacadas' });
}

function statusLine() {
  return document.querySelector('[role="status"]') as HTMLElement;
}

/**
 * **La aserción central de este archivo desde que no hay conmutador.** Antes, «¿está frenada?» se
 * leía en la etiqueta del botón (PAUSAR/REANUDAR/REPETIR); retirado el control, la única evidencia
 * honesta de que un freno funciona es que **la pista no se mueve**. Deja correr varios reposos
 * completos y exige que `scrollLeft` sea exactamente el mismo.
 */
async function expectFrozen(track: HTMLElement, rests = 4) {
  const before = track.scrollLeft;
  await settle(ROTATION_REST_MS * rests);
  expect(track.scrollLeft).toBe(before);
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

/**
 * ⚠️ **EL CANDADO DE LOS NÚMEROS, Y POR QUÉ ES UN `toBe` LITERAL Y NO UN CÁLCULO.**
 *
 * Todo el resto de este archivo **importa** las constantes y deriva sus tiempos de ellas, así que
 * **se mueve con ellas**: cambiar `ROTATION_REST_MS` a 7000 dejaba los 40 casos en verde, y el E2E
 * también (se re-declaraba el número a mano y el único aserto temporal tenía 15 s de margen). Eso
 * significaba que **la petición explícita del dueño —5 s— era lo único del pase sin red de
 * regresión**: cualquiera podía deshacerla y ningún gate se enteraba. Lo mismo valía para la ventana
 * de 1200 ms y para el tope de 3 s.
 *
 * Estos tres asertos son de otra especie que los demás: no describen conducta, **fijan el número**.
 * Su enunciado es siempre el mismo: *esto es una medición o una decisión del dueño; cambiarlo es una
 * decisión que se toma con dato delante, no un ajuste que se hace de paso.* Si uno de ellos se pone
 * rojo, la respuesta correcta **no** es actualizar el literal sin más: es traer la decisión (quién y
 * por qué) y actualizar `DESIGN_SYSTEM.md` §23 y `docs/FRONTEND_NOTES.md` en el mismo commit.
 *
 * El E2E lleva su hermano: `e2e/featured-rotation.spec.ts` afirma que el `REST_MS` que usa es el
 * mismo `ROTATION_REST_MS` que compila el componente (lo lee del fuente), en vez de confiar en un
 * comentario.
 */
describe('§23 · los números medidos están CLAVADOS (cambiarlos es una decisión, no un ajuste)', () => {
  it('ROTATION_REST_MS = 5000 — cadencia pedida por el dueño al retirar el conmutador (§39.5)', () => {
    expect(ROTATION_REST_MS).toBe(5000);
  });

  it('USER_INPUT_WINDOW_MS = 1200 — medición de inercia de trackpad en Chromium (§23.5a)', () => {
    // Acortarla se lleva por delante la pausa por swipe en táctil (§23.13 nº9); alargarla convierte
    // el re-snap del motor en «intervención» y deja la función muerta al primer render.
    expect(USER_INPUT_WINDOW_MS).toBe(1200);
  });

  it('LEAD_IMAGE_CAP_MS = 3000 — tope de la precondición 3 de §23.3 (la foto que nunca llega)', () => {
    expect(LEAD_IMAGE_CAP_MS).toBe(3000);
  });
});

describe('§23.3 · cuándo arranca (y cuándo no) — R2: la rotación nunca coexiste con carga', () => {
  it('los primeros 5 s la pista está QUIETA, y al cumplirse el reposo avanza UNA teja', async () => {
    const { track } = await mountCarousel();
    await settle(ROTATION_REST_MS - 1);
    expect(track.scrollLeft).toBe(0);
    await settle(1);
    expect(track.scrollLeft).toBe(SNAPS[1]);
  });

  it('NO arranca mientras la foto de la teja líder no ha cargado', async () => {
    const { track } = await mountCarousel({ loadLeadImage: false });
    // Sin `load` no hay reposo que contar: el cronómetro de los 5 s ni siquiera está armado.
    await settle(LEAD_IMAGE_CAP_MS - 1);
    expect(track.scrollLeft).toBe(0);
    // Y a los 5 s —el reposo completo si la foto hubiera cargado— la pista sigue quieta.
    await settle(ROTATION_REST_MS - LEAD_IMAGE_CAP_MS + 1);
    expect(track.scrollLeft).toBe(0);
  });

  it('el tope de 3 s desbloquea la rotación si la imagen remota nunca llega', async () => {
    const { track } = await mountCarousel({ loadLeadImage: false });
    // El avance va en dos tramos porque `act` no aplica el `setState` del tope hasta salir del
    // bloque; en el navegador el reposo de 5 s arranca en el instante mismo del tope.
    await settle(LEAD_IMAGE_CAP_MS);
    await settle(ROTATION_REST_MS - 1);
    expect(track.scrollLeft).toBe(0);
    await settle(1);
    expect(track.scrollLeft).toBe(SNAPS[1]);
  });

  /**
   * `CardImage` llama a `settle()` en `onLoad` **y en `onError`** («un 404 no puede dejar a nadie
   * esperando»). Que un fallo de la foto líder desbloquee la rotación **sin** gastar los 3 s del tope
   * no lo afirmaba nadie: si mañana alguien quita el `onError` de `CardImage`, el carrusel de una
   * home con la CDN caída se queda 3 s de más en cada visita y ningún test lo nota.
   */
  it('un 404 en la foto líder desbloquea igual, sin esperar el tope de 3 s (`onError` = `settle`)', async () => {
    const { track } = await mountCarousel({ loadLeadImage: false });
    await act(async () => {
      fireEvent.error(screen.getByAltText(NAMES[0]));
    });
    // El reposo arranca en el instante del `error`, no en el tope: a los 5 s justos ya hubo tic, y
    // eso solo es posible si NO se esperaron los 3 s de `LEAD_IMAGE_CAP_MS` por delante.
    await settle(ROTATION_REST_MS - 1);
    expect(track.scrollLeft).toBe(0);
    await settle(1);
    expect(track.scrollLeft).toBe(SNAPS[1]);
  });

  it('no hay pista —y por tanto no hay rotación— mientras el estante está en skeleton', async () => {
    mockCatalog(EIGHT);
    renderWithProviders(<FeaturedCarousel />, 'es');
    expect(screen.queryByRole('group')).toBeNull();
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
  it('con la preferencia activa el temporizador NO arranca: cero movimiento, ni un píxel', async () => {
    setReducedMotion(true);
    const { track } = await mountCarousel();
    await settle(ROTATION_REST_MS * 6);
    expect(track.scrollLeft).toBe(0);
  });

  it('se detiene EN VIVO si la preferencia se activa a media rotación (§23.14 g)', async () => {
    const { track } = await mountCarousel();
    // Rotando de verdad antes de activar la preferencia: sin este tic el test pasaría en verde
    // aunque la rotación nunca hubiera arrancado.
    await settle(ROTATION_REST_MS);
    expect(track.scrollLeft).toBe(SNAPS[1]);

    setReducedMotion(true);

    // Y a partir de ese instante, quieta para siempre.
    await expectFrozen(track);
    expect(track.scrollLeft).toBe(SNAPS[1]);
  });

  it('nunca «más lento»: desactivarla vuelve a rotar con el reposo COMPLETO de 5 s, sin tic de golpe', async () => {
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

/**
 * `rotationPossible` gobernaba DOS cosas —«¿hay rotación?» y «¿se pinta el conmutador?»— con **un
 * solo booleano**. Retirado el control, sigue gobernando la primera, y estos casos son los que lo
 * fijan: antes se leían en la ausencia del botón, ahora en la ausencia de movimiento.
 *
 * ══ POR QUÉ «LA PISTA NO SE MUEVE» NO BASTA AQUÍ, Y QUÉ SE AÑADIÓ ═════════════════════════════
 * Reescribir estos tres de «no se pinta el botón» a «la pista no se mueve» los dejó **pasando por
 * el motivo equivocado**: en jsdom, con geometría degenerada, `nextScrollTarget()` devuelve `null` y
 * la pista no se mueve **aunque el guard no exista**. Verificado por mutación: quitar `overflows` de
 * `rotationPossible`, o relajar `featured.length > 1` a `> 0`, dejaba los 40 casos en verde (en
 * `origin/main`, cuando la aserción miraba el botón, los mismos dos mutantes daban 2 rojos cada uno).
 * O sea: **sí se había perdido cobertura de conducta viva**, y este archivo afirmaba lo contrario.
 *
 * El defecto **sí es observable en un navegador de verdad**, y por eso hay una aserción que lo
 * discrimina: sin `overflows`, una pista que no desborda **entra en `mode='ended'`** en el primer tic
 * (`nextScrollTarget` → `null`) y **anuncia «Fin de las piezas destacadas.»** por el `role="status"`
 * sobre algo que nunca se movió. Eso rompe §23.9(c) en el canal que ux-ui subió a obligatorio.
 *
 * Por eso cada caso exige **las dos cosas**: la pista quieta **y el canal de estado MUDO**. La
 * segunda es la que discrimina — es lo único que distingue «el guard apagó el temporizador» de «el
 * temporizador corrió y descubrió que no había a dónde ir».
 */
describe('§23.4d · NO se rota cuando la rotación no puede funcionar (`rotationPossible`)', () => {
  it('pista que no desborda ⇒ ni se mueve NI anuncia el fin (el temporizador ni arrancó)', async () => {
    const { track } = await mountCarousel({ layout: { clientWidth: 4000, scrollWidth: 4000 } });
    await expectFrozen(track);
    expect(track.scrollLeft).toBe(0);
    // ⚠️ LA ASERCIÓN QUE DISCRIMINA. Quitar `overflows` de `rotationPossible` deja esto en rojo:
    // el tic corre, `nextScrollTarget` devuelve `null`, y el carrusel anuncia el fin de una pasada
    // que nunca ocurrió. Sin esta línea la mutación pasa en verde.
    expect(statusLine()).toHaveTextContent('');
  });

  /**
   * **Este caso aísla su causa, que es lo que su nombre promete.** Antes no aplicaba layout ni
   * disparaba `resize`, así que `overflows` era `false` y la pista estaba quieta **por
   * desbordamiento, no por longitud** — el `describe` decía «estos casos son los que lo fijan» y éste
   * no fijaba lo que nombraba.
   *
   * Aquí se le inyecta a propósito una pista **que SÍ desborda con una sola teja** (una teja más
   * ancha que el viewport: `clientWidth 200 / scrollWidth 1000`). Es geometría sintética y declarada,
   * como todo el layout de este archivo, pero deja `overflows === true` ⇒ el único predicado que
   * puede apagar la rotación es `featured.length > 1`. Con la mutación `> 0` el temporizador arranca,
   * el tic no encuentra teja siguiente (`offsets === [0]`) y **anuncia el fin**: rojo.
   */
  it('una sola teja ⇒ no rota — y es la LONGITUD lo que lo impide, no la falta de desbordamiento', async () => {
    const { track } = await mountCarousel({
      data: [EIGHT[0]],
      layout: { clientWidth: 200, scrollWidth: 1000 },
    });
    await expectFrozen(track);
    expect(track.scrollLeft).toBe(0);
    // Mudo: si `featured.length > 1` se relaja, aquí suena «Fin de las piezas destacadas.».
    expect(statusLine()).toHaveTextContent('');
  });

  it('estante vacío ⇒ ni pista ni rotación', async () => {
    mockCatalog([]);
    renderWithProviders(<FeaturedCarousel />, 'es');
    await settle(0);
    expect(screen.queryByRole('group')).toBeNull();
  });
});

describe('§23.5 nivel 1 · suspensión silenciosa (hover, foco, pestaña)', () => {
  it('el puntero encima detiene el temporizador, y lo hace EN SILENCIO', async () => {
    const { track } = await mountCarousel();
    act(() => {
      getSection().dispatchEvent(new Event('pointerenter'));
    });
    await settle(ROTATION_REST_MS * 3);
    expect(track.scrollLeft).toBe(0);
    // Silenciosa (§23.9c): una suspensión reversible sola NO se anuncia. Esto es lo que antes
    // afirmaba «la etiqueta del conmutador no cambia».
    expect(statusLine()).toHaveTextContent('');
  });

  it('al retirar el puntero espera los 5 s COMPLETOS: nunca un tic inmediato (§23.14 c)', async () => {
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
    // Y en silencio: el foco suspende, no pausa (§23.9c).
    expect(statusLine()).toHaveTextContent('');

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
    expect(statusLine()).toHaveTextContent('Rotación automática pausada.');
    await settle(ROTATION_REST_MS * 6);
    expect(track.scrollLeft).toBe(500);
  });

  it('la rueda/trackpad sobre la pista también pausa, y no se reanuda sola', async () => {
    const { track } = await mountCarousel();
    await act(async () => {
      fireEvent.wheel(track);
      track.scrollLeft = 300;
      fireEvent.scroll(track);
    });
    expect(statusLine()).toHaveTextContent('Rotación automática pausada.');
    await expectFrozen(track);
    expect(track.scrollLeft).toBe(300);
  });

  it('el foco que el navegador persigue hasta una teja fuera de pantalla también pausa (§23.5)', async () => {
    const { track } = await mountCarousel();
    await act(async () => {
      fireEvent.focus(track);
      track.scrollLeft = 800;
      fireEvent.scroll(track);
    });
    expect(statusLine()).toHaveTextContent('Rotación automática pausada.');
    // Y la pausa es PERMANENTE: ni siquiera al soltar el foco vuelve a rotar.
    await act(async () => {
      fireEvent.focusOut(track, { relatedTarget: document.body });
    });
    await expectFrozen(track);
    expect(track.scrollLeft).toBe(800);
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
    // No se anunció pausa alguna…
    expect(statusLine()).toHaveTextContent('');
    // …y la prueba de verdad: el tic siguiente OCURRE. Si el re-snap se hubiera leído como
    // intervención, la pista se quedaría en 32 para siempre y la función saldría muerta.
    await settle(ROTATION_REST_MS);
    expect(track.scrollLeft).toBe(SNAPS[1]);
  });

  /**
   * **LOS DOS BORDES DE LA VENTANA, EN MILISEGUNDOS ABSOLUTOS.** Este caso cubre el lado de DENTRO
   * (a 1199 ms el antecedente sigue vivo) y el de abajo el de FUERA (a 1201 ms ya caducó).
   *
   * ⚠️ Los dos esperan **literales**, no `USER_INPUT_WINDOW_MS ± 1`. Con la constante los tiempos se
   * movían **con** ella y lo único que quedaba pinneado era la FORMA del predicado, no el número:
   * `USER_INPUT_WINDOW_MS = 300` dejaba la suite entera en verde. Con 1199/1201 literales, mover la
   * ventana en cualquier dirección pone en rojo uno de los dos (el candado del número vive además
   * en el `toBe` de la cabecera de este archivo; esto es el borde de conducta que lo acompaña).
   *
   * El valor no es una comodidad: es una MEDICIÓN de navegador (la inercia del trackpad sigue
   * emitiendo `scroll` bastante después del último `wheel`). Acortarla se lleva por delante la
   * pausa por swipe en táctil, que es §23.13 nº9.
   */
  it('la ventana de §23.5a dura de verdad: a 1199 ms EXACTOS el gesto del usuario TODAVÍA cuenta', async () => {
    const { track } = await mountCarousel();
    await act(async () => {
      fireEvent.pointerDown(track);
    });
    // Justo dentro de la ventana, en absoluto: el antecedente del usuario sigue vivo a 1199 ms.
    await settle(1199);
    await act(async () => {
      track.scrollLeft = 700;
      fireEvent.scroll(track);
    });
    expect(statusLine()).toHaveTextContent('Rotación automática pausada.');
    await expectFrozen(track);
    expect(track.scrollLeft).toBe(700);
  });

  it('a 1201 ms EXACTOS el antecedente ya caducó: un scroll del motor tampoco pausa', async () => {
    const { track } = await mountCarousel();
    await act(async () => {
      fireEvent.pointerDown(track);
    });
    // Literal, no `USER_INPUT_WINDOW_MS + 1`: alargar la ventana tiene que poner esto en rojo.
    await settle(1201);
    await act(async () => {
      track.scrollLeft = 60;
      fireEvent.scroll(track);
    });
    expect(statusLine()).toHaveTextContent('');
    // Sigue rotando: el tic siguiente llega igual.
    await settle(ROTATION_REST_MS);
    expect(track.scrollLeft).toBe(SNAPS[1]);
  });

  it('pulsar una flecha pausa para siempre (flechas y rotación no se disputan la pista)', async () => {
    const { track } = await mountCarousel();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    });
    expect(statusLine()).toHaveTextContent('Rotación automática pausada.');
    const after = track.scrollLeft;
    await settle(ROTATION_REST_MS * 6);
    expect(track.scrollLeft).toBe(after);
  });

  /**
   * El `scroll` que emite NUESTRO propio tic no pausa — y lo importante es **POR QUÉ**: no lleva
   * ninguna marca de origen, lo bloquea el mismo y único discriminante de §23.5a (no hay antecedente
   * de usuario en los 1200 ms previos). Aquí hubo una segunda guarda («lo originamos nosotros») y se
   * retiró por redundante y dañina; este test es el que fija que la que queda basta.
   *
   * Medición que lo respalda (Chromium, build de producción, listener desde ANTES de hidratar):
   * **53 eventos `scroll` en una pasada completa sin tocar nada, CERO con antecedente de usuario** —
   * incluido el `scroll-snap` de la hidratación que motivó §23.5a.
   */
  it('el scroll de NUESTRO propio tic no pausa, y lo bloquea el antecedente (no una marca de origen)', async () => {
    const { track } = await mountCarousel();
    await settle(ROTATION_REST_MS);
    expect(track.scrollLeft).toBe(SNAPS[1]);
    // El deslizamiento suave del tic emite `scroll` sin que nadie haya tocado la pista.
    await act(async () => {
      fireEvent.scroll(track);
      fireEvent.scroll(track);
    });
    expect(statusLine()).toHaveTextContent('');
    // Y la pasada continúa como si nada.
    await settle(ROTATION_REST_MS);
    expect(track.scrollLeft).toBe(SNAPS[2]);
  });

  /**
   * ⚠️ **CONTRACARA DEL ANTERIOR, Y LA NORMA ES UN «SI Y SOLO SI».** §23.5a: un `scroll` pausa si y
   * solo si hay `pointerdown`/`touchstart`/`wheel`/`keydown`/`focus` en los 1200 ms previos. Un
   * gesto REAL que cae dentro del deslizamiento de un tic **tiene** ese antecedente ⇒ **pausa**.
   *
   * Aquí vivía un test que afirmaba lo contrario (que ese mismo gesto NO pausaba) y pasaba en verde,
   * porque el código tenía una guarda que hacía ganar a la evidencia débil. Es el escenario del
   * pulgar en táctil: se traga el swipe y la rotación se reanuda 7 s después — §23.13 nº9 lo prohíbe
   * expresamente. Medido en Chromium antes de arreglarlo: rueda a **+56 ms** de arrancar un tic ⇒
   * conmutador en PAUSAR y `scrollLeft` 460 → 756 él solo.
   *
   * **Doctrina que este test fija: cuando las dos evidencias coexisten, gana el humano.**
   */
  it('un gesto REAL dentro del deslizamiento del tic PAUSA: el antecedente del usuario gana (§23.5a)', async () => {
    const { track } = await mountCarousel();
    await settle(ROTATION_REST_MS);
    const afterTick = track.scrollLeft;
    expect(afterTick).toBe(SNAPS[1]);

    // El dedo llega mientras el tic todavía se está asentando.
    await act(async () => {
      fireEvent.pointerDown(track);
      track.scrollLeft = 620;
      fireEvent.scroll(track);
    });
    expect(statusLine()).toHaveTextContent('Rotación automática pausada.');

    // Y no se reanuda sola: eso es exactamente lo que el test falso permitía.
    await settle(ROTATION_REST_MS * 6);
    expect(track.scrollLeft).toBe(620);
  });

  it('llegar por el ancla #piezas-destacadas detiene la rotación, sin rebobinar', async () => {
    window.location.hash = '#piezas-destacadas';
    const { track } = await mountCarousel();
    expect(statusLine()).toHaveTextContent('Rotación automática pausada.');
    await settle(ROTATION_REST_MS * 4);
    expect(track.scrollLeft).toBe(0);
  });

  /**
   * **EL CAMINO PRIMARIO DEL ANCLA, que no tenía red.** El test de arriba pone el `hash` ANTES de
   * montar, así que ejercita el `check()` del montaje y **nunca** el listener de `hashchange`. Pero
   * el caso real de §22.4a es mid-visit: el usuario ya está en la home leyendo la nota al pie del
   * gancho y pulsa el regreso ⇒ el `hash` cambia **con el componente montado y rotando**. Ése es el
   * camino que importa, y era el que estaba descubierto.
   */
  it('el regreso de la nota al pie MID-VISIT (hashchange, ya montado y rotando) también pausa', async () => {
    const { track } = await mountCarousel();
    // Rotando de verdad: un tic ya ocurrió.
    await settle(ROTATION_REST_MS);
    expect(track.scrollLeft).toBe(SNAPS[1]);

    await act(async () => {
      window.location.hash = `#${FEATURED_CAROUSEL_ID}`;
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });

    expect(statusLine()).toHaveTextContent('Rotación automática pausada.');
    // «No se rebobina: solo se detiene» (§23.5) — se queda donde estaba, y ahí se queda.
    expect(track.scrollLeft).toBe(SNAPS[1]);
    await settle(ROTATION_REST_MS * 4);
    expect(track.scrollLeft).toBe(SNAPS[1]);
  });

});

describe('§23.6 · una pasada y para (R7)', () => {
  it('al llegar al extremo se detiene y se anuncia el fin — y ahí se queda', async () => {
    const { track } = await mountCarousel();
    // 6 tics alcanzables + el 7.º que descubre que no queda pista.
    await settle(ROTATION_REST_MS * 7);
    expect(track.scrollLeft).toBe(MAX_SCROLL);
    expect(statusLine()).toHaveTextContent('Fin de las piezas destacadas.');
    // La flecha «siguiente» queda apagada: TERMINADO es el MISMO predicado (§23.6).
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled();

    // Y no vuelve a moverse nunca: sin bucle, sin rebobinado automático.
    await settle(ROTATION_REST_MS * 6);
    expect(track.scrollLeft).toBe(MAX_SCROLL);
  });

  /**
   * Terminada la pasada, la flecha «anterior» devuelve pista por delante: `nextScrollTarget` vuelve
   * a tener a dónde ir. Es el escenario en el que un carrusel mal frenado **se relanza solo**. No
   * pasa, y ya no hay control que pueda relanzarlo tampoco.
   */
  it('desde TERMINADO, retroceder con la flecha «anterior» NO vuelve a rotar solo', async () => {
    const { track } = await mountCarousel();
    await settle(ROTATION_REST_MS * 7);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Anterior' }));
    });
    const after = track.scrollLeft;
    expect(after).toBeLessThan(MAX_SCROLL);
    await settle(ROTATION_REST_MS * 5);
    expect(track.scrollLeft).toBe(after);
  });

  /**
   * **§23.9(c): COMO MUCHO UN MENSAJE POR VISITA — y la guarda que lo sostiene no tenía prueba.**
   *
   * `pauseByIntervention` arranca con `if (modeRef.current !== 'playing') return;`. Al retirar el
   * conmutador esa guarda quedó descrita en el código como vía muerta («la transición `ended` →
   * `paused` no tiene efecto observable»), y eso **subestima lo que hace hoy**: borrarla emite
   * «Rotación automática pausada.» **DESPUÉS** de «Fin de las piezas destacadas.», o sea **dos**
   * anuncios en la misma visita, en el canal que ux-ui subió a obligatorio.
   *
   * No es hipotético. Tres caminos reales llegan aquí después del fin de la pasada, y los tres
   * llaman a `pauseByIntervention` **incondicionalmente**: la flecha «anterior» (`goByArrow`), un
   * swipe sobre la pista, y el regreso por ancla de §22.4a vía `hashchange`. Ninguno de los diez
   * casos que se retiraron con el conmutador cubría esto, y ningún test interviene tras `ended` y
   * lee la línea de estado ⇒ **la mutación pasaba en verde**. Éste es el candado.
   */
  it('tras el fin, una intervención NO añade un segundo anuncio: el canal dice UNA cosa por visita (§23.9c)', async () => {
    const { track } = await mountCarousel();
    await settle(ROTATION_REST_MS * 7);
    expect(track.scrollLeft).toBe(MAX_SCROLL);
    expect(statusLine()).toHaveTextContent('Fin de las piezas destacadas.');

    // La flecha «anterior» llama a `pauseByIntervention()` sin mirar el modo: la guarda es lo único
    // que impide que el lector de pantalla oiga «pausada» encima de «fin».
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Anterior' }));
    });
    expect(statusLine()).toHaveTextContent('Fin de las piezas destacadas.');

    // Y por el otro camino real: un gesto del usuario sobre la pista, ya terminada la pasada.
    await act(async () => {
      fireEvent.pointerDown(track);
      track.scrollLeft = 400;
      fireEvent.scroll(track);
    });
    expect(statusLine()).toHaveTextContent('Fin de las piezas destacadas.');
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
      // Ninguna otra teja se convierte en HD (eso dispararía una descarga cada 5 s, §34.1).
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

// §23.9 — el nombre accesible de la región NO habla de rotación, ni de carrusel, ni de grading:
// solo nombra la sección. La regex vive en una CONSTANTE COMPARTIDA a propósito, porque el caso de
// control de más abajo la reusa: una aserción negativa que nadie prueba en positivo puede estar
// muerta y seguir verde. Aquí lo estuvo — la `e` de `grade` era el homoglifo cirílico U+0435
// (heredado de `main`), así que ese brazo exigía `grad` + U+0435 y NINGÚN copy latino podía
// dispararlo. Duplicar el literal en el control no habría servido de nada: se comparte el objeto.
//
// El brazo del gancho es `grad`, NO `grade`: la norma que enuncia la primera línea de este comentario
// —y §22.6b-e, que es sobre el gancho de grading entero— cubre la FAMILIA completa
// (`grade`/`graded`/`grading`/`gradeadas`/`gradeo`). `grade` dejaba fuera «grading» y «gradeo», que son
// justo las formas que usaría un copy nuevo. El brazo siempre estuvo escrito para la familia; el
// homoglifo solo tapó que no la cubría. Falso positivo: ninguna palabra legítima que quepa en el
// título de la sección de destacadas contiene `grad`.
const NOMBRE_ACCESIBLE_PROHIBIDO = /rotaci|carrus|grad|PSA/i;

describe('§23.9 · anuncio a lectores de pantalla (patrón APG)', () => {
  it('la sección se anuncia como carrusel sin cambiar su aria-label (§22.6b-e sigue vigente)', async () => {
    await mountCarousel();
    const section = getSection();
    expect(section).toHaveAttribute('aria-roledescription', 'carrusel');
    expect(section).toHaveAttribute('aria-label', 'Piezas destacadas');
    expect(section.getAttribute('aria-label')).not.toMatch(NOMBRE_ACCESIBLE_PROHIBIDO);
  });

  // CONTROL de la aserción negativa de arriba. Cada cadena existe para disparar UN brazo de la
  // regex; si un brazo vuelve a quedar inerte (homoglifo, dedazo, alguien que lo "simplifica"),
  // este caso se pone rojo y lo dice, en vez de aprobar en silencio como pasó con `grade`.
  //
  // Las dos últimas cubren la AMPLIACIÓN a `grad`, y están elegidas para DISCRIMINAR: con el brazo
  // estrechado de vuelta a `grade` ninguna casa, así que estrecharlo es un fallo ruidoso y no una
  // regresión silenciosa de la norma. Ojo con el criterio — «gradeo» NO sirve aquí aunque sea una
  // forma de la familia: contiene `grade` como subcadena, así que pasa con el brazo estrecho y no
  // probaría nada. Tampoco vale colar `PSA` en la cadena: la haría casar por el otro brazo.
  it.each([
    'Cartas gradeadas',
    'Piezas destacadas — rotación automática',
    'Carrusel de destacadas',
    'Gradeadas PSA',
    'Gancho de grading',
    'Grados y certificados',
  ])('el candado del aria-label SÍ rechaza «%s» (control de la aserción negativa)', (nombre) => {
    expect(nombre).toMatch(NOMBRE_ACCESIBLE_PROHIBIDO);
  });

  it('la pista es un tope de tabulación CON NOMBRE y conmuta aria-live con el temporizador', async () => {
    const { track } = await mountCarousel();
    expect(track).toHaveAttribute('tabindex', '0');
    expect(track).toHaveAttribute('aria-live', 'off');
    // Se ata al TEMPORIZADOR, no al modo: basta una suspensión silenciosa (el puntero encima) para
    // que vuelva a `polite`. Antes esto se provocaba pulsando el conmutador.
    await act(async () => {
      getSection().dispatchEvent(new Event('pointerenter'));
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

/**
 * Lo que queda de §23.4 tras retirar el conmutador: el encabezado **vuelve a su fila de tres**
 * (H2 · «Ver todo el catálogo» · flechas), sin ningún control pegado al H2 y sin resto del slot
 * `titleAdjacent` que el carrusel era el único en usar.
 */
describe('§20.3 · el encabezado vuelve a su fila de tres elementos', () => {
  it('el H2 va SUELTO en la fila, sin envoltorio de agrupación ni control pegado', async () => {
    await mountCarousel();
    const heading = screen.getByRole('heading', { level: 2 });
    const headerRow = heading.parentElement!;
    // Con conmutador, el H2 vivía dentro de un `<div>` del slot `titleAdjacent`. Sin él vuelve a
    // colgar directo de la fila del encabezado, que tiene exactamente dos hijos: H2 y grupo derecho.
    expect(headerRow.firstElementChild).toBe(heading);
    expect(headerRow.childElementCount).toBe(2);
    // Y los únicos botones del estante son las dos flechas.
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(['Anterior', 'Siguiente']);
  });

  it('el grupo derecho conserva el link «Ver todo» y las dos flechas', async () => {
    await mountCarousel();
    const rightGroup = screen.getByRole('button', { name: 'Siguiente' }).parentElement!.parentElement!;
    expect(rightGroup.querySelector('a[href$="/catalog"]')).not.toBeNull();
    expect(rightGroup.querySelectorAll('button')).toHaveLength(2);
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
  it('en EN la pista y el rol del carrusel van traducidos (las claves del conmutador ya no existen)', async () => {
    mockCatalog(EIGHT);
    renderWithProviders(<FeaturedCarousel />, 'en');
    await settle(0);
    const track = screen.getByRole('group', { name: 'Featured pieces — scrollable track' });
    applyFakeLayout(track);
    await act(async () => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(screen.getByRole('region', { name: 'Featured pieces' })).toHaveAttribute(
      'aria-roledescription',
      'carousel',
    );
    // El canal de estado sigue localizado: es lo único que el carrusel dice con palabras.
    fireEvent.load(screen.getByAltText(NAMES[0]));
    await settle(ROTATION_REST_MS * 8);
    expect(statusLine()).toHaveTextContent('End of featured pieces.');
  });
});
