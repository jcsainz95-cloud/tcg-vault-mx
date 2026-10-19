/**
 * ARCHITECTURE §14.4 — dónde actúa la medición: LISTA BLANCA, módulo único.
 *
 * El cargador, `track()` y el banner solo actúan en estas rutas. **Toda ruta nueva nace excluida**:
 * para medir una página nueva hay que añadirla aquí (y su prueba en `routes.test.ts`).
 *
 * Excluidas a propósito (no aparecen): cuenta y perfil, bóveda, admin, vender/buylist (CLABE, INE),
 * login/registro/restablecer/verificar, `/pedido?token=…`, `/orders`, envíos, accesorios, decks,
 * lista de deseos, aviso de privacidad y términos, y la landing del Card Show (vive fuera de
 * `[locale]`: nunca casa).
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
];

/** Rutas medidas donde NO se manda `page_view` (§MKT.H.4: «⛔ no en checkout»). */
const NO_PAGE_VIEW: readonly string[] = ['/checkout'];

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

/** ¿Esta ruta (con prefijo de idioma, como la da `location.pathname`) está en la lista blanca? */
export function isMeasuredPath(pathname: string): boolean {
  const path = stripLocale(pathname);
  if (path === null) return false;
  const normalized = path.length > 1 ? path.replace(/\/+$/, '') : path;
  return MEASURED_ROUTE_PATTERNS.some((pat) => matches(pat, normalized));
}

/** ¿Se manda `page_view` al cargar esta ruta? Medida y no checkout. */
export function sendsPageView(pathname: string): boolean {
  if (!isMeasuredPath(pathname)) return false;
  const path = stripLocale(pathname) ?? '';
  return !NO_PAGE_VIEW.some((pat) => matches(pat, path.replace(/\/+$/, '') || '/'));
}
