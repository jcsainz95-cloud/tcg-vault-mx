/**
 * merchant-feed.ts — §GSHOP.B (docs/specs/GOOGLE_SHOPPING_E_INDEXACION.md): piezas PURAS del feed de Google Merchant Center.
 * Sin BD, sin red, sin dinero calculado aquí: el precio llega ya hecho (`displayPriceCents`, el que ve el cliente, con comisión
 * desde D9) y NO se transforma. Solo texto, envío y exclusión de ítems dudosos.
 */

import { createHash } from 'node:crypto';

export type MerchantFeedKind = 'card' | 'sealed';

/** Un ítem del feed: UNA fila por ficha (URL). ⛔ Nada de costos, SKUs internos, folios, dueños ni inventario de clientes. */
export interface MerchantFeedItem {
  /** `card:<cardId>` / `s:<hash22(groupKey)>` (estable aunque se venda o abarate la pieza representante; ≤ 50). */
  id: string;
  kind: MerchantFeedKind;
  /** Ruta canónica SIN locale (`/catalog/<id>` | `/sellado/<id>`, id ya codificado); el frontend antepone `/es` (= `sitemap.ts`). */
  path: string;
  title: string;
  description: string;
  imageUrl: string;
  /** Centavos MXN enteros, IVA y comisión incluidos: la MISMA cifra que `Offer.price` de la ficha. */
  priceCents: number;
  availability: 'in_stock';
  /** = `jsonLdItemCondition` (carta suelta/gradeada ⇒ `used`; sellado ⇒ `new`). */
  condition: 'new' | 'used';
  brand: 'Pokémon';
  /** No hay origen de GTIN en BD ⇒ `null` y `identifierExists:false`. Nunca se inventa. */
  gtin: string | null;
  identifierExists: boolean;
  /** Categoría de Google (texto completo de la taxonomía). */
  googleProductCategory: string;
  /** Envío a MX con la regla viva (centavos; 0 si `priceCents ≥ freeFromCents`). */
  shippingCents: number;
  /** Política de devoluciones de la tienda: no se aceptan (como `merchantReturnPolicyJsonLd`). */
  returns: 'not_permitted';
}

export interface MerchantFeedResponse {
  items: MerchantFeedItem[];
  generatedAt: string;
}

/** Entrada cruda de un servicio de catálogo (sin envío ni saneo): lo que sabe la ficha. */
export interface MerchantFeedRaw {
  kind: MerchantFeedKind;
  /** cardId (carta) o representativeItemId (sellado; solo para el `path`). */
  refId: string;
  /** Sellado: groupKey estable del grupo (de él sale el `g:id`). Carta: no se usa. */
  groupKey?: string;
  title: string | null;
  description: string | null;
  imageUrl: string | null;
  priceCents: number | null;
}

export interface MerchantShippingRule {
  cardsOnlyFeeCents: number;
  sealedFeeCents: number;
  freeFromCents: number;
}

export const MERCHANT_BRAND = 'Pokémon' as const;
export const MERCHANT_CATEGORY = 'Arts & Entertainment > Hobbies & Creative Arts > Collectibles > Collectible Trading Cards';
export const MERCHANT_TITLE_MAX = 150;
export const MERCHANT_DESCRIPTION_MAX = 5000;
/** Caché pública del endpoint (el frontend a su vez revalida 3600 s). */
export const MERCHANT_FEED_CACHE_CONTROL = 'public, max-age=60, s-maxage=300, stale-while-revalidate=300';
/** Caché de servidor en memoria (misma ventana para feed y sitemap); 0 ítems no se cachea. */
export const MERCHANT_SERVER_CACHE_MS = 5 * 60_000;

/** `g:id` estable de un grupo sellado: `s:` + base64url de los primeros 16 bytes de SHA-256 del groupKey (24 car. en total). */
export function sealedMerchantId(groupKey: string): string {
  return 's:' + createHash('sha256').update(groupKey).digest().subarray(0, 16).toString('base64url');
}

/** Texto plano (el nombre se conserva íntegro, `<…>` incluido: el front lo escapa al armar el XML): sin caracteres de control XML 1.0 (salvo espacios), espacios colapsados. */
export function plainText(value: string | null | undefined): string {
  if (!value) return '';
  return value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F-\u009F￾￿]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Recorta por puntos de código (no parte un par sustituto) y quita el espacio colgante. */
export function clipText(value: string, max: number): string {
  const cps = Array.from(value);
  return cps.length <= max ? value : cps.slice(0, max).join('').trim();
}

/** Ruta canónica sin locale; el `id` se codifica igual que `sitemap.ts` (`encodeURIComponent`). */
export function merchantPathOf(kind: MerchantFeedKind, refId: string): string {
  let enc: string;
  try {
    enc = encodeURIComponent(refId);
  } catch {
    return ''; // sustituto suelto (URIError): sin ruta válida ⇒ el ítem se omite
  }
  return `${kind === 'card' ? '/catalog/' : '/sellado/'}${enc}`;
}

/** Envío de un pedido de solo esa pieza: misma cuenta que `shippingDetailsJsonLd` (cartas ⇒ tarifa de cartas; ≥ umbral ⇒ 0). */
export function merchantShippingCents(kind: MerchantFeedKind, priceCents: number, rule: MerchantShippingRule): number {
  if (priceCents >= rule.freeFromCents) return 0;
  return kind === 'sealed' ? rule.sealedFeeCents : rule.cardsOnlyFeeCents;
}

/**
 * Arma el feed: aplica las exclusiones automáticas (precio no entero o ≤ 0, sin título, sin imagen absoluta https) y las cuenta.
 * Duplicados por id: gana el primero. Orden estable por id (el archivo no «baila» entre descargas).
 */
export function buildMerchantFeed(
  raws: readonly MerchantFeedRaw[],
  rule: MerchantShippingRule,
): { items: MerchantFeedItem[]; skipped: number } {
  const seen = new Set<string>();
  const items: MerchantFeedItem[] = [];
  let skipped = 0;
  for (const r of raws) {
    const id = r.kind === 'sealed' && r.groupKey ? sealedMerchantId(r.groupKey) : `${r.kind}:${r.refId}`;
    const path = r.refId ? merchantPathOf(r.kind, r.refId) : '';
    const title = clipText(plainText(r.title), MERCHANT_TITLE_MAX);
    const image = (r.imageUrl ?? '').trim();
    const price = r.priceCents;
    if (
      seen.has(id) ||
      !path ||
      !title ||
      !/^https:\/\/\S+$/i.test(image) ||
      price == null ||
      !Number.isSafeInteger(price) ||
      price <= 0
    ) {
      skipped += 1;
      continue;
    }
    seen.add(id);
    items.push({
      id,
      kind: r.kind,
      path,
      title,
      description: clipText(plainText(r.description), MERCHANT_DESCRIPTION_MAX) || title,
      imageUrl: image,
      priceCents: price,
      availability: 'in_stock',
      condition: r.kind === 'sealed' ? 'new' : 'used',
      brand: MERCHANT_BRAND,
      gtin: null,
      identifierExists: false,
      googleProductCategory: MERCHANT_CATEGORY,
      shippingCents: merchantShippingCents(r.kind, price, rule),
      returns: 'not_permitted',
    });
  }
  items.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { items, skipped };
}
