/**
 * GEO (HECHOS 2026-11-16, aprobado por el dueño): «singles», «cartas sueltas», «Ciudad de México» y «envíos a todo México»
 * en portada, catálogo, <title>/description (+ og) y llms.txt; sin IVA ni precios; título ≈60 y descripción ≈155.
 */
import { describe, expect, it, vi } from 'vitest';
import es from '../../messages/es.json';
import en from '../../messages/en.json';
import { buildLlmsTxt } from './llms-txt';
vi.mock('next-intl/server', () => ({
  getTranslations: async ({ namespace }: { namespace: string }) => (key: string) =>
    [...namespace.split('.'), key].reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], es) as string,
}));

import { generateMetadata as homeMeta } from '../app/[locale]/(storefront)/page';

describe('GEO · singles + Ciudad de México', () => {
  it('portada: eyebrow y párrafo literales (es) y equivalentes (en)', () => {
    expect(es.home.heroKicker).toBe('Singles de Pokémon · Ciudad de México');
    expect(es.home.heroSubtitle).toBe(
      'Singles (cartas sueltas) y gradeadas, verificadas y con condición garantizada. Tienda en línea desde Ciudad de México con envíos a todo México. Viven resguardadas en tu bóveda y salen en un solo envío, cuando tú digas.',
    );
    expect(en.home.heroKicker).toBe('Pokémon singles · Mexico City');
    expect(en.home.heroSubtitle).toContain('Online store from Mexico City, shipping all over Mexico.');
  });

  it('catálogo: línea literal (es) y equivalente (en)', () => {
    expect(es.catalog.singlesLine).toBe('Singles de Pokémon (cartas sueltas) y gradeadas. Desde Ciudad de México, con envíos a todo México.');
    expect(en.catalog.singlesLine).toBe('Pokémon singles (raw cards) and graded. From Mexico City, shipping all over Mexico.');
  });

  it.each([
    ['es', es],
    ['en', en],
  ] as const)('%s: title ≤ 60 y description ≤ 155, sin IVA ni precios', (_l, m) => {
    for (const k of ['home', 'catalog'] as const) {
      const pg = m.seo.pages[k] as { title: string; description: string };
      expect(`TCG HUNT — ${pg.title}`.length, `${k} title`).toBeLessThanOrEqual(60);
      expect(pg.description.length, `${k} description`).toBeLessThanOrEqual(155);
      expect(`${pg.title} ${pg.description}`).not.toMatch(/\bIVA\b|MX\$|\$\d|precio|price/i);
      expect(`${pg.title} ${pg.description}`.toLowerCase()).toMatch(/singles/);
    }
    expect(m.seo.pages.home.description).toMatch(/Ciudad de México|Mexico City/);
  });

  it('es: «cartas sueltas», «Ciudad de México» y «envíos a todo México» en la descripción de portada y catálogo', () => {
    for (const d of [es.seo.pages.home.description, es.seo.pages.catalog.description]) {
      expect(d).toContain('cartas sueltas');
      expect(d).toContain('Ciudad de México');
      expect(d).toContain('envíos a todo México');
    }
  });

  it('portada: <title>, description y og salen de los mensajes (es)', async () => {
    const meta = await homeMeta({ params: Promise.resolve({ locale: 'es' }) });
    expect(meta.title).toBe(`TCG HUNT — ${es.seo.pages.home.title}`);
    expect(meta.description).toBe(es.seo.pages.home.description);
    expect(meta.openGraph?.title).toBe(meta.title);
    expect(meta.openGraph?.description).toBe(meta.description);
  });

  it('llms.txt dice qué somos con esas palabras', () => {
    const txt = buildLlmsTxt({ supportContact: 'contacto@tcghunt.mx' });
    expect(txt).toContain('singles de Pokémon (cartas sueltas)');
    expect(txt).toContain('Ciudad de México');
    expect(txt).toContain('envíos a todo México');
    expect(txt).not.toMatch(/\bIVA\b/);
  });
});
