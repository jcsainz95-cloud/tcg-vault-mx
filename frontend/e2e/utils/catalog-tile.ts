/**
 * §IDS.5 (API_CONTRACT, v1.116.3) + DESIGN_SYSTEM §IDS-UX.4 — el ENLACE de una teja del catálogo, como lo pinta
 * `CatalogTile`: una teja por versión y acabado; el enlace lleva `?version=<versionOptionKey>` (la clave la da el
 * servidor, ⛔ no se compone) salvo **inglés sin liga**, que va con la URL llana de siempre (D-IDS-4 preselecciona `en`
 * igual; FRONTEND_NOTES §IDS-FE).
 *
 * Las `@real` que buscan «la teja de esta carta» o «el enlace de esta carta» lo derivan de AQUÍ y del DTO de la rejilla,
 * nunca del orden del seed: una pieza `es` o de liga recién dada de alta es la primera teja de `newest` y su enlace
 * no es el llano.
 */
import { isDefaultVersion } from '../../src/lib/version';

export interface TileGroupRef {
  card: { id: string };
  version: { language: string; stamp: unknown | null };
  versionOptionKey: string;
}

/** `/<locale>/catalog/<cardId>` o `/<locale>/catalog/<cardId>?version=<versionOptionKey>`. */
export function tileHref(g: TileGroupRef, locale: 'es' | 'en' = 'es'): string {
  const base = `/${locale}/catalog/${g.card.id}`;
  return isDefaultVersion(g.version) ? base : `${base}?version=${encodeURIComponent(g.versionOptionKey)}`;
}

/** `cardId` y `?version=` de un href de ficha (con o sin locale). */
export function parseCardHref(href: string): { cardId: string; version: string | null } {
  const u = new URL(href, 'http://x');
  const cardId = u.pathname.split('/').filter(Boolean).pop() ?? '';
  return { cardId, version: u.searchParams.get('version') };
}
