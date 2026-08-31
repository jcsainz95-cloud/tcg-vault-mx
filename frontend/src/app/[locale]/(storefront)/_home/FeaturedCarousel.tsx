'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { getCatalog } from '@/lib/api';
import type { GroupedListingSummaryDTO } from '@/types/contract';
import type { AppLocale } from '@/i18n/routing';
import { formatMoneyCents } from '@/lib/format';
import { Link } from '@/i18n/navigation';
import { CardImage } from '@/components/ui/CardImage';
import { Skeleton } from '@/components/ui/Skeleton';
import { QueryState } from '@/components/ui/QueryState';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { Shelf } from '../_shared/Shelf';
import { StockBadge, stockVariantForSingle } from '../_shared/StockBadge';
import { PendingPriceLabel } from '../_shared/PendingPriceLabel';
import { FinishLabel } from '../_shared/FinishLabel';
import { GradingEstimateBadge } from '../_shared/grading/GradingEstimateBadge';
import { useGradingFootnote } from '../_shared/grading/GradingFootnote';
import { pageHasGradingFigures } from '../_shared/grading/estimates';
import {
  SCROLL_TOLERANCE,
  nextScrollTarget,
  pageScrollTarget,
  readTrackGeometry,
  scrollTrackTo,
  trackOverflows,
} from './carouselGeometry';
import { cn } from '@/lib/cn';

const FEATURED = 8;

/** `id` de la sección: destino del regreso de la nota al pie cuando la vitrina no pintó (§22.4a). */
export const FEATURED_CAROUSEL_ID = 'piezas-destacadas';

/** `id` de la PISTA (§23.9b). La sección tiene el suyo; la región viva es la pista. */
export const FEATURED_TRACK_ID = 'piezas-destacadas-pista';

/**
 * Reposo entre tics — y reposo INICIAL (§23.3).
 *
 * Fue 7 s mientras el carrusel llevaba conmutador de reproducción: ese valor se eligió para quedar
 * **por encima** del umbral de 5 s de WCAG 2.2.2 y sostener el argumento del control. Retirado el
 * conmutador (decisión del dueño, ver `docs/FRONTEND_NOTES.md` **§39** — §36 es el pase que
 * CONSTRUYÓ el conmutador, no el que lo retiró), la cadencia deja de estar atada a ese umbral y se
 * fija por ritmo editorial: 5 s. Lo demás del tic NO cambia — una teja por tic, deslizamiento de
 * ~0,5 s, no arranca hasta que cargaron las fotos y hay reposo antes del primero.
 *
 * ⚠️ **ESTE NÚMERO ESTÁ CLAVADO POR TEST, a propósito.** `expect(ROTATION_REST_MS).toBe(5000)` en
 * `FeaturedCarouselRotation.test.tsx` y su hermano en `e2e/featured-rotation.spec.ts`, que además
 * comprueba que el E2E no cronometre con otro número. Sin ellos, cambiarlo dejaba la suite entera en
 * verde (los tests derivan sus tiempos de la constante y se mueven con ella). Es la petición
 * explícita del dueño: cambiarla es una decisión que se toma con dato delante, no un ajuste.
 */
export const ROTATION_REST_MS = 5000;

/**
 * Tope de la precondición 3 de §23.3: si la foto de la teja líder no ha cargado en 3 s desde que la
 * consulta resolvió, la rotación se habilita igual. Sin este tope, una imagen remota lenta dejaría el
 * estante muerto para siempre.
 *
 * Clavado por `expect(LEAD_IMAGE_CAP_MS).toBe(3000)`: los tests derivaban sus tiempos de esta misma
 * constante, así que sin el candado el número podía moverse sin que nada fallara.
 */
export const LEAD_IMAGE_CAP_MS = 3000;

/**
 * Ventana en la que un `scroll` de la pista se atribuye a una acción del usuario, contada desde su
 * última entrada (puntero, dedo, rueda, tecla o foco). Cubre la inercia del trackpad, que sigue
 * emitiendo `scroll` bastante después del último `wheel`.
 *
 * Es la **única** costura entre «lo movió el motor» y «lo movió una persona»: no hay una segunda
 * marca de origen. Ver `handleScroll` — la que había se retiró porque solo disparaba contra la
 * persona a la que decía proteger.
 *
 * ⚠️ **POR QUÉ EXISTE ESTA VENTANA — hallazgo de navegador, no una comodidad.** §23.5 enuncia la
 * regla general «cualquier desplazamiento de la pista que el carrusel no haya originado ⇒ PAUSA
 * PERMANENTE». Implementada al pie de la letra, **el carrusel se pausa solo antes de su primer
 * tic**: Chromium aplica `scroll-snap` ~1 s después de hidratar y mueve `scrollLeft` de 0 al valor
 * del `gutter` (32px en `lg`) por su cuenta. Verificado en Chromium con un listener de captura —
 * un único evento, `#piezas-destacadas-pista`, `scrollLeft: 32`, sin usuario de por medio. Lo mismo
 * hace el anclaje de scroll cuando una imagen tardía cambia el layout.
 *
 * La regla se conserva **en su intención** (el usuario manda y no se reanuda solo) y se acota a lo
 * que la regla nombra: desplazamientos **del usuario**. Un reajuste del motor de layout no es una
 * intervención, y tratarlo como tal deja la función muerta al primer render.
 *
 * **Clavada por tres tests, no por uno:** `expect(USER_INPUT_WINDOW_MS).toBe(1200)` y los dos bordes
 * de conducta en **milisegundos absolutos** (1199 dentro / 1201 fuera). Antes esos dos bordes se
 * calculaban con `USER_INPUT_WINDOW_MS ± 1` y por tanto **se movían con la constante**: `= 300`
 * dejaba la suite entera en verde. Acortarla se lleva por delante la pausa por swipe en táctil
 * (§23.13 nº9); alargarla vuelve a leer el re-snap del motor como intervención.
 */
