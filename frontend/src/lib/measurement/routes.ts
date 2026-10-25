/**
 * ARCHITECTURE §14.4 — dónde actúa la medición: LISTA BLANCA, módulo único.
 *
 * El cargador, `track()` y el banner solo actúan en estas rutas. **Toda ruta nueva nace excluida**:
 * para medir una página nueva hay que añadirla aquí (y su prueba en `routes.test.ts`).
 *
 * Excluidas a propósito (no aparecen): cuenta y perfil, bóveda, admin, el PASO de crear la solicitud de
 * venta (`/buylist/solicitud`: CLABE, INE), el detalle de una solicitud (`/buylist/requests/:id`),
 * login/registro/restablecer/verificar, `/pedido?token=…`, `/orders`, envíos, accesorios, decks, lista de
 * deseos, aviso de privacidad y términos, y las páginas con token del Card Show (`confirm`, `cancel`,
 * `unsubscribe`).
 *
 * v1.109 (D-MKT2-8, D-MKT2-9; candados C-F5 y C-F9 de API_CONTRACT §MKT.H.11):
 *  - `/buylist` (el cotizador) entra porque su documento ya no pinta CLABE ni INE: el paso de crear vive en
 *    `/buylist/solicitud`, ruta excluida a la que se llega con navegación dura (`buylist/request-step.ts`).
 *  - `/card-show` vive FUERA de `[locale]` ⇒ lista aparte, coincidencia EXACTA. Ahí solo `page_view` a GA4:
 *    sin eventos (sus formularios llevan nombre, teléfono y menores) y sin Meta (P-CS-MEDIR-1, por defecto no).
 */

import { locales } from '@/i18n/routing';

/** Patrones sobre la ruta SIN prefijo de idioma. `:seg` = un segmento cualquiera. */
export const MEASURED_ROUTE_PATTERNS: readonly string[] = [
  '/', // portada
  '/catalog', // catálogo
  '/compra', // alias del catálogo (mismo `CatalogView`)
  '/catalog/:seg', // ficha de carta
  '/sellado', // lista de sellado
  '/sellado/:seg', // ficha de sellado
  '/checkout', // carrito y checkout (con cuenta e invitado)
  '/guias',
  '/guias/:seg',
  '/preguntas',
  '/como-funciona',
  '/buylist', // cotizador de venta (v1.109, D-MKT2-8); ⛔ nunca `/buylist/:seg`
];

/**
 * Rutas medidas SIN prefijo de idioma (viven fuera de `[locale]`). ⛔ Coincidencia EXACTA, sin `:seg`: lo que
 * cuelga de ellas lleva token (C-F9).
 */
export const MEASURED_UNLOCALIZED_PATHS: readonly string[] = ['/card-show'];

/** Rutas medidas donde NO se manda `page_view` (§MKT.H.4: «⛔ no en checkout»). */
const NO_PAGE_VIEW: readonly string[] = ['/checkout'];

/** Qué se permite en una ruta medida. */
export interface MeasurementRoutePolicy {
  /** ¿Puede cargar el píxel de Meta aquí? (`false` en `/card-show`, P-CS-MEDIR-1). */
  pixel: boolean;
  /** Eventos permitidos: todos los de §MKT.H.4 o solo `page_view` (`/card-show`). */
  events: 'all' | 'page_view_only';
  pageView: boolean;
}

/** Política de las rutas sin idioma (C-F9). */
const UNLOCALIZED_POLICY: Readonly<Record<string, MeasurementRoutePolicy>> = {
  '/card-show': { pixel: false, events: 'page_view_only', pageView: true },
};

/** Quita el prefijo de idioma (`/es/catalog` ⇒ `/catalog`; `/es` ⇒ `/`). Sin prefijo válido ⇒ `null`. */
export function stripLocale(pathname: string): string | null {
  const clean = pathname.split(/[?#]/)[0] ?? '';
  const parts = clean.split('/').filter(Boolean);
  if (parts.length === 0) return null;
  if (!(locales as readonly string[]).includes(parts[0])) return null;
  return '/' + parts.slice(1).join('/');
}

function matches(pattern: string, path: string): boolean {
  const p = pattern.split('/').filter(Boolean);
  const s = path.split('/').filter(Boolean);
  if (p.length !== s.length) return false;
  return p.every((seg, i) => seg === ':seg' || seg === s[i]);
}

/** La ruta sin idioma tal cual (sin query ni fragmento) si está en la lista exacta; si no, `null`. */
function unlocalizedMatch(pathname: string): string | null {
  const clean = pathname.split(/[?#]/)[0] ?? '';
  return MEASURED_UNLOCALIZED_PATHS.includes(clean) ? clean : null;
}

/**
 * La política de la ruta (con prefijo de idioma, como la da `location.pathname`), o `null` si NO es medida.
 * Es la única puerta: `isMeasuredPath`, `sendsPageView`, el cargador y `track()` leen de aquí.
 */
export function measurementPolicyFor(pathname: string): MeasurementRoutePolicy | null {
  const exact = unlocalizedMatch(pathname);
  if (exact !== null) return UNLOCALIZED_POLICY[exact] ?? null;
  const path = stripLocale(pathname);
  if (path === null) return null;
  const normalized = path.length > 1 ? path.replace(/\/+$/, '') : path;
  if (!MEASURED_ROUTE_PATTERNS.some((pat) => matches(pat, normalized))) return null;
  const pageView = !NO_PAGE_VIEW.some((pat) => matches(pat, normalized || '/'));
  return { pixel: true, events: 'all', pageView };
}

/** ¿Esta ruta (con prefijo de idioma, como la da `location.pathname`) está en la lista blanca? */
export function isMeasuredPath(pathname: string): boolean {
  return measurementPolicyFor(pathname) !== null;
}

/** ¿Se manda `page_view` al cargar esta ruta? Medida y no checkout. */
export function sendsPageView(pathname: string): boolean {
  return measurementPolicyFor(pathname)?.pageView ?? false;
}

/**
 * La elección del visitante recortada a lo que la ruta permite (C-F9): en `/card-show` nunca hay publicidad,
 * aunque el visitante la haya aceptado en la tienda. Fuera de la lista blanca ⇒ nada.
 */
export function consentForRoute(
  choice: { analytics: boolean; ads: boolean },
  pathname: string,
): { analytics: boolean; ads: boolean } {
  const policy = measurementPolicyFor(pathname);
  if (!policy) return { analytics: false, ads: false };
  return { analytics: choice.analytics, ads: choice.ads && policy.pixel };
}
