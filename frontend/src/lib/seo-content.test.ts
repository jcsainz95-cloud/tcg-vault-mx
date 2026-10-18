import { describe, it, expect } from 'vitest';
import es from '../../messages/es.json';
import en from '../../messages/en.json';
import { HELD_FAQS, PUBLIC_FAQS, FAQ_GROUP_ORDER } from '@/content/seo/faq.es';
import { HOW_IT_WORKS_SECTIONS } from '@/content/seo/como-funciona.es';
import { GUIDES } from '@/content/seo/guides.es';
import {
  FAQ_EXPIRY_WARN_DAYS,
  FORBIDDEN_PHRASES,
  contentSitemapPaths,
  faqsExpiringSoon,
  faqPageJsonLd,
  groupFaqs,
  guideCitationsLive,
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

/*
 * ⏳ R1 (techlead, 2026-10-18) — las FAQ caducan SOLAS (salen de la web el día siguiente a `validThrough`), y eso no
 * puede pasar sin aviso. Este bloque usa el RELOJ REAL (no `NOW`): se pone ROJO desde
 * `FAQ_EXPIRY_WARN_DAYS` (7) días antes del `validThrough` más cercano. Mismo patrón que
 * `scripts/check-dast-report-only-expiry.sh` (job `dast-report-only-expiry`): la fecha vive en el dato, la
 * comprobación usa el día de hoy y el canario inyecta el día. Con los datos de 2026-10-18 se pone rojo el
 * **2026-10-29** (P19 vence el 2026-11-05): es el aviso esperado, no un defecto.
 *
 * Cómo se apaga el rojo (y ninguna otra forma): marketing re-mide la(s) FAQ en `plan/RESPUESTAS.md` y se copia la
 * revisión a `content/seo/faq.es.ts` con su `validThrough` nuevo; o se decide retirarla y sale de `PUBLIC_FAQS`.
 * ⛔ No se sube `FAQ_EXPIRY_WARN_DAYS` ni se fija el reloj aquí para «ponerlo verde».
 */
describe('⏳ R1 · caducidad de FAQ con el reloj real', () => {
  it(`ninguna FAQ publicada vence en los próximos ${FAQ_EXPIRY_WARN_DAYS} días (hora CDMX)`, () => {
    const soon = faqsExpiringSoon(); // ⛔ sin `now`: reloj real
    const msg = soon
      .map((f) => `${f.id} vence ${f.validThrough} (${f.daysLeft < 0 ? 'YA VENCIDA' : `quedan ${f.daysLeft} días`})`)
      .join('; ');
    expect(soon, `FAQ por caducar: ${msg}. Re-medir en RESPUESTAS.md y copiar la revisión a faq.es.ts.`).toEqual([]);
  });

  // Canario: la misma función, con el día inyectado, muerde exactamente en el borde.
  it('canario: verde a 8 días de P19, rojo a 7, a 0 y ya vencida', () => {
    expect(faqsExpiringSoon(new Date('2026-10-28T18:00:00Z'))).toEqual([]);
    expect(faqsExpiringSoon(new Date('2026-10-29T18:00:00Z'))).toEqual([
      { id: 'P19', validThrough: '2026-11-05', daysLeft: 7 },
    ]);
    expect(faqsExpiringSoon(new Date('2026-11-05T18:00:00Z'))[0]).toEqual({ id: 'P19', validThrough: '2026-11-05', daysLeft: 0 });
    // 2026-11-04: P19 a 1 día y las 22 mensuales a 7 ⇒ todas en la ventana, la más próxima primero.
    expect(faqsExpiringSoon(new Date('2026-11-04T18:00:00Z'))).toHaveLength(23);
    expect(faqsExpiringSoon(new Date('2026-11-03T18:00:00Z')).map((f) => f.id)).toEqual(['P19']);
    // Día CDMX, no UTC: 2026-10-29 03:00Z sigue siendo 2026-10-28 en CDMX ⇒ verde.
    expect(faqsExpiringSoon(new Date('2026-10-29T03:00:00Z'))).toEqual([]);
    const late = faqsExpiringSoon(new Date('2026-11-06T18:00:00Z'));
    expect(late[0]).toEqual({ id: 'P19', validThrough: '2026-11-05', daysLeft: -1 });
    expect(late).toHaveLength(23); // las 22 mensuales (2026-11-11) entran en la ventana con P19
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

  it('toda FAQ citada por una guía existe en PUBLIC_FAQS (citar una retenida o inexistente rompe la prueba)', () => {
    const ids = new Set(PUBLIC_FAQS.map((f) => f.id));
    const cited = GUIDES.flatMap((g) => g.blocks.filter((b) => b.kind === 'faq').map((b) => `${g.slug}:${b.faqId}`));
    expect(cited.length).toBeGreaterThan(0);
    expect(cited.filter((c) => !ids.has(c.split(':')[1]))).toEqual([]);
  });

  /*
   * R1 (techlead, 2026-10-18): una guía que cita una FAQ VENCIDA se retira ENTERA, no se publica a medias.
   * 2026-11-12 (CDMX) = P7 ya vencida (validThrough 2026-11-11) ⇒ `que-es-nm` fuera de la lista, del sitemap y de
   * `llms.txt`; las otras 3 (sin citas) siguen.
   */
  it('guía con FAQ vencida: sale entera de la lista, del sitemap y de llms.txt', () => {
    const after = new Date('2026-11-12T18:00:00Z');
    expect(guideCitationsLive(GUIDES[0], NOW)).toBe(true);
    expect(guideCitationsLive(GUIDES[0], after)).toBe(false);
    expect(publishedGuides(after).map((g) => g.slug)).toEqual([
      'carta-pirata-5-senales',
      'como-guardar-tus-cartas',
      'que-es-una-sir',
    ]);
    const paths = contentSitemapPaths(after).map((p) => p.path);
    expect(paths).not.toContain('/guias/que-es-nm');
    expect(paths).toContain('/guias/que-es-una-sir');
    const llms = buildLlmsTxt({ supportContact: 'soporte@tcghunt.mx', now: after });
    expect(llms).not.toContain('/guias/que-es-nm');
    expect(llms).not.toContain(GUIDES[0].headline);
    expect(llms).toContain('/guias/que-es-una-sir');
  });
});

describe('frases prohibidas (brief §E4/§E6) y reglas de §12.0.4', () => {
  it('ninguna frase prohibida en el contenido público (FAQ, guías, llms.txt)', () => {
    expect(offenders(allContentTexts(), FORBIDDEN_PHRASES)).toEqual([]);
  });

  /*
   * Trinquete sobre TODO `messages/` (ES y EN): ninguna cadena nueva puede traer una frase prohibida.
   * Excepciones CONOCIDAS (ya estaban en `5524bd69`: home y cotizador dicen «nosotros autenticamos» / «we
   * authenticate»). Son COPY de namespaces ajenos a §MKT-SEO: la corrección la decide el dueño (no frontend).
   * D4a (techlead, 2026-10-18): cada excepción lleva dueño, fecha de medición y caducidad, y TIENE QUE SEGUIR
   * OFENDIENDO: si alguien corrige la cadena, la excepción sale de esta lista (si no, la prueba se pone roja) y el
   * trinquete queda absoluto para esa clave. Al vencer `expires` sin corregir, rojo con el reloj real.
   */
  const KNOWN_OFFENDERS: readonly {
    locale: 'es' | 'en';
    key: string;
    owner: string;
    measuredOn: string;
    expires: string;
  }[] = [
    { locale: 'es', key: 'home.sellBody', owner: 'dueño (copy) → frontend aplica', measuredOn: '2026-10-18', expires: '2026-11-18' },
    { locale: 'es', key: 'buylist.subtitle', owner: 'dueño (copy) → frontend aplica', measuredOn: '2026-10-18', expires: '2026-11-18' },
    { locale: 'en', key: 'home.sellBody', owner: 'dueño (copy) → frontend aplica', measuredOn: '2026-10-18', expires: '2026-11-18' },
    { locale: 'en', key: 'buylist.subtitle', owner: 'dueño (copy) → frontend aplica', measuredOn: '2026-10-18', expires: '2026-11-18' },
  ];
  const CATALOGS = { es, en } as const;
  const badKeys = (catalog: unknown) =>
    stringEntries(catalog)
      .filter(([, v]) => FORBIDDEN_PHRASES.some((p) => p.test(v)))
      .map(([k]) => k);

  it.each([
    ['es', es],
    ['en', en],
  ] as const)('%s: ninguna frase prohibida fuera de las excepciones conocidas', (locale, catalog) => {
    const allowed = KNOWN_OFFENDERS.filter((o) => o.locale === locale).map((o) => o.key);
    expect(badKeys(catalog).filter((k) => !allowed.includes(k))).toEqual([]);
  });

  it('cada excepción SIGUE ofendiendo (corregida ⇒ se borra de KNOWN_OFFENDERS)', () => {
    const stale = KNOWN_OFFENDERS.filter((o) => !badKeys(CATALOGS[o.locale]).includes(o.key)).map(
      (o) => `${o.locale}:${o.key}`,
    );
    expect(stale).toEqual([]);
  });

  it('cada excepción tiene dueño, fecha de medición y caducidad vigente (reloj real)', () => {
    const today = todayInMexico();
    for (const o of KNOWN_OFFENDERS) {
      expect(o.owner.trim(), `${o.locale}:${o.key}`).not.toBe('');
      expect(o.measuredOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(o.expires).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(today <= o.expires, `${o.locale}:${o.key} caducó el ${o.expires}: corregir la copia o renovar con decisión del dueño`).toBe(true);
    }
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
