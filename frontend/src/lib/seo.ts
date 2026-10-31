/**
 * ⭐ v1.96⟨mkt-tienda⟩ (§A3/§A4/§E1/§E3) — helpers PUROS de SEO para las fichas públicas (carta y
 * sellado), el sitemap, robots y el canonical. Todo lo que se pinta en el `<head>` del SERVIDOR
 * (title/og/JSON-LD) y las URL absolutas sale de aquí, para tener UNA sola regla y poder probarla
 * sin levantar Next.
 *
 * Reglas del brief que NO se reabren aquí:
 *  - Precio SIEMPRE con IVA y con fecha, o sin precio (`pricedAsOf`). ⛔ Nunca cantidad de stock.
 *  - `<title>`/`og:title` SIN precio (las vistas previas cachean días).
 *  - `og:image` = `ogImageUrl` ABSOLUTA; si `null`, se OMITE. ⛔ No se afirma ≥1200×630 (NO MEDIDO,
 *    §MKT.F: hoy es la «large» de pokemontcg.io ~734×1024).
 *  - `priceValidUntil` = `pricedAsOf` + 7 días (decisión del orquestador: el ancla honesta es
 *    «precio al <fecha>», y las vistas previas cachean días).
 */
import type { Metadata } from 'next';
import type { AppLocale } from '@/i18n/routing';

/**
 * Base absoluta del sitio para canonical/og/sitemap. Por entorno vía `NEXT_PUBLIC_SITE_URL`; cae al
 * dominio de producción (`https://tcghunt.mx`, `HECHOS`/brief). ⛔ Sin barra final.
 */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://tcghunt.mx').replace(/\/+$/, '');

/**
 * Instagram para `Organization.sameAs` (JSON-LD §E3). **NO MEDIDO**: no hay handle de Instagram en el
 * código del sitio (ni en `lib/brand.ts`, ni en el footer, ni en el contenido legal — medido
 * 2026-10-16). Hasta que el dueño/arquitecto lo fije, queda `null` y el `sameAs` se OMITE
 * (⛔ no se inventa una URL de red social). Si se fija, basta poner aquí la URL absoluta.
 */
export const INSTAGRAM_URL: string | null = null;