export const USER_INPUT_WINDOW_MS = 1200;

/**
 * Los tres modos de §23.5, ahora **enteramente internos**: sin conmutador nadie los conmuta a mano y
 * solo el propio carrusel los mueve (`playing` → `paused` por intervención, `playing` → `ended` al
 * acabar la pasada). Se conservan los TRES porque distinguen el anuncio del canal de estado
 * («pausada» vs «fin de las piezas destacadas», §23.9c); colapsarlos en un booleano
 * `rotando/no rotando` haría indistinguibles esos dos anuncios.
 *
 * `paused` y `ended` son ambos TERMINALES en esta visita: nada los devuelve a `playing`.
 */
export type PlaybackMode = 'playing' | 'paused' | 'ended';

/**
 * Fuente del carrusel, COMPARTIDA con la página del home (§22.6b-g). El home decide si hospeda la
 * nota al pie con la **unión** vitrina ∪ carrusel, y tiene que hacerlo sobre **esta misma lista**:
 * dos consultas distintas podrían divergir y reabrir el fallo silencioso (sin nota, `fail-closed`
 * apaga toda cifra y **nadie ve un error**). TanStack dedupe por `queryKey`, así que sigue siendo
 * una sola petición. Es el mismo patrón que ya usa `useGradingGems`.
 *
 * No hay filtro `?gradingHighlight=true` aquí y no hace falta: `GET /catalog/cards` emite
 * `gradingHighlight` en el summary de todo grupo raw elegible, con o sin ese filtro (el filtro solo
 * FILTRA). El carrusel recibe las 8 más caras y algunas resultan traer el marcador.
 */
export function useFeaturedCatalog() {
  return useQuery({
    queryKey: ['catalog', { home: true, sort: 'price_desc' }],
    queryFn: () => getCatalog({ sort: 'price_desc', pageSize: FEATURED }),
  });
}

/** Los grupos que el carrusel pinta. `[]` ⇒ la pista no existe (mensaje de vacío). */
export function featuredOf(
  data: { data: GroupedListingSummaryDTO[] } | undefined,
): GroupedListingSummaryDTO[] {
  return data?.data ?? [];
}

/** Renglón mono de la teja: set · #num (+ empresa/grado si es gradeada). */
function tileMeta(l: GroupedListingSummaryDTO): string {
  const base = `${l.card.setName} · #${l.card.number}`;
  return l.gradingCompany ? `${base} · ${l.gradingCompany} ${l.gradeValue ?? ''}`.trim() : base;
}

/** Precio de la teja: SIEMPRE formateado del server; sin precio ⇒ "pendiente", nunca $0. */
function TilePrice({ l, locale, big = false }: { l: GroupedListingSummaryDTO; locale: AppLocale; big?: boolean }) {
  if (l.salePriceCents == null) {
    return <PendingPriceLabel className="mt-3 block" />;
  }
  return (
    <p
      className={cn(
        'tabular font-medium leading-none text-text',
        big ? 'text-[17px] lg:text-[25px]' : 'mt-3 text-[15px] lg:text-[17px]',
      )}
    >
      {formatMoneyCents(l.salePriceCents, locale)}
    </p>
  );
}

