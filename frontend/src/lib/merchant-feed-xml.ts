import { routing } from '@/i18n/routing';
import { jsonLdPrice, siteAbsoluteUrl } from './seo';
import type { MerchantFeedItem } from './api/merchant-feed';

/**
 * §GSHOP — arma el XML de Google Merchant (RSS 2.0, espacio `g:`) a partir de `GET /catalog/merchant-feed`.
 * Puro: sin red ni reloj. Todo texto se escapa y se le quitan los caracteres que XML 1.0 no admite.
 * El front NO multiplica ni calcula precios: solo da formato a `priceCents` («105.00 MXN») y toma el envío de
 * `shippingCents` (la regla viva la aplica el backend).
 */
const TITLE_MAX = 150;
const DESC_MAX = 5000;
export const GOOGLE_CATEGORY =
  'Arts & Entertainment > Hobbies & Creative Arts > Collectibles > Collectible Trading Cards';

/** Quita lo que XML 1.0 prohíbe (controles salvo \t \n \r, sustitutos sueltos, U+FFFE/FFFF). */
export function stripXmlInvalid(s: string): string {
  return s
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');
}

export function escapeXml(s: string): string {
  return stripXmlInvalid(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function clip(s: string, max: number): string {
  const chars = Array.from(stripXmlInvalid(s));
  return chars.length <= max ? chars.join('') : chars.slice(0, max).join('');
}

/** Texto plano: sin etiquetas HTML y con los blancos colapsados. */
function plain(s: string): string {
  return stripXmlInvalid(s).replace(/<\/?[a-zA-Z][a-zA-Z0-9]*(?:\s[^<>]*)?\/?>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function formatMxn(cents: number): string {
  return `${jsonLdPrice(cents)} MXN`;
}

function absoluteHttps(url: string | null | undefined): string | null {
  if (!url) return null;
  const u = url.trim();
  if (!u) return null;
  if (u.startsWith('/')) return siteAbsoluteUrl(u);
  return /^https:\/\//i.test(u) ? u : null;
}

/** El backend manda la ruta sin locale; se antepone el por defecto (canónica del sitemap). */
function localizedPath(p: string): string {
  if (/^https?:\/\//i.test(p)) return p;
  const path = p.startsWith('/') ? p : `/${p}`;
  return path.startsWith(`/${routing.defaultLocale}/`) ? path : `/${routing.defaultLocale}${path}`;
}

const AVAILABILITY = new Set(['in_stock', 'out_of_stock', 'preorder', 'backorder']);

function tag(name: string, value: string): string {
  return `      <g:${name}>${escapeXml(value)}</g:${name}>`;
}

/** Devuelve el `<item>` o `null` si el dato es dudoso (precio ≤ 0, sin título, sin imagen, sin enlace). */
export function buildItemXml(item: MerchantFeedItem): string | null {
  const title = clip(stripXmlInvalid(item.title ?? '').replace(/\s+/g, ' ').trim(), TITLE_MAX);
  const image = absoluteHttps(item.imageUrl);
  const link = item.path ? absoluteHttps(localizedPath(item.path)) : null;
  if (!title || !image || !link) return null;
  if (!Number.isInteger(item.priceCents) || item.priceCents <= 0) return null;
  const description = clip(plain(item.description ?? ''), DESC_MAX) || title;

  const lines = [
    '    <item>',
    tag('id', item.id),
    tag('title', title),
    tag('description', description),
    tag('link', link),
    tag('image_link', image),
    tag('price', formatMxn(item.priceCents)),
    tag('availability', item.availability && AVAILABILITY.has(item.availability) ? item.availability : 'in_stock'),
    tag('condition', item.condition === 'new' ? 'new' : 'used'),
    tag('brand', 'Pokémon'),
  ];
  if (item.gtin && /^\d{8,14}$/.test(item.gtin)) lines.push(tag('gtin', item.gtin));
  else lines.push(tag('identifier_exists', 'no'));
  lines.push(tag('google_product_category', item.googleProductCategory || GOOGLE_CATEGORY));
  if (item.groupId) lines.push(tag('item_group_id', item.groupId));

  if (Number.isInteger(item.shippingCents) && (item.shippingCents as number) >= 0) {
    lines.push(
      '      <g:shipping>',
      '        <g:country>MX</g:country>',
      '        <g:service>Estándar</g:service>',
      `        <g:price>${escapeXml(formatMxn(item.shippingCents as number))}</g:price>`,
      '      </g:shipping>',
    );
  }
  lines.push('    </item>');
  return lines.join('\n');
}

export interface FeedBuild {
  xml: string;
  items: number;
  skipped: number;
}

export function buildMerchantFeedXml(items: MerchantFeedItem[]): FeedBuild {
  const out: string[] = [];
  let skipped = 0;
  for (const it of items) {
    const x = buildItemXml(it);
    if (x) out.push(x);
    else skipped += 1;
  }
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">',
    '  <channel>',
    '    <title>TCG HUNT</title>',
    `    <link>${escapeXml(siteAbsoluteUrl('/'))}</link>`,
    '    <description>Cartas Pokémon TCG y producto sellado en México</description>',
    ...out,
    '  </channel>',
    '</rss>',
    '',
  ].join('\n');
  return { xml, items: out.length, skipped };
}