/** Une la base del sitio con una ruta relativa (que debe empezar por `/`). */
export function siteAbsoluteUrl(path: string): string {
  return `${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

/** Canonical/og:url absoluto de la ficha de CARTA: `/{locale}/catalog/<cardId>`. */
export function cardCanonicalUrl(locale: string, cardId: string): string {
  return siteAbsoluteUrl(`/${locale}/catalog/${encodeURIComponent(cardId)}`);
}

/** Canonical/og:url absoluto de la ficha de SELLADO: `/{locale}/sellado/<inventoryItemId>`. */
export function sealedCanonicalUrl(locale: string, inventoryItemId: string): string {
  return siteAbsoluteUrl(`/${locale}/sellado/${encodeURIComponent(inventoryItemId)}`);
}

/**
 * `priceValidUntil` del JSON-LD = `pricedAsOf` (YYYY-MM-DD) + `days` (7 por defecto). Devuelve
 * `YYYY-MM-DD`. Si `pricedAsOf` no tiene el formato esperado, devuelve `undefined` (no se inventa
 * una validez). Cálculo en UTC sobre la fecha-solo (sin zona) ⇒ determinista.
 */
export function priceValidUntil(pricedAsOf: string | undefined, days = 7): string | undefined {
  if (!pricedAsOf || !/^\d{4}-\d{2}-\d{2}$/.test(pricedAsOf)) return undefined;
  const base = new Date(`${pricedAsOf}T00:00:00.000Z`);
  if (Number.isNaN(base.getTime())) return undefined;
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

/** Precio en pesos con 2 decimales para `Offer.price` (schema.org quiere la cifra, sin símbolo). */
export function jsonLdPrice(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** Etiqueta corta de condición de SELLADO (para `og:description`). */
export function sealedConditionLabel(
  condition: 'mint' | 'minor_box_damage',
  locale: AppLocale = 'es',
): string {
  if (locale === 'en') {
    return condition === 'mint' ? 'Factory sealed' : 'Sealed · minor box wear';
  }
  return condition === 'mint' ? 'Sellado de fábrica' : 'Sellado · caja con detalle menor';
}

/**
 * Etiqueta corta de condición de CARTA para `og:description`, a partir del listado representante
 * (el más barato). Raw ⇒ «NM (Near Mint)»; graded ⇒ «PSA 10», «CGC 9.5», etc.
 */
export function cardConditionLabel(
  input: {
    productType: 'raw' | 'graded';
    rawCondition?: string;
    gradingCompany?: string;
    gradeValue?: string;
  },
  locale: AppLocale = 'es',
): string {
  if (input.productType === 'graded' && input.gradingCompany && input.gradeValue) {
    return `${input.gradingCompany} ${input.gradeValue}`;
  }
  // El único raw del catálogo es NM (contrato: `RawCondition = 'NM'`).
  const nm = input.rawCondition ?? 'NM';
  return locale === 'en' ? `${nm} (Near Mint)` : `${nm} (Near Mint)`;
}

/**
 * `meta description` / `og:description` de una ficha (≤155 caracteres, el límite del brief §A4).
 * Estructura: condición + «desde MX$<precio> IVA incluido · precio al <fecha>» + «verificamos la
 * condición». ⛔ Solo lo que es cierto HOY; sin precio si no hay `pricedAsOf`/precio.
 * `priceText` ya viene formateado con «MX$» por `formatMoneyCents`.
 */
export function buildFichaDescription(opts: {
  conditionLabel: string;
  priceText?: string | null;
  ivaRatePct?: number;
  pricedAsOf?: string;
  locale?: AppLocale;
}): string {
  const locale = opts.locale ?? 'es';
  const verify = locale === 'en' ? 'We verify the condition.' : 'Verificamos la condición.';
  const iva = opts.ivaRatePct != null ? `IVA ${opts.ivaRatePct} % incluido` : 'IVA incluido';
  const parts: string[] = [opts.conditionLabel];
  if (opts.priceText && opts.pricedAsOf) {
    const from = locale === 'en' ? 'from' : 'desde';
    parts.push(`${from} ${opts.priceText} ${iva} · ${locale === 'en' ? 'price as of' : 'precio al'} ${opts.pricedAsOf}`);
  }
  parts.push(verify);
  let out = parts.join(' · ');
  if (out.length > 155) out = `${out.slice(0, 152).trimEnd()}…`;
  return out;
}

/** `schema.org` availability a partir de `availableCount`. */
export function jsonLdAvailability(availableCount: number): string {
  return availableCount > 0
    ? 'https://schema.org/InStock'
    : 'https://schema.org/OutOfStock';
}

/**
 * `Organization` del JSON-LD (§E3). `sameAs` solo si hay URL (Instagram NO MEDIDO ⇒ se omite el
 * arreglo entero antes que publicar `[]` o una URL inventada).
 */
export function organizationJsonLd(): Record<string, unknown> {
  const org: Record<string, unknown> = {
    '@type': 'Organization',
    name: 'TCG HUNT',
    url: siteAbsoluteUrl('/'),
    // C6: el logo es la mira de la marca que el sitio ya sirve (`app/apple-icon.png`, PNG 180×180 ≥ 112 px que pide
    // Google). ⛔ `contactPoint`/`sameAs` esperan datos del dueño (B2/B2b).
    logo: siteAbsoluteUrl(ORGANIZATION_LOGO_PATH),
  };
  const sameAs = [INSTAGRAM_URL].filter((u): u is string => !!u);
  if (sameAs.length > 0) org.sameAs = sameAs;
  return org;
}

/** C6 — ruta del logo de `Organization` (la sirve Next desde `src/app/apple-icon.png`). */
export const ORGANIZATION_LOGO_PATH = '/apple-icon.png';

/**
 * C6 (BRIEF_MKT Ola 2) — `WebSite` + `SearchAction` de la portada: la búsqueda del sitio es la del catálogo, que lee
 * `?q=` de la URL (`catalog/catalog-url.ts` `parseUrlFilters`).
 */
export function webSiteJsonLd(locale: string): Record<string, unknown> {
  return {
    '@type': 'WebSite',
    name: 'TCG HUNT',
    url: siteAbsoluteUrl(`/${locale}`),
    inLanguage: locale === 'en' ? 'en' : 'es-MX',
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${siteAbsoluteUrl(`/${locale}/catalog`)}?q={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  };
}

/** `BreadcrumbList` de 3 niveles: Inicio → sección → ficha. */
export function breadcrumbJsonLd(
  trail: { name: string; url: string }[],
): Record<string, unknown> {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((t, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: t.name,
      item: t.url,
    })),
  };
}

/**
 * C6 (BRIEF_MKT Ola 2) — canonical + `hreflang` de una ruta pública que existe en los dos idiomas (`path` sin locale,
 * `''` para la portada). `x-default` apunta a la versión `es` (la del sitio por defecto), que responde 200: el `Link`
 * de next-intl lo mandaba a la URL SIN locale, que responde 307 a `/es` (desactivado en `i18n/routing.ts`,
 * `alternateLinks: false`). El contenido solo-español (§E4/§E6) NO usa esto: su canonical es `/es` en los dos idiomas.
 */
export function localeAlternates(locale: string, path: string): NonNullable<Metadata['alternates']> {
  return {
    canonical: siteAbsoluteUrl(`/${locale}${path}`),
    languages: {
      es: siteAbsoluteUrl(`/es${path}`),
      en: siteAbsoluteUrl(`/en${path}`),
      'x-default': siteAbsoluteUrl(`/es${path}`),
    },
  };
}

/**
 * C4 (BRIEF_MKT Ola 2) — metadata de una página de LISTADO pública: título propio (patrón §17.4 «TCG HUNT — {página}»),
 * descripción propia, canonical + hreflang y og. Antes sellado, accesorios, decks-meta y buylist heredaban el título y
 * la descripción de la portada (`layout.tsx`) y no tenían canonical.
 */
export function routeMetadata(opts: {
  locale: string;
  path: string;
  title: string;
  description: string;
}): Metadata {
  const alternates = localeAlternates(opts.locale, opts.path);
  return {
    metadataBase: new URL(SITE_URL),
    title: opts.title,
    description: opts.description,
    alternates,
    openGraph: {
      type: 'website',
      siteName: 'TCG HUNT',
      title: opts.title,
      description: opts.description,
      url: alternates.canonical as string,
    },
  };
}

/**
 * C5 (BRIEF_MKT Ola 2) — `itemCondition` del `Offer`. Criterio de Google para fichas de comercio: «nuevo» = empaque
 * original sin abrir; «usado» = empaque original abierto o ausente. Una carta suelta o gradeada ya salió de su sobre
 * (su condición, NM o el grado, va en el nombre y la descripción) ⇒ `UsedCondition`; el sellado está cerrado de fábrica
 * ⇒ `NewCondition` (también «caja con detalle menor»: el producto sigue sin abrir, el detalle es del cartón).
 */
export function jsonLdItemCondition(kind: 'card' | 'sealed'): string {
  return kind === 'sealed' ? 'https://schema.org/NewCondition' : 'https://schema.org/UsedCondition';
}

/** C5 — marca del producto: todo el catálogo es Pokémon TCG (el sitio lo nombra «Carta Pokémon»). */
export function brandJsonLd(): Record<string, unknown> {
  return { '@type': 'Brand', name: 'Pokémon' };
}

/** Lo que el JSON-LD necesita de `GET /checkout/shipping-rule` (§4-G.12 punto 5). */
export interface ShippingRuleForJsonLd {
  cardsOnlyFeeCents: number;
  sealedFeeCents: number;
  freeFromCents: number;
  currency: 'MXN';
}

/**
 * C5 — `shippingDetails` del `Offer`, con la regla VIVA del endpoint público (⛔ ningún importe escrito a mano): el
 * envío de un pedido de solo esa pieza. Cartas (sueltas y gradeadas viajan como carta, D-ENV-2) ⇒ `cardsOnlyFeeCents`;
 * sellado ⇒ `sealedFeeCents`; y 0 si el precio ya alcanza `freeFromCents` (el umbral vale para cualquier pedido,
 * `subtotal >= freeFrom`, `backend/src/modules/orders/shipping-rule.ts`). La caja grande solo aplica a accesorios. Sin
 * regla (backend sin responder a tiempo) ⇒ `undefined` y el campo se OMITE.
 */
export function shippingDetailsJsonLd(
  kind: 'card' | 'sealed',
  priceCents: number,
  rule: ShippingRuleForJsonLd | null | undefined,
): Record<string, unknown> | undefined {
  if (!rule) return undefined;
  const fee =
    priceCents >= rule.freeFromCents ? 0 : kind === 'sealed' ? rule.sealedFeeCents : rule.cardsOnlyFeeCents;
  return {
    '@type': 'OfferShippingDetails',
    shippingRate: { '@type': 'MonetaryAmount', value: jsonLdPrice(fee), currency: rule.currency },
    shippingDestination: { '@type': 'DefinedRegion', addressCountry: 'MX' },
  };
}

/**
 * C5 — `hasMerchantReturnPolicy`: «Todas las ventas son finales» y, en la excepción de carta dañada o equivocada,
 * «conservas la carta: no hay devolución del producto» (`messages/*.json` `legal.refundBody` /
 * `legal.deliveryIssueOutcome`) ⇒ no se aceptan devoluciones (`MerchantReturnNotPermitted`).
 */
export function merchantReturnPolicyJsonLd(): Record<string, unknown> {
  return {
    '@type': 'MerchantReturnPolicy',
    applicableCountry: 'MX',
    returnPolicyCategory: 'https://schema.org/MerchantReturnNotPermitted',
  };
}