/**
 * «Piezas destacadas del catálogo» (makeover 1a §4): carrusel horizontal con las piezas
 * más caras del inventario publicado (el backend ordena por salePriceCents server-side).
 * Primera teja grande, resto numeradas en mono rojo (numeración decorativa, aria-hidden
 * §20.3). v1.38-grouped-listings (P-30): la fuente (GET /catalog/cards) es AGRUPADA, así que
 * cada teja es un `GroupedListingSummaryDTO` (v2.1.9/D2: la rejilla ya no recibe `priceBasis`
 * ni `referenceValue`) con `stockCount` real (badge Queda 1 / N en stock).
 *
 * **CUARTA superficie del gancho de grading (§22.6b).** Las dos tejas de esta pista pueden llevar la
 * burbuja del estimado. Tres cosas que NO son negociables aquí:
 *
 *  - **El caso disparejo es el NORMAL.** La pista ordena por precio descendente y el gate de ROI
 *    castiga justo a las caras: lo esperable es **cero burbujas**, y cuando las haya, una o dos entre
 *    ocho. Por eso el badge es el ÚLTIMO elemento de las dos tejas y **no se compensa nada**: sin
 *    `min-height`, sin espacio reservado, sin regla ni guion de relleno, sin skeleton del badge y sin
 *    reordenar por elegibilidad (§22.6b-d/i). La ausencia no es un estado degradado.
 *  - **La teja es un `<a>` que envuelve todo**, así que el badge queda DENTRO del enlace y su texto
 *    forma parte del **nombre accesible**: el lector anuncia nombre, set, precio, stock, la cifra y
 *    el micro-aviso completo. Eso es deseable ⇒ **prohibido ponerle `aria-label` al enlace** de la
 *    teja: sustituiría el contenido y borraría el aviso del árbol de accesibilidad, que es el
 *    defecto bloqueante que §22.4c corrigió (§22.6b-h).
 *  - **El encabezado NO cambia** (§22.6b-e): sin kicker, sin subtítulo, sin mención al gradeo. El
 *    carrusel no es una vitrina de gancho; es la pista de las piezas más caras, y algunas resultan
 *    llevar además una cifra estimada.
 *
 * ───────────────────────────────────────────────────────────────────────────────────────────────
 * **ROTACIÓN AUTOMÁTICA (P-49, §23).** Un tic cada 5 s mueve la VENTANA exactamente UNA teja, hace
 * UNA sola pasada y se detiene.
 *
 * **SIN CONMUTADOR DE REPRODUCCIÓN (decisión del dueño, §23 rev.).** El par PAUSAR/REANUDAR/REPETIR
 * se retiró: existía para satisfacer WCAG 2.2.2, que es un **estándar del W3C, no una obligación
 * legal** para esta tienda (en México las obligaciones con dientes son para sitios de gobierno, y la
 * norma europea que cubre comercio electrónico solo aplicaría vendiendo a Europa). Lo que NO se
 * retiró —y es lo que de verdad protege a alguien— son los **cinco frenos automáticos**: hover,
 * foco de teclado, intervención del usuario (pausa permanente, §23.5a), visibilidad
 * (`IntersectionObserver` + pestaña oculta) y `prefers-reduced-motion`. La retirada y su porqué están
 * en `docs/FRONTEND_NOTES.md` **§39**; §36 documenta el pase que CONSTRUYÓ el conmutador y describe
 * piezas (`PlaybackToggle`, el slot `titleAdjacent`, «las 10 claves de §23.12») que **ya no existen**.
 * Las cuatro cosas que no pueden romperse aquí:
 *
 *  - **R1 — rota la ventana, nunca el ROL.** La teja 1 sigue siendo la teja 1, con su `imageLargeUrl`
 *    y su `priority`/LCP. Si la teja 2 «ascendiera» a líder, cada tic remaquetaría dos tejas y
 *    **dispararía una descarga HD nueva cada 5 s** — justo lo que arregló §34.1 de estas notas.
 *
 *    **La garantía NO es «el tic no provoca `setState`»** — eso es falso: el tic llama a `measure()`,
 *    que escribe `canPrev`/`canNext`/`overflows`, y hay re-render en el primer tic y en el último. La
 *    garantía es otra y es más fuerte: **el rol de teja se deriva del ÍNDICE del array** (`i === 0`)
 *    sobre una lista que la rotación **jamás toca**, con `key` estable
 *    (`representativeInventoryItemId`) ⇒ React reconcilia en sitio: mismo nodo, mismo `src`, mismo
 *    `fetchpriority`, pase lo que pase con el estado. Un `setState` nuevo aquí **no rompería el LCP**;
 *    lo que lo rompería es derivar el rol de algo que la rotación mueve. Quien fije eso es el test
 *    «la teja líder conserva identidad, sitio, imagen HD y fetchpriority en TODOS los tics»
 *    (`FeaturedCarouselRotation.test.tsx`): el invariante se sostiene **por** ese test, no sin él.
 *  - **R2 — nunca coexiste con carga.** Cuatro precondiciones (§23.3): hidratado, consulta resuelta
 *    con ≥1 teja, foto de la líder cargada (o 3 s), y 5 s de reposo inicial. Es la condición que
 *    desactiva el argumento de §17.3 («el movimiento aquí se lee como carga»): no puede confundirse
 *    con carga algo que por construcción nunca ocurre mientras hay carga.
 *  - **R4 — `prefers-reduced-motion` ⇒ movimiento CERO**, y se enforza AQUÍ, no en `globals.css`: la
 *    regla global solo anula duraciones de CSS, y no cubre ni el scroll por JS ni un temporizador
 *    (§8.2). Con la preferencia activa el temporizador **no arranca** y las flechas pasan a
 *    `behavior:'auto'`. Se escucha **en vivo**. **Éste es innegociable**: es el único freno que
 *    protege a una persona con trastorno vestibular ANTES de que el movimiento ocurra.
 *  - **R5 — la intervención del usuario gana para siempre** (en esta visita): swipe, rueda, flecha,
 *    ancla o cualquier scroll que no hayamos originado nosotros ⇒ PAUSADO, sin reanudación sola.
 */
