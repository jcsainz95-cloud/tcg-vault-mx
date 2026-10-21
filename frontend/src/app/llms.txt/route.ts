import { buildLlmsTxt } from '@/lib/llms-txt';
import { fetchSupportContactForServer } from '@/lib/support-contact-server';

/**
 * ⭐ §MKT tienda §E7 — `GET /llms.txt` (brief v1 §3.3), público, `text/markdown`. Fuera del i18n y del
 * middleware (el matcher excluye rutas con punto, como `robots.txt`/`sitemap.xml`). `robots.ts` no lo
 * bloquea. Revalida cada hora (las páginas listadas dependen de la vigencia de las FAQ).
 */
export const revalidate = 3600;

export async function GET(): Promise<Response> {
  const supportContact = await fetchSupportContactForServer();
  return new Response(buildLlmsTxt({ supportContact }), {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  });
}
