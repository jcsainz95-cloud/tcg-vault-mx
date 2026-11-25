import { getMerchantFeed } from '@/lib/api/merchant-feed';
import { ApiClientError } from '@/lib/api-client';
import { fresh } from '@/lib/snapshot-cache';
import { buildMerchantFeedXml } from '@/lib/merchant-feed-xml';

/**
 * §GSHOP — `GET /feeds/google-merchant.xml` (spec §B). Fuera del i18n y del middleware (el matcher excluye rutas con
 * punto) y sin regla en `robots.ts`. Dinámica: SIN caché de datos de Next (`cache:'no-store'`: `revalidate` no tiene tope de edad y
 * dejó una copia de 55 min medida en producción); la frescura la da la foto de 60 s del backend y la CDN
 * (`max-age=0, s-maxage=60`, sin stale-while-revalidate); así un 503 nunca queda cacheado. Backend caído o 0 ítems ⇒ 503
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

const TTL_MS = 60_000;

/** Foto del feed ya armada; `null` = no servible (backend caído o sin ítems) ⇒ 503 y NO se memoriza. */
async function build(): Promise<{ xml: string; items: number; skipped: number }> {
  const feed = await getMerchantFeed({ cache: 'no-store' });
  if (!feed || !Array.isArray(feed.items) || feed.items.length === 0) throw new Error('empty');
  const built = buildMerchantFeedXml(feed.items);
  if (built.items === 0) throw new Error('empty');
  return built;
}

export async function GET(): Promise<Response> {
  let built;
  try {
    // Memoria de 60 s (una entrada, sin importar la consulta): `no-store` hacia el backend no debe dejar que cada URL distinta lo golpee.
    built = await fresh('merchant-feed', TTL_MS, build);
  } catch (e) {
    if (!(e instanceof ApiClientError) && !(e instanceof Error && e.message === 'empty')) console.error('[merchant-feed] backend no disponible');
    return unavailable();
  }
  const { xml, items, skipped } = built;
  return new Response(xml, {
    status: 200,
    headers: {
      'Content-Type': XML,
      'Cache-Control': 'public, max-age=0, s-maxage=60',
      'X-Feed-Items': String(items),
      'X-Feed-Skipped': String(skipped),
    },
  });
}
