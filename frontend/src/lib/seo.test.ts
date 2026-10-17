import { describe, it, expect } from 'vitest';
import {
  INSTAGRAM_URL,
  SITE_URL,
  breadcrumbJsonLd,
  buildFichaDescription,
  cardCanonicalUrl,
  cardConditionLabel,
  jsonLdAvailability,
  jsonLdPrice,
  organizationJsonLd,
  priceValidUntil,
  sealedCanonicalUrl,
  sealedConditionLabel,
  siteAbsoluteUrl,
} from './seo';

describe('seo helpers (§A4/§E3/§E1)', () => {
  it('URL absolutas de canonical salen de SITE_URL sin doble barra', () => {
    expect(siteAbsoluteUrl('/es')).toBe(`${SITE_URL}/es`);
    expect(siteAbsoluteUrl('es')).toBe(`${SITE_URL}/es`);
    expect(cardCanonicalUrl('es', 'c-charizard')).toBe(`${SITE_URL}/es/catalog/c-charizard`);
    expect(sealedCanonicalUrl('es', 'inv-1008')).toBe(`${SITE_URL}/es/sellado/inv-1008`);
  });

  it('priceValidUntil = pricedAsOf + 7 días (decisión del orquestador)', () => {
    expect(priceValidUntil('2026-10-16')).toBe('2026-10-23');
    // cruce de mes
    expect(priceValidUntil('2026-10-28')).toBe('2026-11-04');
    // formato inválido o ausente ⇒ undefined (⛔ no se inventa validez)
    expect(priceValidUntil(undefined)).toBeUndefined();
    expect(priceValidUntil('ayer')).toBeUndefined();
  });

  it('precio del Offer en pesos con 2 decimales', () => {
    expect(jsonLdPrice(320000)).toBe('3200.00');
    expect(jsonLdPrice(10550)).toBe('105.50');
  });

  it('availability según availableCount', () => {
    expect(jsonLdAvailability(4)).toBe('https://schema.org/InStock');
    expect(jsonLdAvailability(0)).toBe('https://schema.org/OutOfStock');
  });

  it('description lleva condición + precio con IVA + fecha + «verificamos la condición», ≤155', () => {
    const d = buildFichaDescription({
      conditionLabel: 'NM (Near Mint)',
      priceText: 'MX$1,200.00',
      ivaRatePct: 16,
      pricedAsOf: '2026-10-16',
      locale: 'es',
    });
    expect(d).toContain('NM (Near Mint)');
    expect(d).toContain('MX$1,200.00');
    expect(d).toContain('IVA 16 % incluido');
    expect(d).toContain('precio al 2026-10-16');
    expect(d).toContain('Verificamos la condición.');
    expect(d.length).toBeLessThanOrEqual(155);
  });

  it('description sin precio/fecha omite el tramo de precio (precio con fecha o sin precio)', () => {
    const d = buildFichaDescription({ conditionLabel: 'NM (Near Mint)', locale: 'es' });
    expect(d).toBe('NM (Near Mint) · Verificamos la condición.');
    expect(d).not.toMatch(/MX\$/);
  });

  it('etiquetas de condición', () => {
    expect(sealedConditionLabel('mint', 'es')).toBe('Sellado de fábrica');
    expect(sealedConditionLabel('minor_box_damage', 'es')).toContain('detalle menor');
    expect(cardConditionLabel({ productType: 'graded', gradingCompany: 'PSA', gradeValue: '10' })).toBe('PSA 10');
    expect(cardConditionLabel({ productType: 'raw', rawCondition: 'NM' })).toBe('NM (Near Mint)');
  });

  it('Organization omite sameAs mientras el handle de Instagram esté NO MEDIDO', () => {
    const org = organizationJsonLd();
    expect(org.name).toBe('TCG HUNT');
    expect(org.url).toBe(`${SITE_URL}/`);
    // INSTAGRAM_URL es null (NO MEDIDO) ⇒ no se publica `sameAs` (⛔ no se inventa).
    expect(INSTAGRAM_URL).toBeNull();
    expect(org.sameAs).toBeUndefined();
  });

  it('BreadcrumbList numera las posiciones en orden', () => {
    const bc = breadcrumbJsonLd([
      { name: 'TCG HUNT', url: `${SITE_URL}/es` },
      { name: 'Sellado', url: `${SITE_URL}/es/sellado` },
      { name: 'ETB', url: `${SITE_URL}/es/sellado/inv-1` },
    ]);
    const items = bc.itemListElement as { position: number; name: string }[];
    expect(items.map((i) => i.position)).toEqual([1, 2, 3]);
    expect(items[2].name).toBe('ETB');
  });
});
