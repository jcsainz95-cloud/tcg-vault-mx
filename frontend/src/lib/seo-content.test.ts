import { describe, it, expect } from 'vitest';
import es from '../../messages/es.json';
import en from '../../messages/en.json';
import { HELD_FAQS, PUBLIC_FAQS, FAQ_GROUP_ORDER } from '@/content/seo/faq.es';
import { HOW_IT_WORKS_SECTIONS } from '@/content/seo/como-funciona.es';
import { GUIDES } from '@/content/seo/guides.es';
import {
  FORBIDDEN_PHRASES,
  contentSitemapPaths,
  faqPageJsonLd,
  groupFaqs,
  guideTexts,
  howItWorksSections,
  publishedFaqs,
  publishedGuides,
  todayInMexico,
} from './seo-content';
import { buildLlmsTxt } from './llms-txt';

/** Un día dentro de la vigencia de la primera publicación (manual v5). */
const NOW = new Date('2026-10-18T18:00:00Z');

function stringEntries(obj: unknown, prefix = ''): [string, string][] {
  if (typeof obj === 'string') return [[prefix, obj]];
  if (typeof obj !== 'object' || obj === null) return [];
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
    stringEntries(v, prefix ? `${prefix}.${k}` : k),
  );
}

/** TODO el texto público de las páginas de contenido + llms.txt. */
function allContentTexts(): string[] {
  return [
    ...PUBLIC_FAQS.flatMap((f) => [f.question, f.answer]),
    ...GUIDES.flatMap((g) => [g.headline, ...guideTexts(g, NOW)]),
    buildLlmsTxt({ supportContact: 'soporte@tcghunt.mx', now: NOW }),
  ];
}

function offenders(texts: readonly string[], patterns: readonly RegExp[]): string[] {
  return texts.filter((t) => patterns.some((p) => p.test(t)));
}

describe('§E4 FAQ públicas (RESPUESTAS.md §12.2, manual v5)', () => {
  it('ids únicos, grupos del manual, y P8 retenida (no publicada)', () => {
    const ids = PUBLIC_FAQS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(PUBLIC_FAQS).toHaveLength(23); // 24 del manual − P8 retenida
    for (const f of PUBLIC_FAQS) expect(FAQ_GROUP_ORDER).toContain(f.group);
    for (const h of HELD_FAQS) expect(ids).not.toContain(h.id);
  });

  it('vigencia: hoy se publican las 23; P19 sale el 2026-11-06 (hora CDMX); todas salen tras el 2026-11-11', () => {
    expect(publishedFaqs(NOW)).toHaveLength(23);
    // 2026-11-06 05:59Z = 2026-11-05 23:59 en CDMX ⇒ P19 aún vigente.
    expect(publishedFaqs(new Date('2026-11-06T05:59:00Z')).map((f) => f.id)).toContain('P19');
    expect(publishedFaqs(new Date('2026-11-06T06:00:00Z')).map((f) => f.id)).not.toContain('P19');
    expect(publishedFaqs(new Date('2026-11-11T23:00:00Z'))).toHaveLength(22);
    expect(publishedFaqs(new Date('2026-11-12T07:00:00Z'))).toHaveLength(0);
  });

  it('todayInMexico usa la fecha de CDMX, no la UTC', () => {
    expect(todayInMexico(new Date('2026-10-19T03:00:00Z'))).toBe('2026-10-18');
  });

  it('FAQPage = las mismas preguntas y respuestas, en el mismo orden', () => {
    const faqs = publishedFaqs(NOW);
    const ld = faqPageJsonLd(faqs, 'https://tcghunt.mx/es/preguntas') as {
      mainEntity: { name: string; acceptedAnswer: { text: string } }[];
    };
    expect(ld.mainEntity.map((q) => [q.name, q.acceptedAnswer.text])).toEqual(
      faqs.map((f) => [f.question, f.answer]),
    );
  });

  it('agrupa en el orden del manual sin perder ninguna', () => {
    const groups = groupFaqs(publishedFaqs(NOW));
    expect(groups.map((g) => g.group)).toEqual([...FAQ_GROUP_ORDER]);
    expect(groups.flatMap((g) => g.faqs)).toHaveLength(23);
  });
});

