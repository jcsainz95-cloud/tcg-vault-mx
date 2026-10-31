import { CONTACT_PHONE, PUBLIC_CONTACT_EMAIL } from './about';
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
  soldOutOfferJsonLd,
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

  it('description lleva condición + precio + fecha + «verificamos la condición», ≤155; sin IVA (C8, criterio 956)', () => {
    for (const locale of ['es', 'en'] as const) {
      const d = buildFichaDescription({ conditionLabel: 'NM (Near Mint)', priceText: 'MX$1,200.00', pricedAsOf: '2026-10-16', locale });
      expect(d).not.toMatch(/\biva\b|\bvat\b|16 ?%/i);
    }
    const d = buildFichaDescription({
      conditionLabel: 'NM (Near Mint)',
      priceText: 'MX$1,200.00',
      pricedAsOf: '2026-10-16',
      locale: 'es',
    });
    expect(d).toContain('NM (Near Mint)');
    expect(d).toContain('MX$1,200.00');
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

  it('Organization: sameAs = Instagram del dueño (946) y contactPoint con correo, MX y es/en (944/954)', () => {
    const org = organizationJsonLd();
    expect(org.name).toBe('TCG HUNT');
    expect(org.url).toBe(`${SITE_URL}/`);
    // MKT-2 (HECHOS 2026-10-31): `@tcghunt.mx`.
    expect(INSTAGRAM_URL).toBe('https://www.instagram.com/tcghunt.mx/');
    expect(org.sameAs).toEqual(['https://www.instagram.com/tcghunt.mx/']);
    expect(org.contactPoint).toMatchObject({
      '@type': 'ContactPoint',
      email: PUBLIC_CONTACT_EMAIL,
      areaServed: 'MX',
      availableLanguage: ['es', 'en'],
    });
    // Sin número del dueño (CONTACT_PHONE vacío) no hay `telephone` (⛔ no se inventa).
    expect((org.contactPoint as Record<string, unknown>).telephone).toBe(CONTACT_PHONE || undefined);
    expect(org.address).toMatchObject({ addressLocality: 'Ciudad de México', addressCountry: 'MX' });
  });

  it('C3 · Offer de ficha agotada: OutOfStock, sin precio inventado', () => {
    const o = soldOutOfferJsonLd('card', `${SITE_URL}/es/catalog/x`);
    expect(o.availability).toBe('https://schema.org/OutOfStock');
    expect(o).not.toHaveProperty('price');
    expect(o.itemCondition).toBe('https://schema.org/UsedCondition');
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
