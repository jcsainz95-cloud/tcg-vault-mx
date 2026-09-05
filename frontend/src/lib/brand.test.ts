import { describe, expect, it } from 'vitest';
import es from '../../messages/es.json';
import en from '../../messages/en.json';
import { BRAND_DOMAIN, brandEmail } from './brand';

/**
 * El candado que hace de `BRAND_DOMAIN` un espejo y no una segunda fuente de verdad: la autoridad
 * ejecutable del dominio es la clave i18n `common.brand.domain` (API_CONTRACT §0, cláusula 5), y
 * este test la compara con la constante en **las dos** traducciones. El día del próximo rebrand se
 * cambia i18n y esto se pone rojo señalando el único otro sitio que hay que tocar — que es
 * exactamente lo que faltó cuando `tcgvaultmx.com` se quedó vivo en los fixtures.
 */
describe('brand', () => {
  it('BRAND_DOMAIN espeja `common.brand.domain` de es y en', () => {
    expect(BRAND_DOMAIN).toBe(es.common.brand.domain);
    expect(BRAND_DOMAIN).toBe(en.common.brand.domain);
  });

  it('brandEmail compone el buzón sobre ese dominio', () => {
    expect(brandEmail('soporte')).toBe(`soporte@${es.common.brand.domain}`);
  });

  it('no queda rastro del dominio retirado', () => {
    expect(BRAND_DOMAIN).not.toMatch(/tcgvault/i);
  });
});
