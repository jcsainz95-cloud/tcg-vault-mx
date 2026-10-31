/**
 * ⭐ §MKT tienda §E7 (brief v1 §3.3) — contenido de `/llms.txt` (Markdown para asistentes de IA).
 * Puro: lo arma `app/llms.txt/route.ts` y lo prueba `llms-txt.test.ts`.
 *
 * Qué lleva (v1 §3.3): qué es TCG HUNT en una línea (= `common.tagline` de `messages/es.json`, la
 * misma frase de la web), país y moneda, URLs clave, política de precios, condición que compramos y
 * contacto público (= el buzón de soporte de `GET /support/contact`, el mismo de los términos).
 * Cada dato citable lleva fecha («Última revisión»).
 *
 * Del Card Show, solo el enlace a su página única (`llmsCardShowLine`, criterio 954, C6), sin datos del
 * evento (v1 §3.3): fechas y sede viven en esa página y se moverían aquí sin aviso. ⛔ Sin «IVA» (C8, criterio 956:
 * MKT-4 (a), HECHOS 2026-10-31 — el precio publicado ya es el final). Instagram y «Quiénes somos» (criterio 954) salen
 * de `lib/about.ts`, la misma fuente de la página y del JSON-LD.
 */
import es from '../../messages/es.json';
import { siteAbsoluteUrl } from '@/lib/seo';
import { ABOUT_PATH, INSTAGRAM_HANDLE, INSTAGRAM_URL } from '@/lib/about';
import { publishedGuides, contentSitemapPaths, LIVE_CONTENT, type ContentSource } from '@/lib/seo-content';

/** Fecha de la última revisión del texto de `llms.txt`. */
export const LLMS_LAST_REVIEW = '2026-10-31';

/**
 * Criterio 954 (C6): la ÚNICA mención del Card Show en `llms.txt` es este enlace a su página única. Sin datos del
 * evento (fechas, sede, aliados): `seo-content.test.ts` quita exactamente esta línea antes de su barrido «sin Card
 * Show» y comprueba que la línea misma no los traiga.
 */
export function llmsCardShowLine(): string {
  return `- [Card Show](${siteAbsoluteUrl('/card-show')}): la página del Card Show de TCG HUNT, con su información vigente.`;
}

export function buildLlmsTxt(opts: { supportContact: string; now?: Date; src?: ContentSource }): string {
  const now = opts.now ?? new Date();
  const src = opts.src ?? LIVE_CONTENT;
  const live = new Set(contentSitemapPaths(now, src).map((c) => c.path));
  const url = (p: string) => siteAbsoluteUrl(`/es${p}`);
  const links: string[] = [
    `- [Catálogo](${url('/catalog')}): cartas Pokémon a la venta.`,
    `- [Sellado](${url('/sellado')}): producto Pokémon cerrado de fábrica a la venta (cajas, ETB, bundles y más).`,
    `- [Cotizador (buylist)](${url('/buylist')}): lo que pagamos hoy por tus cartas en NM.`,
  ];
  if (live.has('/como-funciona')) links.push(`- [Cómo funciona](${url('/como-funciona')})`);
  if (live.has('/preguntas')) links.push(`- [Preguntas frecuentes](${url('/preguntas')})`);
  links.push(llmsCardShowLine());
  links.push(`- [Quiénes somos y contacto](${url(ABOUT_PATH)}): quién está detrás de TCG HUNT, cómo compras y cómo contactarnos.`);
  links.push(`- [Instagram ${INSTAGRAM_HANDLE}](${INSTAGRAM_URL}): la cuenta oficial de TCG HUNT.`);
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
    '- Precios: precios finales en MXN, actualizados a diario.',
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
