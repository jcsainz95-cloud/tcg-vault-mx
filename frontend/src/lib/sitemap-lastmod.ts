/**
 * C6 (BRIEF_MKT Ola 2) — `lastmod` de las páginas FIJAS del sitemap (`app/sitemap.ts`). Puro: se prueba sin Next.
 */
import type { SitemapResponse } from '@/types/contract';
import { privacyNoticeEs } from '@/content/legal/privacidad.es';
import { ABOUT_LAST_REVIEW } from '@/lib/about';

const SPANISH_MONTHS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

/** «26 de octubre de 2026» (la fecha que publica el aviso de privacidad) ⇒ `2026-10-26`; otra forma ⇒ `undefined`. */
export function spanishDateToIso(text: string): string | undefined {
  const m = /^(\d{1,2}) de ([a-záéíóú]+) de (\d{4})$/i.exec(text.trim());
  if (!m) return undefined;
  const month = SPANISH_MONTHS.indexOf(m[2].toLowerCase());
  if (month < 0) return undefined;
  return `${m[3]}-${String(month + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

/** La fecha ISO más reciente de la lista (comparación de cadenas ISO-8601 en UTC), o `undefined` si está vacía. */
export function latest(dates: (string | undefined)[]): string | undefined {
  return dates.filter((d): d is string => !!d).sort().at(-1);
}

/**
 * C6 (BRIEF_MKT Ola 2) — `lastmod` REAL de las páginas fijas, sacado de lo que muestran: la portada y el catálogo, de la
 * publicación más reciente del feed (`GET /catalog/sitemap`, cartas); sellado, del sellado más reciente; decks-meta,
 * de la lista aplicada (`GET /decks-meta` `updatedAt`); privacidad, de la fecha que publica el aviso. Las que no tienen
 * una fecha que se pueda medir (buylist, accesorios, términos, o cualquiera si su fuente no responde) salen SIN
 * `lastmod`: antes todas llevaban la hora de la petición, y un `lastmod` que siempre es «ahora» enseña a Google a
 * ignorarlo en todo el sitio.
 */
export function staticLastModified(
  feed: SitemapResponse | null,
  decksUpdatedAt: string | undefined,
): Record<string, string | undefined> {
  const cards = latest((feed?.items ?? []).filter((i) => i.type === 'card').map((i) => i.lastmod));
  const sealed = latest((feed?.items ?? []).filter((i) => i.type !== 'card').map((i) => i.lastmod));
  return {
    '': latest([cards, sealed]),
    '/catalog': cards,
    '/sellado': sealed,
    '/accesorios': undefined,
    '/decks-meta': decksUpdatedAt,
    '/buylist': undefined,
    '/terminos': undefined,
    '/privacidad': spanishDateToIso(privacyNoticeEs.updatedAt),
    // B2: la fecha de revisión de los datos de «Quiénes somos» (`lib/about.ts`).
    '/nosotros': ABOUT_LAST_REVIEW,
  };
}
