/**
 * ⭐ §MKT tienda §E7 (brief v1 §3.3) — contenido de `/llms.txt` (Markdown para asistentes de IA).
 * Puro: lo arma `app/llms.txt/route.ts` y lo prueba `llms-txt.test.ts`.
 *
 * Qué lleva (v1 §3.3): qué es TCG HUNT en una línea (= `common.tagline` de `messages/es.json`, la
 * misma frase de la web), país y moneda, URLs clave, política de precios, condición que compramos y
 * contacto público (= el buzón de soporte de `GET /support/contact`, el mismo de los términos).
 * Cada dato citable lleva fecha («Última revisión»).
 *
 * ⛔ Nada del Card Show (v1 §3.3 «sin datos del evento»). ⛔ Sin la cifra «16 %»: la tasa de IVA
 * viaja por publicación desde la API (`ivaRatePct`); escribirla aquí sería una segunda fuente.
 */
import es from '../../messages/es.json';
import { siteAbsoluteUrl } from '@/lib/seo';
import { publishedGuides, contentSitemapPaths, LIVE_CONTENT, type ContentSource } from '@/lib/seo-content';

/** Fecha de la última revisión del texto de `llms.txt`. */
export const LLMS_LAST_REVIEW = '2026-10-18';

export function buildLlmsTxt(opts: { supportContact: string; now?: Date; src?: ContentSource }): string {
  const now = opts.now ?? new Date();
  const src = opts.src ?? LIVE_CONTENT;
  const live = new Set(contentSitemapPaths(now, src).map((c) => c.path));
  const url = (p: string) => siteAbsoluteUrl(`/es${p}`);
  const links: string[] = [
    `- [Catálogo](${url('/catalog')}): cartas Pokémon a la venta.`,
    `- [Cotizador (buylist)](${url('/buylist')}): lo que pagamos hoy por tus cartas en NM.`,
  ];
  if (live.has('/como-funciona')) links.push(`- [Cómo funciona](${url('/como-funciona')})`);
  if (live.has('/preguntas')) links.push(`- [Preguntas frecuentes](${url('/preguntas')})`);
  if (live.has('/guias')) {
    links.push(`- [Guías](${url('/guias')})`);
    for (const g of publishedGuides(now, src)) links.push(`  - [${g.headline}](${url(`/guias/${g.slug}`)})`);
  }
  return [
    '# TCG HUNT',
    '',
    `> ${es.common.tagline}.`,
    '',
    `- Sitio: ${siteAbsoluteUrl('/')}`,
    '- País: México. Moneda: pesos mexicanos (MXN).',
    '- Precios: precios finales con IVA incluido, en MXN, actualizados a diario.',
    '- Condición que compramos: solo Near Mint (NM).',
    `- Contacto público: ${opts.supportContact}`,
    '',
    '## URLs clave',
    '',
    ...links,
    '',
    `Última revisión: ${LLMS_LAST_REVIEW}`,
    '',
  ].join('\n');
}
