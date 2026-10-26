import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import es from '../../messages/es.json';
import en from '../../messages/en.json';
import { HELD_FAQS, PUBLIC_FAQS, FAQ_GROUP_ORDER } from '@/content/seo/faq.es';
import { HOW_IT_WORKS_SECTIONS } from '@/content/seo/como-funciona.es';
import { GUIDES } from '@/content/seo/guides.es';
import {
  AUTHENTICITY_CLAIM_PATTERNS,
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
import { FIXTURE_CONTENT as FIX, FX_NOW } from './seo-content.fixture';

/** Un día dentro de la vigencia de la publicación vigente (manual v8). */
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

describe('§E4 FAQ públicas (RESPUESTAS.md §12.2, manual v8)', () => {
  it('ids únicos, grupos del manual, las 24 publicadas (P8 incluida desde v8) y ninguna retenida', () => {
    const ids = PUBLIC_FAQS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(PUBLIC_FAQS).toHaveLength(24); // P1-P24 del manual v8
    expect(HELD_FAQS).toEqual([]);
    for (const f of PUBLIC_FAQS) expect(FAQ_GROUP_ORDER).toContain(f.group);
    for (const h of HELD_FAQS) expect(ids).not.toContain(h.id);
  });

  it('hoy (NOW) se publican las 24 FAQ vivas', () => {
    expect(publishedFaqs(NOW)).toHaveLength(24);
  });

  // FE-MKT-T1: la regla de vigencia se prueba sobre el fixture (fechas fijas), no sobre las FAQ vivas.
  it('vigencia (fixture): FX1 sale el 2030-01-06 (hora CDMX); todas salen tras el 2030-01-20', () => {
    expect(publishedFaqs(FX_NOW, FIX.faqs)).toHaveLength(3);
    // 2030-01-06 05:59Z = 2030-01-05 23:59 en CDMX ⇒ FX1 aún vigente.
    expect(publishedFaqs(new Date('2030-01-06T05:59:00Z'), FIX.faqs).map((f) => f.id)).toContain('FX1');
    expect(publishedFaqs(new Date('2030-01-06T06:00:00Z'), FIX.faqs).map((f) => f.id)).not.toContain('FX1');
    expect(publishedFaqs(new Date('2030-01-10T23:00:00Z'), FIX.faqs).map((f) => f.id)).toEqual(['FX2', 'FX3']);
    expect(publishedFaqs(new Date('2030-01-21T07:00:00Z'), FIX.faqs)).toHaveLength(0);
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
    expect(groups.flatMap((g) => g.faqs)).toHaveLength(24);
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

  // Canario: la misma función, con el día inyectado y el FIXTURE (FE-MKT-T1: fechas que no se renuevan), muerde
  // exactamente en el borde.
  it('canario (fixture): verde a 8 días de FX1, rojo a 7, a 0 y ya vencida', () => {
    const soon = (iso: string) => faqsExpiringSoon(new Date(iso), FIX.faqs);
    expect(soon('2029-12-28T18:00:00Z')).toEqual([]);
    expect(soon('2029-12-29T18:00:00Z')).toEqual([{ id: 'FX1', validThrough: '2030-01-05', daysLeft: 7 }]);
    expect(soon('2030-01-05T18:00:00Z')[0]).toEqual({ id: 'FX1', validThrough: '2030-01-05', daysLeft: 0 });
    // 2030-01-03: FX1 a 2 días y FX2 a 7 ⇒ ambas en la ventana, la más próxima primero; FX3 (a 17) fuera.
    expect(soon('2030-01-03T18:00:00Z').map((f) => f.id)).toEqual(['FX1', 'FX2']);
    expect(soon('2030-01-02T18:00:00Z').map((f) => f.id)).toEqual(['FX1']);
    // Día CDMX, no UTC: 2029-12-29 03:00Z sigue siendo 2029-12-28 en CDMX ⇒ verde.
    expect(soon('2029-12-29T03:00:00Z')).toEqual([]);
    const late = soon('2030-01-06T18:00:00Z');
    expect(late[0]).toEqual({ id: 'FX1', validThrough: '2030-01-05', daysLeft: -1 });
    expect(late.map((f) => f.id)).toEqual(['FX1', 'FX2']);
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
   * FE-MKT-T1: sobre el fixture. 2030-01-11 (CDMX) = FX2 ya vencida ⇒ `fx-cita` fuera de la lista, del sitemap y
   * de `llms.txt`; `fx-sola` (sin citas) sigue, y FX3 mantiene `/preguntas` vivo.
   */
  it('guía con FAQ vencida (fixture): sale entera de la lista, del sitemap y de llms.txt', () => {
    const after = new Date('2030-01-11T18:00:00Z');
    const [cita] = FIX.guides;
    expect(guideCitationsLive(cita, FX_NOW, FIX.faqs)).toBe(true);
    expect(guideCitationsLive(cita, after, FIX.faqs)).toBe(false);
    expect(publishedGuides(FX_NOW, FIX).map((g) => g.slug)).toEqual(['fx-cita', 'fx-sola']);
    expect(publishedGuides(after, FIX).map((g) => g.slug)).toEqual(['fx-sola']);
    const paths = contentSitemapPaths(after, FIX).map((p) => p.path);
    expect(paths).toContain('/preguntas');
    expect(paths).not.toContain('/guias/fx-cita');
    expect(paths).toContain('/guias/fx-sola');
    const llms = buildLlmsTxt({ supportContact: 'soporte@tcghunt.mx', now: after, src: FIX });
    expect(llms).not.toContain('/guias/fx-cita');
    expect(llms).not.toContain(cita.headline);
    expect(llms).toContain('/guias/fx-sola');
  });
});

describe('frases prohibidas (brief §E4/§E6) y reglas de §12.0.4', () => {
  it('ninguna frase prohibida en el contenido público (FAQ, guías, llms.txt)', () => {
    expect(offenders(allContentTexts(), FORBIDDEN_PHRASES)).toEqual([]);
  });

  /*
   * Trinquete sobre TODO `messages/` (ES y EN): ninguna cadena nueva puede traer una frase prohibida.
   * Excepciones CONOCIDAS: las cuatro de CHK-MOVIL (abajo). Las cuatro de D4a (`home.sellBody` y `buylist.subtitle`, es+en, «nosotros
   * autenticamos» / «we authenticate») se corrigieron el 2026-10-19 con el texto que decidió el dueño («verificamos la
   * condición NM», HECHOS.md 2026-10-19) y salieron de la lista: el trinquete es absoluto.
   * D4a (techlead, 2026-10-18): toda excepción futura lleva dueño, fecha de medición y caducidad, y TIENE QUE SEGUIR
   * OFENDIENDO: si alguien corrige la cadena, la excepción sale de esta lista (si no, la prueba se pone roja). Al
   * vencer `expires` sin corregir, rojo con el reloj real.
   */
  /** `mustSay`: lo que la fila de HECHOS tiene que seguir diciendo para que la aprobación valga (alcance de la excepción). */
  type Approval = { hechosRow: string; date: string; quote: string; mustSay: RegExp };
  const CHK_APPROVAL: Approval = {
    hechosRow: 'Textos del checkout y medición aprobados',
    date: '2026-10-25',
    quote: 'si a todo',
    mustSay: /envío gratis.{0,4} SOLO en el aviso de umbral/,
  };
  /*
   * §DSC (códigos de descuento): el dueño aprobó «envío gratis» TAMBIÉN en lo propio de un código de envío gratis
   * (`HECHOS.md` 2026-10-25, fila «Códigos de descuento: pantallas y P-DSC-3», literal «Sí, apruebo»: «se permite
   * «envío gratis» también en los textos de los códigos de envío gratis, además del aviso del umbral»). Lista blanca
   * cerrada de DESIGN_SYSTEM §DSC-UX.4 (C1b, C4 de envío, C13b) más el nombre del TIPO en el panel (§DSC-UX.5: «es el
   * nombre del tipo y es legítimo (back-office)») y la nota del retiro del panel. Candado DL5: `DSC-DL5` abajo.
   */
  const DSC_APPROVAL: Approval = {
    hechosRow: 'Códigos de descuento: pantallas y P-DSC-3',
    date: '2026-10-25',
    quote: 'Sí, apruebo',
    mustSay: /se permite «envío gratis» también en los textos de los códigos de envío gratis/,
  };
  const dsc = (locale: 'es' | 'en', key: string, note: string) => ({
    locale,
    key,
    owner: 'frontend (decide el dueño)',
    measuredOn: '2026-10-25',
    approved: DSC_APPROVAL,
    note: `excepción aprobada por el dueño (HECHOS 2026-10-25 «Códigos de descuento: pantallas y P-DSC-3») · ${note}`,
  });
  /*
   * Dos clases de excepción: DEUDA (`expires`: caduca y pone rojo con el reloj real) o APROBADA POR EL DUEÑO
   * (`approved`: cita la fila de `HECHOS.md` y su literal; sin caducidad mientras la regla que la aprueba exista —
   * si la fila sale de HECHOS, la prueba de abajo se pone roja). Nunca las dos, nunca ninguna.
   */
  const KNOWN_OFFENDERS: readonly ({
    locale: 'es' | 'en';
    key: string;
    owner: string;
    measuredOn: string;
    note?: string;
  } & ({ expires: string; approved?: never } | { approved: Approval; expires?: never }))[] = [
    /*
     * CHK-MOVIL (DESIGN_SYSTEM §CHK-MOVIL.4, `HECHOS.md` 2026-10-24 «Checkout móvil: opción A»): T3a con envío 0 y
     * T9 dicen «envío gratis» porque el envío ES 0 (regla v2 de §4-G.12: sellado ≥ umbral). Acotada a ESTAS cuatro
     * claves —nada más de `messages/` puede decirlo— y APROBADA POR EL DUEÑO el 2026-10-25 (`HECHOS.md`, fila
     * «Textos del checkout y medición aprobados», literal «si a todo»: «se permite «envío gratis» SOLO en el aviso de
     * umbral (T9 … y T3a con envío 0)»). Sin caducidad mientras esa fila exista; añadir una quinta clave sigue rojo.
     */
    {
      locale: 'es',
      key: 'checkout.bar.includesShippingFree',
      owner: 'frontend (decide el dueño)',
      measuredOn: '2026-10-25',
      approved: CHK_APPROVAL,
      note: 'excepción aprobada por el dueño (HECHOS 2026-10-25) · T3a con envío 0',
    },
    {
      locale: 'en',
      key: 'checkout.bar.includesShippingFree',
      owner: 'frontend (decide el dueño)',
      measuredOn: '2026-10-25',
      approved: CHK_APPROVAL,
      note: 'excepción aprobada por el dueño (HECHOS 2026-10-25) · T3a con envío 0',
    },
    {
      locale: 'es',
      key: 'checkout.freeShippingRemaining',
      owner: 'frontend (decide el dueño)',
      measuredOn: '2026-10-25',
      approved: CHK_APPROVAL,
      note: 'excepción aprobada por el dueño (HECHOS 2026-10-25) · T9 «Te faltan {remaining} para envío gratis»',
    },
    {
      locale: 'en',
      key: 'checkout.freeShippingRemaining',
      owner: 'frontend (decide el dueño)',
      measuredOn: '2026-10-25',
      approved: CHK_APPROVAL,
      note: 'excepción aprobada por el dueño (HECHOS 2026-10-25) · T9 «{remaining} more for free shipping»',
    },
    dsc('es', 'checkout.discount.rowWithdrawal', 'C1b «¿Tienes un código de envío gratis?»'),
    dsc('es', 'checkout.discount.lineFreeShipping', 'C4 «Envío gratis ({code})»'),
    dsc('es', 'checkout.discount.withdrawalOnlyFreeShipping', 'C13b'),
    dsc('es', 'admin.discounts.kind.free_shipping', 'panel: nombre del tipo (§DSC-UX.5)'),
    dsc('es', 'admin.discounts.form.withdrawalNote', 'panel: nota del retiro'),
    dsc('en', 'checkout.discount.lineFreeShipping', 'C4 «Free shipping ({code})»'),
    dsc('en', 'admin.discounts.kind.free_shipping', 'panel: type name (§DSC-UX.5)'),
    dsc('en', 'admin.discounts.report.waived', 'panel: reporte «Free shipping given» (§DSC-UX.5 D9, vDSC-1.1)'),
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

  it('cada excepción tiene dueño, fecha de medición y, o caducidad vigente (reloj real), o aprobación del dueño en HECHOS', () => {
    const today = todayInMexico();
    const hechos = readFileSync(resolve(__dirname, '../../../HECHOS.md'), 'utf8').split('\n');
    for (const o of KNOWN_OFFENDERS) {
      const id = `${o.locale}:${o.key}`;
      expect(o.owner.trim(), id).not.toBe('');
      expect(o.measuredOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Boolean(o.expires) !== Boolean(o.approved), `${id}: o caduca o está aprobada, nunca ambas ni ninguna`).toBe(true);
      if (o.expires) {
        expect(o.expires).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(today <= o.expires, `${id} caducó el ${o.expires}: corregir la copia o renovar con decisión del dueño`).toBe(true);
      } else if (o.approved) {
        const row = hechos.find((l) => l.includes(o.approved!.hechosRow));
        expect(row, `${id}: la fila «${o.approved.hechosRow}» ya no está en HECHOS.md ⇒ la aprobación no existe`).toBeDefined();
        expect(row).toContain(o.approved.date);
        expect(row).toContain(`«${o.approved.quote}»`);
        expect(row).toMatch(o.approved.mustSay);
      }
    }
  });

  /** Toda excepción cuyo texto dice «envío gratis»/«free shipping». */
  const freeShippingOffenders = () =>
    KNOWN_OFFENDERS.filter((o) => /envío gratis|free shipping/i.test(String(CATALOGS[o.locale] && stringEntries(CATALOGS[o.locale]).find(([k]) => k === o.key)?.[1])));

  it('CHK-MOVIL: la excepción de «envío gratis» del umbral es SOLO de T3a/T9 y está aprobada por el dueño (HECHOS 2026-10-25)', () => {
    const chk = freeShippingOffenders().filter((o) => o.approved === CHK_APPROVAL);
    expect(chk.map((o) => `${o.locale}:${o.key}`).sort()).toEqual([
      'en:checkout.bar.includesShippingFree',
      'en:checkout.freeShippingRemaining',
      'es:checkout.bar.includesShippingFree',
      'es:checkout.freeShippingRemaining',
    ]);
  });

  it('DSC-DL5: «envío gratis» solo vive en la lista blanca de §DSC-UX.4/.5, y cada excepción es del umbral o de un código de envío gratis', () => {
    const all = freeShippingOffenders();
    // Ninguna tercera aprobación ni una deuda con caducidad que diga «envío gratis».
    for (const o of all) expect([CHK_APPROVAL, DSC_APPROVAL], `${o.locale}:${o.key}`).toContain(o.approved);
    const dscKeys = all.filter((o) => o.approved === DSC_APPROVAL).map((o) => `${o.locale}:${o.key}`).sort();
    expect(dscKeys).toEqual([
      'en:admin.discounts.kind.free_shipping',
      'en:admin.discounts.report.waived',
      'en:checkout.discount.lineFreeShipping',
      'es:admin.discounts.form.withdrawalNote',
      'es:admin.discounts.kind.free_shipping',
      'es:checkout.discount.lineFreeShipping',
      'es:checkout.discount.rowWithdrawal',
      'es:checkout.discount.withdrawalOnlyFreeShipping',
    ]);
    // Los errores genéricos y los de porcentaje/monto NO lo dicen (§DSC-UX.4: «en cualquier otro texto de descuento no se escribe»).
    for (const k of ['invalid', 'minSubtotal', 'onlyScopes', 'barShort', 'barVault', 'removedNotice', 'replaced', 'saves', 'applied', 'alreadyFree', 'zeroDiscount']) {
      expect(String((es.checkout.discount as Record<string, unknown>)[k]), `es:checkout.discount.${k}`).not.toMatch(/env[ií]o\s+gratis/i);
      expect(String((en.checkout.discount as Record<string, unknown>)[k]), `en:checkout.discount.${k}`).not.toMatch(/free\s+shipping/i);
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

/*
 * Trinquete «autentic-» (HECHOS.md 2026-10-19 «El dueño aprueba fusionar la Fase 2 a `main` y cambiar
 * «autenticadas/autenticidad»…»): la tienda dice «verificadas», no «autenticadas/autenticidad». Mismo patrón que
 * KNOWN_OFFENDERS: cada excepción está NOMBRADA, tiene motivo y TIENE QUE SEGUIR OFENDIENDO (si alguien corrige el
 * texto, la excepción sale de la lista o la prueba se pone roja).
 */
describe('«autenticadas/autenticidad» fuera de la copia de la tienda (messages ES/EN + contenido SEO)', () => {
  const hits = (t: string) => AUTHENTICITY_CLAIM_PATTERNS.some((p) => p.test(t));
  const CATALOGS = { es, en } as const;

  /**
   * Copia de autenticación de SESIÓN: no afirma nada sobre cartas. Sin caducidad (no es deuda: es otro sentido de la
   * palabra). Las claves `errors.UNAUTHENTICATED` / `ALREADY_AUTHENTICATED` NO van aquí: la palabra está en la CLAVE,
   * no en el texto («Inicia sesión para continuar.»), y el trinquete mira textos.
   */
  const SESSION_AUTH_KEYS: readonly { locale: 'es' | 'en'; key: string; why: string }[] = [
    { locale: 'es', key: 'auth.mockNotice', why: 'aviso de modo mock del login («Autenticación pendiente de backend»)' },
    { locale: 'en', key: 'auth.mockNotice', why: 'mock-mode login notice («Authentication pending backend»)' },
  ];

  /**
   * PREGUNTA del cliente, no afirmación nuestra: el `name` de P8 conserva «auténtica» por la decisión A de
   * `RESPUESTAS.md` v8 (2026-10-20, «P8 conserva el título «¿…es auténtica?» (opción A: es la pregunta del cliente,
   * no afirmación nuestra)», delegada por el dueño al orquestador). La excepción es el LITERAL exacto: si la pregunta
   * cambia, deja de estar exenta y hay que volver a decidir. Las respuestas no tienen excepción ninguna.
   * (Las dos excepciones de marketing —respuesta de P1 y cierre de la guía `carta-pirata-5-senales`— salieron el
   * 2026-10-23: con el manual v8 y `copy-v2.md` ya no dicen «autentic-».)
   */
  const CUSTOMER_QUESTIONS: readonly { where: string; text: () => string | undefined; literal: string; source: string }[] = [
    {
      where: 'faq:P8.question',
      text: () => PUBLIC_FAQS.find((f) => f.id === 'P8')?.question,
      literal: '¿Cómo sé que una carta que compro en TCG HUNT es auténtica?',
      source: 'RESPUESTAS.md v8 §12.2 P8 (decisión A, 2026-10-20)',
    },
  ];
  const isQuestionField = (t: string) => PUBLIC_FAQS.some((f) => f.question === t);

  it.each([
    ['es', es],
    ['en', en],
  ] as const)('%s: ningún texto de messages/ con «autentic-» fuera de la sesión', (locale, catalog) => {
    const allowed = SESSION_AUTH_KEYS.filter((o) => o.locale === locale).map((o) => o.key);
    const bad = stringEntries(catalog)
      .filter(([k, v]) => hits(v) && !allowed.includes(k))
      .map(([k]) => k);
    expect(bad).toEqual([]);
  });

  it('cada excepción de sesión SIGUE conteniendo la palabra (corregida ⇒ se borra)', () => {
    const stale = SESSION_AUTH_KEYS.filter((o) => {
      const v = stringEntries(CATALOGS[o.locale]).find(([k]) => k === o.key)?.[1];
      return v === undefined || !hits(v);
    }).map((o) => `${o.locale}:${o.key}`);
    expect(stale).toEqual([]);
  });

  it('contenido SEO público (FAQ, guías, llms.txt) sin «autentic-» salvo la pregunta del cliente nombrada', () => {
    // Exenta solo si es un campo `question` Y es el literal decidido: una respuesta o guía con ese mismo texto no pasa.
    const exempt = new Set(CUSTOMER_QUESTIONS.map((q) => q.literal));
    const texts = allContentTexts().filter((t) => !(exempt.has(t) && isQuestionField(t)));
    expect(offenders(texts, AUTHENTICITY_CLAIM_PATTERNS)).toEqual([]);
  });

  it('cada pregunta exenta es el literal decidido y SIGUE ofendiendo (corregida ⇒ se borra de CUSTOMER_QUESTIONS)', () => {
    for (const q of CUSTOMER_QUESTIONS) {
      expect(q.text(), `${q.where}: ya no es el literal de ${q.source}`).toBe(q.literal);
      expect(hits(q.literal), `${q.where}: ya no dice «autentic-» ⇒ bórrala de CUSTOMER_QUESTIONS`).toBe(true);
    }
  });

  it('P1 y la guía de la carta pirata llevan el texto v8 / copy-v2 (sin «autentic-»)', () => {
    expect(PUBLIC_FAQS.find((f) => f.id === 'P1')?.answer).toContain('se quedan verificadas y resguardadas');
    const pirata = GUIDES.find((g) => g.slug === 'carta-pirata-5-senales')!;
    expect(pirata.blocks.map((b) => b.text)).toContain(
      'Cada carta que vendemos se revisa antes de publicarse: que sea original y su condición.',
    );
  });

  it('los tres textos aprobados por el dueño dicen «verificadas» (ES) / «verified» (EN)', () => {
    expect(es.home.heroSubtitle).toMatch(/^Cartas verificadas, con condición garantizada\./);
    expect(es.checkout.vaultUpsell.benefit.custody).toBe('Custodia con condición verificada y garantizada.');
    expect(es.vault.trustBanner).toMatch(/^Tus cartas están verificadas y resguardadas en bóveda\./);
    expect(en.home.heroSubtitle).toMatch(/^Verified cards, condition guaranteed\./);
    expect(en.checkout.vaultUpsell.benefit.custody).toBe('Custody with verified, guaranteed condition.');
    expect(en.vault.trustBanner).toMatch(/^Your cards are verified and kept safe in custody\./);
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

  it('una página sin FAQ vigentes sale del sitemap (fixture)', () => {
    const paths = contentSitemapPaths(new Date('2030-01-21T07:00:00Z'), FIX).map((p) => p.path);
    expect(paths).not.toContain('/preguntas');
    expect(paths).not.toContain('/como-funciona');
    expect(paths).toContain('/guias/fx-sola');
  });
});