describe('§E4 /como-funciona compone FAQ públicas por id', () => {
  it('cada id existe en PUBLIC_FAQS', () => {
    const ids = new Set(PUBLIC_FAQS.map((f) => f.id));
    for (const s of HOW_IT_WORKS_SECTIONS) for (const id of s.faqIds) expect(ids).toContain(id);
  });

  it('lleva las correcciones del brief §E4: cotizar sin cuenta, vender con cuenta + correo + CLABE, guía descontada', () => {
    const text = howItWorksSections(NOW)
      .flatMap((s) => s.faqs.map((f) => f.answer))
      .join('\n');
    expect(text).toContain('Cotizar es gratis, sin cuenta y sin compromiso.');
    expect(text).toContain('necesitas una cuenta con correo verificado');
    expect(text).toContain('CLABE');
    expect(text).toContain('La guía la ponemos nosotros');
    expect(text).toContain('se descuenta de lo que te pagamos');
  });
});

describe('§E6 guías', () => {
  it('son las 4 de la v1 §2.5, con texto, y todas publicables hoy', () => {
    expect(GUIDES.map((g) => g.slug)).toEqual([
      'que-es-nm',
      'carta-pirata-5-senales',
      'como-guardar-tus-cartas',
      'que-es-una-sir',
    ]);
    expect(publishedGuides(NOW)).toHaveLength(4);
    for (const g of GUIDES) expect(guideTexts(g, NOW).length).toBeGreaterThan(0);
  });

  it('la guía de NM cita la FAQ P7 (una sola fuente del texto)', () => {
    const p7 = PUBLIC_FAQS.find((f) => f.id === 'P7')!;
    expect(guideTexts(GUIDES[0], NOW)).toContain(p7.answer);
  });
});

describe('frases prohibidas (brief §E4/§E6) y reglas de §12.0.4', () => {
  it('ninguna frase prohibida en el contenido público (FAQ, guías, llms.txt)', () => {
    expect(offenders(allContentTexts(), FORBIDDEN_PHRASES)).toEqual([]);
  });

  /*
   * Trinquete sobre TODO `messages/` (ES y EN): ninguna cadena nueva puede traer una frase prohibida.
   * Las dos de abajo YA estaban en `5524bd69` (home y cotizador dicen «nosotros autenticamos») y no
   * son de este encargo (namespaces ajenos: el encargo solo permite añadir en `seo.*`); se reportan al
   * orquestador. Al corregirlas, esta lista se vacía y el trinquete queda absoluto.
   */
  const KNOWN_OFFENDERS = ['home.sellBody', 'buylist.subtitle'];
  it.each([
    ['es', es],
    ['en', en],
  ])('%s: ninguna frase prohibida fuera de las 2 ya conocidas', (_l, catalog) => {
    const bad = stringEntries(catalog)
      .filter(([, v]) => FORBIDDEN_PHRASES.some((p) => p.test(v)))
      .map(([k]) => k)
      .filter((k) => !KNOWN_OFFENDERS.includes(k));
    expect(bad).toEqual([]);
  });

  it('el namespace seo.* existe en ES y EN con las mismas claves', () => {
    const keys = (o: unknown) => stringEntries(o).map(([k]) => k).sort();
    expect(keys(es.seo)).toEqual(keys(en.seo));
    expect(keys(es.seo).length).toBeGreaterThan(0);
  });

  it('sin «disponible», sin Card Show, sin precios, sin emojis (RESPUESTAS §12.0.4, v1 §3.3)', () => {
    const texts = allContentTexts();
    expect(offenders(texts, [/disponible/i])).toEqual([]);
    expect(offenders(texts, [/card\s*show/i, /jakomi/i, /diciembre/i])).toEqual([]);
    expect(offenders(texts, [/MX\$/i, /\$\s?\d/])).toEqual([]);
    expect(offenders(texts, [/\p{Extended_Pictographic}/u])).toEqual([]);
  });
});

describe('§E1 rutas de contenido para el sitemap', () => {
  it('lista preguntas, cómo funciona, el índice de guías y las 4 guías, con lastmod', () => {
    const paths = contentSitemapPaths(NOW);
    expect(paths.map((p) => p.path)).toEqual([
      '/preguntas',
      '/como-funciona',
      '/guias',
      '/guias/que-es-nm',
      '/guias/carta-pirata-5-senales',
      '/guias/como-guardar-tus-cartas',
      '/guias/que-es-una-sir',
    ]);
    for (const p of paths) expect(p.lastModified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('una página sin FAQ vigentes sale del sitemap', () => {
    const paths = contentSitemapPaths(new Date('2026-11-12T07:00:00Z')).map((p) => p.path);
    expect(paths).not.toContain('/preguntas');
    expect(paths).not.toContain('/como-funciona');
  });
});
