/**
 * ⭐ §MKT tienda §E4/§E6/§E7 — helpers PUROS de las páginas de contenido (`/preguntas`,
 * `/como-funciona`, `/guias`) y de `llms.txt`: qué se publica HOY, el JSON-LD de cada página y las
 * rutas para el sitemap. Una sola regla, probada sin levantar Next (`seo-content.test.ts`).
 */
import {
  FAQ_GROUP_ORDER,
  FAQ_LAST_REVIEW,
  PUBLIC_FAQS,
  type FaqGroup,
  type PublicFaq,
} from '@/content/seo/faq.es';
import { HOW_IT_WORKS_SECTIONS } from '@/content/seo/como-funciona.es';
import { GUIDES, type Guide } from '@/content/seo/guides.es';
import { organizationJsonLd, siteAbsoluteUrl } from '@/lib/seo';

/**
 * Origen del contenido. Por defecto, el contenido VIVO (`content/seo/*`); las pruebas de vigencia y sus canarios
 * inyectan un fixture con fechas fijas (FE-MKT-T1) para que la renovación mensual de las FAQ no las reescriba.
 */
export interface ContentSource {
  faqs: readonly PublicFaq[];
  guides: readonly Guide[];
  howItWorks: readonly { group: FaqGroup; faqIds: readonly string[] }[];
}
export const LIVE_CONTENT: ContentSource = {
  faqs: PUBLIC_FAQS,
  guides: GUIDES,
  howItWorks: HOW_IT_WORKS_SECTIONS,
};

/** Zona horaria de las fechas de vigencia (la tienda opera en CDMX). */
const TZ = 'America/Mexico_City';

/** Fecha de hoy en CDMX como `YYYY-MM-DD` (comparable como cadena). */
export function todayInMexico(now: Date = new Date()): string {
  // `en-CA` formatea como YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * FAQ que se publican HOY: las de `PUBLIC_FAQS` cuyo `validThrough` (inclusive) no ha pasado
 * (`RESPUESTAS.md` §12.0 regla 3: revisión vencida ⇒ se retira hasta que se re-mida).
 */
export function publishedFaqs(
  now: Date = new Date(),
  faqs: readonly PublicFaq[] = PUBLIC_FAQS,
): PublicFaq[] {
  const today = todayInMexico(now);
  return faqs.filter((f) => today <= f.validThrough);
}

/** Las FAQ publicadas agrupadas en el orden del manual; grupos vacíos fuera. */
export function groupFaqs(faqs: readonly PublicFaq[]): { group: FaqGroup; faqs: PublicFaq[] }[] {
  return FAQ_GROUP_ORDER.map((group) => ({
    group,
    faqs: faqs.filter((f) => f.group === group),
  })).filter((g) => g.faqs.length > 0);
}

/** Secciones de `/como-funciona` con las FAQ vigentes de cada una (vencidas fuera). */
export function howItWorksSections(
  now: Date = new Date(),
  src: ContentSource = LIVE_CONTENT,
): { group: FaqGroup; faqs: PublicFaq[] }[] {
  const live = new Map(publishedFaqs(now, src.faqs).map((f) => [f.id, f]));
  return src.howItWorks.map((s) => ({
    group: s.group,
    faqs: s.faqIds.map((id) => live.get(id)).filter((f): f is PublicFaq => !!f),
  })).filter((s) => s.faqs.length > 0);
}

/** Texto de una FAQ pública por id (para guías que la citan); `undefined` si no está vigente. */
export function faqAnswer(
  id: string,
  now: Date = new Date(),
  faqs: readonly PublicFaq[] = PUBLIC_FAQS,
): string | undefined {
  return publishedFaqs(now, faqs).find((f) => f.id === id)?.answer;
}

/** URL canónica (siempre `/es`: el contenido solo existe en español). */
export function contentCanonical(path: string): string {
  return siteAbsoluteUrl(`/es${path}`);
}

/** `BreadcrumbList` (Inicio → … ) con URL absolutas. */
export function breadcrumb(trail: { name: string; path: string }[]): Record<string, unknown> {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((t, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: t.name,
      item: contentCanonical(t.path),
    })),
  };
}

