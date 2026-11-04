/**
 * §IDS.5 «SEO (frontend)» — JSON-LD de una ficha con VARIAS versiones: `ProductGroup` (`productGroupID = cardId`) con
 * `hasVariant` = un `Product` por entrada de `versions[]`, en su orden (`sku = <cardId>.<optionKey>`, `offers` con
 * precio e `InStock`, `additionalProperty {name: "Versión", value: <texto visible>}`).
 * ⛔ Sin `inLanguage`, sin `variesBy` por idioma, sin `hreflang` por idioma de carta. El canonical sigue siendo la ficha
 * sin parámetro (`generateMetadata`, `localeAlternates`).
 *
 * Con una sola versión (o ninguna) la ficha conserva el `Product` de siempre: una opción no es un grupo de variantes
 * (mismo criterio que la cuadrícula, IDS-UX.8 candado 12).
 */
import type { VersionOptionDTO } from '@/types/contract';
import { jsonLdPrice } from '@/lib/seo';

type T = (key: string) => string;

/** El texto visible de una opción, con el vocabulario de la ficha («Español · De liga · Prize Pack · Cosmos Holo»). */
export function versionVisibleText(v: VersionOptionDTO, t: T): string {
  const parts = [t(`version.language.${v.version.language}`)];
  if (v.version.stamp) {
    parts.push(t(`versionDetail.row.${v.version.stamp.type}`));
    if (v.finishLabel) parts.push(t(`version.finishLabel.${v.finishLabel}`));
  }
  return parts.join(' · ');
}

export function productGroupJsonLd(args: {
  cardId: string;
  name: string;
  canonical: string;
  versions: readonly VersionOptionDTO[];
  t: T;
  /** Lo común a cada `Offer` (condición, envío, devoluciones, `priceValidUntil`). */
  offerExtras: Record<string, unknown>;
  base: Record<string, unknown>;
}): Record<string, unknown> {
  const { cardId, name, canonical, versions, t, offerExtras, base } = args;
  return {
    '@type': 'ProductGroup',
    name,
    productGroupID: cardId,
    url: canonical,
    ...base,
    hasVariant: versions.map((v) => {
      const text = versionVisibleText(v, t);
      return {
        '@type': 'Product',
        name: `${name} · ${text}`,
        sku: `${cardId}.${v.optionKey}`,
        additionalProperty: { '@type': 'PropertyValue', name: t('versionDetail.jsonLdProperty'), value: text },
        offers: {
          '@type': 'Offer',
          priceCurrency: 'MXN',
          price: jsonLdPrice(v.fromPriceCents),
          availability: 'https://schema.org/InStock',
          url: `${canonical}?version=${encodeURIComponent(v.optionKey)}`,
          ...offerExtras,
        },
      };
    }),
  };
}