export function FeaturedCarousel() {
  const t = useTranslations('home');
  const tc = useTranslations('common');
  const locale = useLocale() as AppLocale;
  const anchors = useGradingFootnote();

  const catalog = useFeaturedCatalog();
  const featured = featuredOf(catalog.data);

  /**
   * §22.6b-c — **numeración condicional POR PISTA, todo o nada.** Si el carrusel pinta al menos una
   * cifra, la numeración `01·02·03` desaparece de las OCHO tejas: un ordinal rojo encima de un «vale
   * ≈ MX$29,000» se lee como *ranking de oportunidad* (la afirmación que §O prohíbe), sería el
   * tercer rojo de una teja de 160px (§22.10 nº3) y quitarlo solo en las tejas con burbuja
   * desalinearía los nombres de la fila.
   *
   * El predicado es el MISMO que gobierna las cifras — incluido el `fail-closed` de la nota al pie:
   * sin boundary activa el badge devuelve `null`, así que sin `anchors` NO se pinta ninguna cifra y
   * la numeración se queda. Así es imposible que la pista pierda los números sin ganar la burbuja.
   *
   * §23.10: la rotación **no lo toca**. Como no reordena el DOM, `02` sigue siendo la segunda teja
   * del DOM la mire quien la mire, y el predicado se evalúa con los datos resueltos — su resultado
   * no puede cambiar por desplazarse.
   */
  const trackShowsFigures = anchors !== null && pageHasGradingFigures(featured);
  const showNumbering = !trackShowsFigures;

  const scrollerRef = useRef<HTMLDivElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(false);
  /** ¿La pista desborda? Si todo cabe no hay nada que rotar NI que frenar (§23.4d nº3). */
  const [overflows, setOverflows] = useState(false);

  /**
   * §23.8 — el estado inicial es la pista de scroll-snap NATIVA, que no rota y no pinta flechas. No
   * es un fallback degradado: rotación y flechas nacen del mismo JS, en el mismo momento, así que
   * sin JS no hay movimiento que frenar.
   */
  const [hydrated, setHydrated] = useState(false);
  const [leadImageReady, setLeadImageReady] = useState(false);
  const [mode, setMode] = useState<PlaybackMode>('playing');
  const [statusMessage, setStatusMessage] = useState('');

  // Suspensiones de nivel 1 (§23.5): temporales, silenciosas y reversibles solas.
  const [pointerInside, setPointerInside] = useState(false);
  const [focusInside, setFocusInside] = useState(false);
  const [tabVisible, setTabVisible] = useState(true);
  // Sin IntersectionObserver (jsdom, navegadores viejos) se asume visible: el resto de frenos sigue.
  const [inView, setInView] = useState(true);

  /**
   * §8.2/§23.7 — se ESCUCHA EN VIVO, no se lee una vez al montar: activar la preferencia en el
   * sistema operativo detiene la rotación en ese instante, sin recargar. `useMediaQuery` devuelve
   * `false` en SSR/primer render, que es correcto: antes de hidratar no hay rotación de todas
   * formas.
   */
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');

  const modeRef = useRef<PlaybackMode>(mode);
  /**
   * > 0 ⇒ el usuario tocó la pista hace menos de `USER_INPUT_WINDOW_MS`, así que un `scroll` SÍ es
   * suyo. Es el ÚNICO discriminante de §23.5a, a propósito (ver `handleScroll`).
   */
  const userInputRef = useRef(0);
  const settleTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => setHydrated(true), []);

  const measure = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) {
      setOverflows(false);
      setCanPrev(false);
      setCanNext(false);
      return;
    }
    const g = readTrackGeometry(el);
    setOverflows(trackOverflows(g));
    // §23.13 nº13: el apagado de las flechas en los extremos NO cambia — mismo predicado de §20.3.
    setCanPrev(g.scrollLeft > SCROLL_TOLERANCE);
    setCanNext(g.scrollLeft < g.maxScroll - SCROLL_TOLERANCE);
  }, []);

  useEffect(() => {
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure, featured.length]);

  /** Precondición 3 de §23.3 con su tope de 3 s, armado en cuanto la consulta resuelve. */
  useEffect(() => {
    if (featured.length === 0) return;
    const id = setTimeout(() => setLeadImageReady(true), LEAD_IMAGE_CAP_MS);
    return () => clearTimeout(id);
  }, [featured.length]);

  useEffect(
    () => () => {
      settleTimersRef.current.forEach(clearTimeout);
      settleTimersRef.current.clear();
    },
    [],
  );

  /**
   * Desplaza la pista. **No marca el movimiento de ninguna forma**: no hace falta y marcarlo hacía
   * daño (ver `handleScroll`). Un `scroll` nuestro nunca pausa porque nunca tiene antecedente de
   * usuario, no porque lleve una etiqueta.
   *
   * ⚠️ `measure()` escribe `canPrev`/`canNext`/`overflows` ⇒ **esto SÍ puede re-renderizar**. Lo que
   * protege el LCP no es la ausencia de `setState` (ver el bloque R1 de la cabecera del componente).
   */
  const moveTrack = useCallback(
    (el: HTMLDivElement, left: number, smooth: boolean) => {
      scrollTrackTo(el, left, smooth ? 'smooth' : 'auto');
      measure();
    },
    [measure],
  );

  // Los textos del canal de estado, en un ref para que los listeners nativos (registrados una sola
  // vez) no queden con la traducción del primer render. Se escribe en un EFECTO, no en fase de
  // render: mutar un ref al renderizar es idempotente aquí, pero bajo StrictMode (doble render) es
  // el patrón que muerde, y no hay razón para pagarlo. Este efecto va declarado ANTES que el del
  // ancla (§23.5), que es el único que puede leer estos textos en el primer commit.
  const statusTextRef = useRef({ paused: '', ended: '' });
  useEffect(() => {
    statusTextRef.current = {
      paused: t('featured.status.paused'),
      ended: t('featured.status.ended'),
    };
  });

  /**
   * PAUSA PERMANENTE por intervención (§23.5 nivel 2). **Solo desde `playing`**.
   *
   * ⚠️ **LA GUARDA NO ES UNA VÍA MUERTA — protege el canal de estado, y es lo primero que hay que
   * saber de ella.** (Aquí se describía como una rama sin efecto observable; eso subestimaba lo que
   * hace.) Sus llamadores la invocan **incondicionalmente**: `goByArrow` con las dos flechas,
   * `handleScroll` con cualquier gesto, y el listener de `hashchange` del regreso por ancla de
   * §22.4a. Sin este `return`, cualquiera de los tres **después** del fin de la pasada emitiría
   * «Rotación automática pausada.» encima de «Fin de las piezas destacadas.» ⇒ **dos anuncios en la
   * misma visita**, y §23.9(c) permite **como mucho uno**. Caminos reales, no hipotéticos: la flecha
   * «anterior» tras el fin, un swipe tras el fin, y el regreso por ancla mid-visit.
   *
   * Lo que sí se retiró aquí fue la transición `ended` → `paused` (cambiar de modo, sin anuncio):
   * la pedía §23.6 **por el conmutador**, y sin control los dos modos dejan el temporizador parado y
   * la pista en `aria-live="polite"`, así que el cambio de modo no era observable. **El `return`
   * temprano no se fue con ella** y no puede irse: no es la rama muerta, es lo contrario.
   *
   * Fijado por `tras el fin, una intervención NO añade un segundo anuncio` en
   * `FeaturedCarouselRotation.test.tsx`. Borrar esta línea lo pone rojo.
   */
  const pauseByIntervention = useCallback(() => {
    if (modeRef.current !== 'playing') return;
    setStatusMessage(statusTextRef.current.paused);
    modeRef.current = 'paused';
    setMode('paused');
  }, []);

  const pauseRef = useRef(pauseByIntervention);
  useEffect(() => {
    pauseRef.current = pauseByIntervention;
  });

  /**
   * Marca que el usuario acaba de tocar la pista. Se cuelga de las cinco entradas que pueden
   * desplazarla: dedo, puntero, rueda/trackpad, teclado y —para el caso que §23.5 nombra
   * expresamente— el foco que el navegador persigue hasta una teja fuera de pantalla.
   */
  const noteUserInput = useCallback(() => {
    userInputRef.current += 1;
    const id = setTimeout(() => {
      userInputRef.current = Math.max(0, userInputRef.current - 1);
      settleTimersRef.current.delete(id);
    }, USER_INPUT_WINDOW_MS);
    settleTimersRef.current.add(id);
  }, []);

  /**
   * §23.5a **al pie de la letra, y es un SI Y SOLO SI**: un `scroll` de la pista pausa para siempre
   * **si y solo si** hay `pointerdown`/`touchstart`/`wheel`/`keydown`/`focus` sobre la sección en la
   * ventana de `USER_INPUT_WINDOW_MS` anterior. Una guarda, no dos, y la que hay es la que la norma
   * enuncia. Cubre swipe, arrastre, rueda/trackpad y el scroll que provoca el navegador al tabular a
   * una teja fuera de pantalla, sin enumerarlos uno por uno.
   *
   * **Aquí había una segunda guarda («el scroll lo originamos NOSOTROS») y se retiró.** No hacía
   * falta y hacía daño:
   *
   *  - **No hacía falta.** Nuestro propio tic no tiene antecedente de usuario, así que el
   *    antecedente ya lo bloquea solo. Medido en Chromium sobre la home real (build de producción)
   *    desde ANTES de hidratar: **53 eventos `scroll` en una pasada completa sin tocar nada —
   *    incluido el `scroll-snap` de la hidratación (`t≈954 ms`, `scrollLeft: 32`) que motivó §23.5a—
   *    y CERO con antecedente de usuario**. La ventana de 1200 ms los descarta los 53.
   *  - **Hacía daño.** El único escenario en que cambiaba el resultado era un gesto REAL dentro de
   *    los ~900 ms posteriores a un tic: ahí las dos evidencias coexistían y ganaba la débil. Medido:
   *    rueda sobre la pista a **+56 ms** de arrancar un tic ⇒ el modo se quedaba en `playing`, el
   *    gesto se tragaba, y al retirar el puntero **la rotación se reanudaba sola** (`scrollLeft`
   *    460 → 756). Eso es R5 incumplido y §23.13 nº9 exactamente.
   *
   * La doctrina que queda escrita: **el antecedente del usuario es la evidencia más fuerte; cuando
   * dos evidencias coexisten, gana el humano.** No vuelvas a meter una marca de origen aquí sin
   * traer el escenario concreto en que la persona se equivoca y el motor acierta.
   */
  const handleScroll = useCallback(() => {
    measure();
    if (userInputRef.current === 0) return;
    pauseByIntervention();
  }, [measure, pauseByIntervention]);

  /** Un tic: UNA teja, al punto de snap de la entrante. `false` ⇒ se acabó la pista (§23.6). */
  const tick = useCallback((): boolean => {
    const el = scrollerRef.current;
    if (!el) return false;
    const target = nextScrollTarget(readTrackGeometry(el));
    if (target === null) {
      modeRef.current = 'ended';
      setMode('ended');
      setStatusMessage(statusTextRef.current.ended);
      return false;
    }
    moveTrack(el, target, true);
    return true;
  }, [moveTrack]);

  const tickRef = useRef(tick);
  useEffect(() => {
    tickRef.current = tick;
  });

  /**
   * Las cuatro precondiciones de §23.3 + los tres apagados de §23.4d.
   *
   * ⚠️ **Este booleano gobernaba DOS cosas y ahora gobierna UNA — la que importa.** Era, a la vez,
   * «¿hay rotación?» y «¿se pinta el conmutador?». Al retirar el control **no se retira el
   * predicado**: sigue siendo la única puerta de `timerRunning`, y con ella siguen vivos el apagado
   * por `prefers-reduced-motion` (R4), el de pista que no desborda, el de una sola teja y el de
   * consulta en carga o en error. Quitarlo «porque ya no hay botón que pintar» encendería la
   * rotación en los cuatro casos en que hoy está apagada.
   */
  const rotationPossible =
    hydrated &&
    !reducedMotion &&
    !catalog.isLoading &&
    !catalog.isError &&
    featured.length > 1 &&
    overflows;

  const suspended = pointerInside || focusInside || !tabVisible || !inView;
  /** ¿Corre el temporizador AHORA MISMO? Es lo que ata el `aria-live` de la pista (§23.9b). */
  const timerRunning = rotationPossible && leadImageReady && mode === 'playing' && !suspended;

  /**
   * El temporizador. Cada vez que `timerRunning` vuelve a `true` el reposo de 5 s empieza **de
   * cero**: eso implementa «ni un solo tic acumulado» (§23.3) sin código extra — al retirar el ratón
   * o volver a la pestaña nunca hay un tic inmediato ni una ráfaga de tics perdidos.
   *
   * El tic **sí** escribe estado de React: `measure()` fija `canPrev`/`canNext`/`overflows`, así que
   * hay re-render en el primer tic (se enciende «anterior»), en el último (se apaga «siguiente») y en
   * el que termina la pasada. Lo que NO cambia es el DOM de las tejas, y no por ahorro de `setState`
   * sino porque el rol se deriva del índice de una lista inmutable con `key` estable — ver el bloque
   * R1 de la cabecera del componente.
   */
  useEffect(() => {
    if (!timerRunning) return;
    let id: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      id = setTimeout(() => {
        if (tickRef.current()) schedule();
      }, ROTATION_REST_MS);
    };
    schedule();
    return () => {
      if (id !== undefined) clearTimeout(id);
    };
  }, [timerRunning]);

  /** Suspensión por pestaña oculta (§23.5). */
  useEffect(() => {
    const onVisibility = () => setTabVisible(document.visibilityState === 'visible');
    onVisibility();
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  /**
   * Suspensión por puntero y por FOCO, sobre la sección entera (encabezado + pista, §23.5).
   * Listeners nativos y no props de React: así entrar con el ratón no re-renderiza el estante.
   *
   * La pausa por foco no es solo accesibilidad: sin ella, tabular por las tejas mientras la pista
   * rota produce una pelea —el navegador desplaza para traer el foco a la vista y el temporizador
   * desplaza en sentido contrario— y el foco se pierde de la pantalla.
   */
  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const onPointerEnter = () => setPointerInside(true);
    const onPointerLeave = () => setPointerInside(false);
    const onFocusIn = () => setFocusInside(true);
    const onFocusOut = (e: FocusEvent) => {
      if (!el.contains(e.relatedTarget as Node | null)) setFocusInside(false);
    };
    el.addEventListener('pointerenter', onPointerEnter);
    el.addEventListener('pointerleave', onPointerLeave);
    el.addEventListener('focusin', onFocusIn);
    el.addEventListener('focusout', onFocusOut);
    return () => {
      el.removeEventListener('pointerenter', onPointerEnter);
      el.removeEventListener('pointerleave', onPointerLeave);
      el.removeEventListener('focusin', onFocusIn);
      el.removeEventListener('focusout', onFocusOut);
    };
  }, []);

  /** Suspensión por «menos del 50 % de la pista visible» (§23.5). */
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const viewportH = window.innerHeight || 0;
          // Escotilla para pistas más altas que el viewport: ahí el ratio nunca llega a 0,5 y el
          // carrusel quedaría congelado con la pista llenando la pantalla.
          const fillsViewport = viewportH > 0 && entry.intersectionRect.height >= viewportH * 0.5;
          setInView(entry.intersectionRatio >= 0.5 || (entry.isIntersecting && fillsViewport));
        }
      },
      { threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [featured.length]);

  /**
   * §23.5 — llegar por ancla (`#piezas-destacadas`, el regreso de la nota al pie del gancho, §22.4a)
   * pausa. Quien llega por el ancla viene a inspeccionar algo concreto: que la ventana se le mueva
   * bajo los ojos es el peor momento posible. **No se rebobina**: solo se detiene.
   */
  useEffect(() => {
    const check = () => {
      if (window.location.hash === `#${FEATURED_CAROUSEL_ID}`) pauseRef.current();
    };
    check();
    window.addEventListener('hashchange', check);
    return () => window.removeEventListener('hashchange', check);
  }, []);

  /**
   * Flechas (§20.3). Su paso NO cambia —siguen moviendo ~una página, §23.13 nº13— pero ahora
   * **aterrizan en el punto de snap de una teja** en vez de en un píxel arbitrario: `0,8 × ancho` no
   * es múltiplo del paso de teja, así que el reposo dejaba media teja cortada por el borde izquierdo
   * (§23.15 nº2). Y pulsar una flecha es intervención: PAUSA PERMANENTE, así flechas y rotación no
   * se disputan la pista.
   */
  function goByArrow(dir: 1 | -1) {
    const el = scrollerRef.current;
    if (!el) return;
    const target = pageScrollTarget(readTrackGeometry(el), dir);
    pauseByIntervention();
    if (target === null) return;
    // §23.7: con movimiento reducido la flecha sigue funcionando, pero salta — nunca «suave lento».
    moveTrack(el, target, !reducedMotion);
  }

  const arrowBase = 'inline-flex h-8 w-8 items-center justify-center border lg:h-[38px] lg:w-[38px]';

  return (
    <Shelf
      id={FEATURED_CAROUSEL_ID}
      sectionRef={sectionRef}
      // §22.6b-g: el regreso de la nota al pie puede aterrizar aquí, así que la sección necesita su
      // propio `scroll-mt` derivado de `--app-header-h` (§4.5) para no quedar tapada por el header.
      className="scroll-mt-[calc(var(--app-header-h,0px)+16px)]"
      ariaLabel={t('featuredTitle')}
      // §23.9a: con el aria-label ya existente el lector anuncia «Piezas destacadas del catálogo,
      // carrusel». El aria-label NO cambia y NO menciona la rotación (§22.6b-e sigue vigente).
      ariaRoledescription={t('featured.roledescription')}
      title={
        <>
          <span className="lg:hidden">{t('featuredTitleShort')}</span>
          <span className="hidden lg:inline">{t('featuredTitle')}</span>
        </>
      }
      // El encabezado vuelve a su fila de TRES elementos (H2 · «Ver todo el catálogo» · flechas):
      // sin conmutador ya no hay nada pegado al H2.
      headerClassName="items-end pb-5 pt-10 lg:pt-12"
      viewAllHref="/catalog"
      viewAllLabel={t('viewAllCatalog')}
      viewAllClassName="hidden sm:inline"
      actions={
        // §23.8 + §20.16 nota 2 (corregida): sin JS / antes de hidratar las flechas NO se pintan.
        // Ningún control del carrusel se pinta si no puede funcionar.
        hydrated ? (
          <div className="flex gap-2">
            <button
              type="button"
              aria-label={t('carouselPrev')}
              onClick={() => goByArrow(-1)}
              disabled={!canPrev}
              className={cn(arrowBase, canPrev ? 'border-text text-text' : 'border-border-strong text-muted')}
            >
              ←
            </button>
            <button
              type="button"
              aria-label={t('carouselNext')}
              onClick={() => goByArrow(1)}
              disabled={!canNext}
              className={cn(arrowBase, canNext ? 'border-text text-text' : 'border-border-strong text-muted')}
            >
              →
            </button>
          </div>
        ) : undefined
      }
    >
      {/* §23.9c — el canal de estado. Emite SOLO en las dos transiciones no solicitadas que quedan:
          fin de la pasada e intervención que pausa. Nunca `assertive` (§8.2 lo reserva para errores
          de pago) y nunca en suspensiones por hover/foco/visibilidad, que son reversibles solas y
          anunciarlas lo volvería charlatán. */}
      <p role="status" aria-live="polite" className="sr-only">
        {statusMessage}
      </p>
      {/* R3: el error usa el QueryState compartido (Banner + Reintentar); el wrapper
          solo aporta el gutter en esa rama para no alterar la pista de scroll. */}
      <div className={catalog.isError ? 'gutter pb-12' : undefined}>
        <QueryState
          isLoading={catalog.isLoading}
          isError={catalog.isError}
          error={catalog.error}
          onRetry={() => catalog.refetch()}
          loading={
            <div className="gutter flex gap-4 overflow-hidden pb-10 lg:gap-7 lg:pb-14">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className={cn('shrink-0', i === 0 ? 'aspect-[5/7] w-[236px] lg:w-[400px]' : 'aspect-[5/7] w-[160px] lg:w-[268px]')} />
              ))}
            </div>
          }
        >
          {featured.length === 0 ? (
            <p className="gutter pb-12 text-sm text-muted">{tc('noResults')}</p>
          ) : (
            <div
              ref={scrollerRef}
              id={FEATURED_TRACK_ID}
              onScroll={handleScroll}
              // Las cinco entradas que pueden desplazar la pista. Solo escriben un ref: cero
              // re-render por mover el ratón o girar la rueda (corolario de §23.2).
              onPointerDown={noteUserInput}
              onTouchStart={noteUserInput}
              onWheel={noteUserInput}
              onKeyDown={noteUserInput}
              onFocus={noteUserInput}
              // §23.5/§23.9b: tope de tabulación CON NOMBRE (un tope de foco anónimo es peor que no
              // tenerlo) para poder desplazar la pista con teclado.
              role="group"
              tabIndex={0}
              aria-label={t('featured.trackAria')}
              // §23.9b: `off` mientras el temporizador corre DE VERDAD; `polite` en cuanto no corre
              // —pausada, terminada, suspendida por foco o puntero, o con movimiento reducido—. Se
              // ata al temporizador, no al modo, para que el caso que importa (usuario de teclado
              // navegando la pista, que la suspende) quede siempre en `polite`.
              aria-live={timerRunning ? 'off' : 'polite'}
              className="gutter flex snap-x gap-4 overflow-x-auto pb-10 [scrollbar-width:none] lg:gap-7 lg:pb-14 [&::-webkit-scrollbar]:hidden"
            >
              {featured.map((l, i) =>
                i === 0 ? (
                  <Link
                    key={l.representativeInventoryItemId}
                    href={`/catalog/${l.card.id}`}
                    className="w-[236px] shrink-0 snap-start lg:w-[400px]"
                  >
                    {/* P-39: teja destacada grande ⇒ imagen de alta resolución (fallback a la chica si null).
                        Es la ÚNICA teja de la pista con HD: mide 236/400px, donde la chica (245×342) se
                        vería blanda. Las secundarias (abajo) van con la CHICA a propósito — ver su nota.
                        PERF: `priority` porque esta teja es la candidata a LCP de la home (primer bloque
                        con imagen). No se replica en las demás: varias `fetchpriority=high` a la vez se
                        pelean el ancho de banda y retrasan justo a esta.
                        §23.3 precondición 3: su `load` es lo que habilita la rotación. La rotación NO
                        mueve este rol de teja en teja (R1): eso dispararía una descarga HD cada 5 s. */}
                    <CardImage
                      src={l.card.imageLargeUrl ?? l.card.imageSmallUrl}
                      alt={l.card.name}
                      priority
                      onLoaded={() => setLeadImageReady(true)}
                    />
                    <div className="mt-3 flex flex-col gap-2 lg:mt-[18px] lg:flex-row lg:items-end lg:justify-between lg:gap-5">
                      <div className="min-w-0">
                        <p lang="en" className="font-serif text-[17px] leading-[1.25] text-text lg:text-[26px] lg:leading-[1.2]">
                          {l.card.name}
                        </p>
                        <p lang="en" className="mt-2 font-mono text-[11px] leading-snug text-muted">
                          {tileMeta(l)}
                        </p>
                        {/* P-40: acabado legible (Normal / Reverse Holo / Holofoil); sellado no aplica (grupos = raw|graded). */}
                        <FinishLabel finish={l.finish} productType={l.productType} className="mt-2" />
                      </div>
                      <div className="shrink-0 lg:text-right">
                        <TilePrice l={l} locale={locale} big />
                        <StockBadge variant={stockVariantForSingle(l.stockCount)} count={l.stockCount} className="mt-1.5" />
                      </div>
                    </div>
                    {/* §22.6b-a: ÚLTIMO elemento de la teja, DEBAJO de toda la fila de datos y a
                        TODO EL ANCHO (no dentro de la columna derecha del precio, que es estrecha y
                        va `text-right`: ahí la prosa del aviso quedaría en bandera derecha). El
                        orden de lectura es nombre → set/# → acabado → precio real → stock →
                        estimado → micro-aviso. Nada de lo que está encima se mueve un píxel. */}
                    <GradingEstimateBadge listing={l} surface="featuredLead" />
                  </Link>
                ) : (
                  <Link
                    key={l.representativeInventoryItemId}
                    href={`/catalog/${l.card.id}`}
                    className="w-[160px] shrink-0 snap-start lg:w-[268px]"
                  >
                    {/* PERF — NO uniformizar con la teja líder: aquí va la imagen CHICA A PROPÓSITO.
                        P-39 («foto HD en el featured/ficha») se cumple en la teja LÍDER (arriba, 236/400px)
                        y en la ficha de carta; estas secundarias miden 160px (268px en lg), así que la
                        grande de pokemontcg.io (~734×1024) se descargaba entera para pintarse a menos de
                        un tercio de su ancho — y son SIETE, en el primer bloque con imágenes de la home.
                        La chica (245×342) ya cubre 268px con holgura en pantallas 1x. Si algún día estas
                        tejas crecen por encima de ~245px de ancho real, entonces sí toca revisar. */}
                    <CardImage src={l.card.imageSmallUrl} alt={l.card.name} />
                    <div className="mt-3 flex items-baseline gap-2 lg:mt-[15px]">
                      {/* Numeración decorativa/orientadora (§20.3): el orden real lo da el DOM.
                          §22.6b-c: se apaga en TODA la pista si la pista pinta alguna cifra. Nunca
                          se renumera para tapar el hueco, ni se sustituye por otro glifo, ni queda
                          espacio reservado donde estaba.
                          §23.10: la rotación NO la toca — ni renumera según lo visible, ni la usa
                          como indicador de progreso, ni resalta la teja que acaba de entrar. */}
                      {showNumbering && (
                        <span aria-hidden className="font-mono text-[10px] leading-none text-accent">
                          {String(i).padStart(2, '0')}
                        </span>
                      )}
                      <p lang="en" className="font-serif text-sm leading-[1.3] text-text lg:text-base">
                        {l.card.name}
                      </p>
                    </div>
                    <p lang="en" className="mt-1.5 font-mono text-[11px] leading-snug text-muted">
                      {tileMeta(l)}
                    </p>
                    {/* P-40: acabado legible bajo el renglón mono de set · número. */}
                    <FinishLabel finish={l.finish} productType={l.productType} className="mt-1.5" />
                    <TilePrice l={l} locale={locale} />
                    <StockBadge variant={stockVariantForSingle(l.stockCount)} count={l.stockCount} className="mt-1.5" />
                    {/* §22.6b-b: DESPUÉS del StockBadge, último elemento de la teja. `figureShort`
                        siempre (`surface="featuredRest"`): la forma larga en EN pide ~274px y la
                        teja mide 268px en su mejor momento. Sin `min-height` ni espacio reservado en
                        las tejas sin cifra: la ausencia es el estado NORMAL de esta pista (§22.6b-d). */}
                    <GradingEstimateBadge listing={l} surface="featuredRest" />
                  </Link>
                ),
              )}
            </div>
          )}
        </QueryState>
      </div>
    </Shelf>
  );
}