/** `FAQPage` con `Question`/`acceptedAnswer` IDÉNTICOS al texto visible (§12.0 regla 5). */
export function faqPageJsonLd(faqs: readonly PublicFaq[], url: string): Record<string, unknown> {
  return {
    '@type': 'FAQPage',
    url,
    inLanguage: 'es-MX',
    mainEntity: faqs.map((f) => ({
      '@type': 'Question',
      name: f.question,
      acceptedAnswer: { '@type': 'Answer', text: f.answer },
    })),
  };
}

/** `WebPage` (cómo funciona, índice de guías), con `dateModified` = última revisión. */
export function webPageJsonLd(opts: {
  name: string;
  url: string;
  dateModified: string;
}): Record<string, unknown> {
  return {
    '@type': 'WebPage',
    name: opts.name,
    url: opts.url,
    inLanguage: 'es-MX',
    dateModified: opts.dateModified,
  };
}

/** `Article` de una guía (v1 §2.5: `headline`, `datePublished`, `author` = Organization TCG HUNT). */
export function articleJsonLd(guide: Guide): Record<string, unknown> {
  const org = organizationJsonLd();
  return {
    '@type': 'Article',
    headline: guide.headline,
    datePublished: guide.datePublished,
    inLanguage: 'es-MX',
    url: contentCanonical(`/guias/${guide.slug}`),
    author: org,
    publisher: org,
  };
}

/** Texto plano de los bloques de una guía (resuelve las FAQ citadas por id). */
export function guideTexts(
  guide: Guide,
  now: Date = new Date(),
  faqs: readonly PublicFaq[] = PUBLIC_FAQS,
): string[] {
  return guide.blocks.flatMap((b) => {
    if (b.kind === 'p') return b.text ? [b.text] : [];
    if (b.kind === 'ol') return [...(b.items ?? [])];
    const answer = b.faqId ? faqAnswer(b.faqId, now, faqs) : undefined;
    return answer ? [answer] : [];
  });
}

/** `meta description` de una guía: su primer texto, recortado a 155 (sin añadir nada). */
export function guideDescription(guide: Guide, now: Date = new Date()): string {
  const first = guideTexts(guide, now)[0] ?? guide.headline;
  return first.length > 155 ? `${first.slice(0, 152).trimEnd()}…` : first;
}

/**
 * Una guía que CITA una FAQ (bloque `faq`) solo se publica si TODAS sus FAQ citadas están vigentes hoy.
 * Decisión (techlead R1, 2026-10-18): una guía con una cita vencida se RETIRA ENTERA —sale de su página (404), del
 * índice `/guias`, del sitemap y de `llms.txt`— en vez de publicarse sin la definición que la sostiene (p. ej.
 * `que-es-nm` sin P7 serían 4 viñetas sin decir qué es NM). Vuelve sola cuando se re-mide la FAQ y se mueve su
 * `validThrough`. Candado: `seo-content.test.ts` («guía con FAQ vencida»).
 */
export function guideCitationsLive(
  guide: Guide,
  now: Date = new Date(),
  faqs: readonly PublicFaq[] = PUBLIC_FAQS,
): boolean {
  return guide.blocks.every((b) => b.kind !== 'faq' || (!!b.faqId && faqAnswer(b.faqId, now, faqs) !== undefined));
}

/** Guías publicables HOY: con todas sus FAQ citadas vigentes y al menos un bloque con texto. */
export function publishedGuides(now: Date = new Date(), src: ContentSource = LIVE_CONTENT): Guide[] {
  return src.guides.filter((g) => guideCitationsLive(g, now, src.faqs) && guideTexts(g, now, src.faqs).length > 0);
}

/** Días de aviso antes del `validThrough` más cercano (techlead R1, 2026-10-18). */
export const FAQ_EXPIRY_WARN_DAYS = 7;

