import { getMerchantFeed } from '@/lib/api/merchant-feed';
import { ApiClientError } from '@/lib/api-client';
import { buildMerchantFeedXml } from '@/lib/merchant-feed-xml';

/**
 * §GSHOP — `GET /feeds/google-merchant.xml` (spec §B). Fuera del i18n y del middleware (el matcher excluye rutas con
 * punto) y sin regla en `robots.ts`. Dinámica: la frescura la dan la caché de datos de Next (900 s) y la CDN
 * (`s-maxage=900, stale-while-revalidate=900`); así un 503 nunca queda cacheado. Backend caído o 0 ítems ⇒ 503
 * (nunca un 200 vacío: Merchant conservaría lo anterior en vez de borrar el catálogo).
 */
export const dynamic = 'force-dynamic';

const XML = 'application/xml; charset=utf-8';

function unavailable(): Response {
  return new Response('Service Unavailable', {
    status: 503,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Retry-After': '300' },
  });
}

export async function GET(): Promise<Response> {
  let feed;
  try {
    feed = await getMerchantFeed({ next: { revalidate: 900, tags: ['merchant-feed'] } });
  } catch (e) {
    if (!(e instanceof ApiClientError)) console.error('[merchant-feed] backend no disponible');
    return unavailable();
  }
  if (!feed || !Array.isArray(feed.items) || feed.items.length === 0) return unavailable();

  const { xml, items, skipped } = buildMerchantFeedXml(feed.items);
  if (items === 0) return unavailable();
  return new Response(xml, {
    status: 200,
    headers: {
      'Content-Type': XML,
      'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=900',
      'X-Feed-Items': String(items),
      'X-Feed-Skipped': String(skipped),
    },
  });
}
