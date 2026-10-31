import { describe, it, expect } from 'vitest';
import { buildLlmsTxt, LLMS_LAST_REVIEW } from './llms-txt';
import { FIXTURE_CONTENT } from './seo-content.fixture';

describe('llms.txt (§E7, brief v1 §3.3)', () => {
  const now = new Date('2026-10-18T18:00:00Z');
  const txt = buildLlmsTxt({ supportContact: 'soporte@tcghunt.mx', now });

  it('lleva qué es, país y moneda, precios con IVA, solo NM, contacto y fecha', () => {
    expect(txt.startsWith('# TCG HUNT\n')).toBe(true);
    expect(txt).toContain('> Compra y vende cartas Pokémon en México, con bóveda.');
    expect(txt).toContain('País: México. Moneda: pesos mexicanos (MXN).');
    expect(txt).toContain('precios finales con IVA incluido, en MXN, actualizados a diario');
    expect(txt).toContain('solo Near Mint (NM)');
    expect(txt).toContain('Contacto público: soporte@tcghunt.mx');
    expect(txt).toContain(`Última revisión: ${LLMS_LAST_REVIEW}`);
  });

  it('enlaza las URL clave absolutas', () => {
    for (const p of ['/catalog', '/buylist', '/guias', '/preguntas', '/como-funciona']) {
      expect(txt).toContain(`(https://tcghunt.mx/es${p})`);
    }
  });

  // C6 (criterio 954, tester-e2e sobre 561ad425): sellado y la página única del Card Show, cada una con su línea.
  it('enlaza sellado y el Card Show con su descripción, y la revisión es la de este cambio', () => {
    expect(txt).toMatch(/^- \[Sellado\]\(https:\/\/tcghunt\.mx\/es\/sellado\): \S.+$/m);
    expect(txt).toMatch(/^- \[Card Show\]\(https:\/\/tcghunt\.mx\/card-show\): \S.+$/m);
    expect(LLMS_LAST_REVIEW).toBe('2026-10-31');
  });

  // FE-MKT-T1: sobre el fixture (fechas fijas), no sobre las FAQ vivas que se renuevan cada mes.
  it('no enlaza páginas sin contenido vigente (FAQ vencidas, fixture)', () => {
    const later = buildLlmsTxt({ supportContact: 'x@y.mx', now: new Date('2030-01-21T07:00:00Z'), src: FIXTURE_CONTENT });
    expect(later).not.toContain('/es/preguntas');
    expect(later).toContain('/es/guias');
  });
});