/** Días de calendario entre dos fechas `YYYY-MM-DD` (b − a). */
function daysBetweenYmd(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/**
 * FAQ cuyo `validThrough` cae dentro del aviso (≤ `FAQ_EXPIRY_WARN_DAYS` días desde hoy en CDMX) o ya pasó, la más
 * próxima primero. Vacío ⇒ ninguna vence en la ventana. Lo cobra `seo-content.test.ts` con el RELOJ REAL (mismo
 * patrón que `scripts/check-dast-report-only-expiry.sh`: `now` inyectable solo para el canario).
 */
export function faqsExpiringSoon(
  now: Date = new Date(),
  faqs: readonly PublicFaq[] = PUBLIC_FAQS,
  warnDays: number = FAQ_EXPIRY_WARN_DAYS,
): { id: string; validThrough: string; daysLeft: number }[] {
  const today = todayInMexico(now);
  return faqs
    .map((f) => ({ id: f.id, validThrough: f.validThrough, daysLeft: daysBetweenYmd(today, f.validThrough) }))
    .filter((f) => f.daysLeft <= warnDays)
    .sort((a, b) => a.daysLeft - b.daysLeft || a.id.localeCompare(b.id));
}

/**
 * Rutas de contenido para el sitemap (sin locale), con su `lastmod`. Una página sin contenido
 * vigente NO se lista (p. ej. `/preguntas` si todas las FAQ vencieran).
 */
export function contentSitemapPaths(
  now: Date = new Date(),
  src: ContentSource = LIVE_CONTENT,
): { path: string; lastModified: string }[] {
  const out: { path: string; lastModified: string }[] = [];
  const faqs = publishedFaqs(now, src.faqs);
  if (faqs.length > 0) out.push({ path: '/preguntas', lastModified: FAQ_LAST_REVIEW });
  if (howItWorksSections(now, src).length > 0) {
    out.push({ path: '/como-funciona', lastModified: FAQ_LAST_REVIEW });
  }
  const guides = publishedGuides(now, src);
  if (guides.length > 0) {
    const latest = guides.map((g) => g.datePublished).sort().at(-1)!;
    out.push({ path: '/guias', lastModified: latest });
    for (const g of guides) out.push({ path: `/guias/${g.slug}`, lastModified: g.datePublished });
  }
  return out;
}

/**
 * Frases prohibidas en TODA copia pública de la tienda (brief §E4/§E6, `REGLAS_MKT` MKT-8):
 * «envío gratis» (la guía de buylist se descuenta del pago), «autenticamos» (se retira: «verificamos la
 * condición NM»), «mejor precio» / «pagamos más» (superlativos de precio). Más sus versiones en inglés
 * para `messages/en.json`. Insensible a mayúsculas.
 */
export const FORBIDDEN_PHRASES: readonly RegExp[] = [
  /env[ií]o\s+gratis/i,
  /autenticamos/i,
  /mejor(es)?\s+precios?/i,
  /pagamos\s+m[aá]s/i,
  /free\s+shipping/i,
  /we\s+authenticate/i,
  /best\s+prices?/i,
  /we\s+pay\s+more/i,
];

/**
 * Raíz «autentic-» en la copia de la tienda (ES/EN, con y sin tilde): «autenticadas», «autenticidad», «auténticas»,
 * «authenticated», «authenticity»… La tienda VERIFICA la condición; no afirma autenticar cartas (decisión del dueño,
 * HECHOS.md 2026-10-19 «El dueño aprueba fusionar la Fase 2 a `main` y cambiar «autenticadas/autenticidad»…»).
 * Es una raíz a propósito y no una lista de palabras: cubre las variantes futuras. La copia de autenticación de
 * SESIÓN (p. ej. `auth.mockNotice`) y la PREGUNTA del cliente de la FAQ P8 («¿…es auténtica?», decisión A del
 * manual v8) chocan con la raíz y van como excepciones nombradas en `seo-content.test.ts`; ninguna respuesta ni guía.
 */
export const AUTHENTICITY_CLAIM_PATTERNS: readonly RegExp[] = [/aut[eé]ntic/i, /authentic/i];
