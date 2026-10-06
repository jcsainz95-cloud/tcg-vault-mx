import { PROVISIONAL_FISCAL_TEXT, type LegalDocument, type LegalSection, type PendingOwnerDatum } from './privacidad.es';

/**
 * LIVE-8 · candado de publicación de los textos legales (PROJECT.md §LEG.3 y criterio 501:
 * «ni "[DATO DEL DUEÑO]" ni "[Razón social pendiente]" pueden verse en producción»).
 *
 * Un marcador es: cualquier segmento entre corchetes (el texto final del abogado no los usa) o
 * cualquiera de las frases de trabajo del borrador, aunque alguien quite los corchetes.
 */
const MARKER_PATTERNS: RegExp[] = [
  /\[[^\]]*\]/g,
  /dato del due[ñn]o/gi,
  /nota para el abogado/gi,
  /\bSUPUESTO\b/g,
  /\bBORRADOR\b/g,
  /fecha de publicaci[óo]n/gi,
  /raz[óo]n social pendiente/gi,
  /legal entity pending/gi,
];

function sectionTexts(s: LegalSection): string[] {
  const out = [s.title];
  for (const b of s.blocks) {
    if (b.type === 'p') out.push(b.text);
    else if (b.type === 'list') out.push(...b.items);
    else out.push(...b.head, ...b.rows.flat());
  }
  return out;
}

function textsOf(doc: LegalDocument): string[] {
  return [doc.title, doc.updatedAt, ...doc.sections.flatMap(sectionTexts)];
}

/** Todos los marcadores que quedan en el documento (vacío ⇒ publicable). */
export function findLegalMarkers(doc: LegalDocument): string[] {
  const found: string[] = [];
  for (const text of textsOf(doc)) {
    for (const re of MARKER_PATTERNS) {
      for (const m of text.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`))) {
        found.push(m[0]);
      }
    }
  }
  return found;
}

export interface LegalEnv {
  /** `VERCEL_ENV`. */
  vercelEnv?: string | null;
  /** `NODE_ENV`. */
  nodeEnv?: string | null;
  /** `LEGAL_DRAFT_PREVIEW` (solo servidor): ver el borrador en un `next start` local o E2E. */
  draftPreview?: string | null;
}

export type LegalVisibility = 'published' | 'draft' | 'hidden';

/**
 * - Sin marcadores Y coherente en modo provisional (`provisionalProblems` vacío, §14.17) ⇒ `published`.
 *   Con datos fiscales pendientes se publica igual: excepción del dueño (HECHOS 2026-10-05 sesión 6).
 * - Con marcadores ⇒ `draft` (se ve, con aviso y marcadores resaltados) SOLO en la vista previa
 *   de Vercel, en `next dev` o con `LEGAL_DRAFT_PREVIEW=1` fuera de la producción de Vercel.
 * - Todo lo demás ⇒ `hidden`: 404 y sin enlace. Falla hacia lo seguro: un servidor sin
 *   `VERCEL_ENV` cuenta como producción.
 */
export function privacyVisibility(doc: LegalDocument, env: LegalEnv): LegalVisibility {
  if (findLegalMarkers(doc).length === 0 && provisionalProblems(doc).length === 0) return 'published';
  if (env.vercelEnv === 'production') return 'hidden';
  if (env.vercelEnv === 'preview') return 'draft';
  if (env.nodeEnv === 'development') return 'draft';
  if (env.draftPreview === '1') return 'draft';
  return 'hidden';
}

export function legalEnvFromProcess(): LegalEnv {
  return {
    vercelEnv: process.env.VERCEL_ENV,
    nodeEnv: process.env.NODE_ENV,
    draftPreview: process.env.LEGAL_DRAFT_PREVIEW,
  };
}

/** P-LEG-1 = razón social y RFC; P-LEG-2 = domicilio (`PROJECT.md §LEG.2`). */
export const PENDING_OWNER_DATUM_LABEL: Readonly<Record<PendingOwnerDatum, string>> = {
  razonSocial: 'razón social (P-LEG-1)',
  rfc: 'RFC (P-LEG-1)',
  domicilio: 'domicilio (P-LEG-2)',
};

/**
 * §14.17 E4-3 — coherencia del modo provisional. Vacío ⇒ coherente.
 *  (a) hay pendientes y el apartado `responsable` NO contiene `PROVISIONAL_FISCAL_TEXT` literal;
 *  (b) no hay pendientes y el documento SÍ la contiene;
 *  (c) un valor fuera de la unión cerrada o repetido (guarda de ejecución: un cast lo saltaría en TS).
 */
export function provisionalProblems(doc: LegalDocument): string[] {
  const problems: string[] = [];
  const pending = doc.pendingOwnerData ?? [];
  const seen = new Set<string>();
  for (const v of pending as readonly string[]) {
    if (!Object.prototype.hasOwnProperty.call(PENDING_OWNER_DATUM_LABEL, v)) {
      problems.push(`pendingOwnerData: valor desconocido «${v}» (solo razonSocial, rfc, domicilio)`);
    } else if (seen.has(v)) {
      problems.push(`pendingOwnerData: valor repetido «${v}»`);
    }
    seen.add(v);
  }
  const responsable = doc.sections.find((s) => s.id === 'responsable');
  const inResponsable = !!responsable && sectionTexts(responsable).some((t) => t.includes(PROVISIONAL_FISCAL_TEXT));
  if (pending.length > 0 && !inResponsable) {
    problems.push(
      `pendingOwnerData = [${pending.join(', ')}] y el apartado «responsable» no contiene PROVISIONAL_FISCAL_TEXT literal`,
    );
  }
  if (pending.length === 0 && textsOf(doc).some((t) => t.includes(PROVISIONAL_FISCAL_TEXT))) {
    problems.push('pendingOwnerData = [] (documento final) y el aviso todavía contiene PROVISIONAL_FISCAL_TEXT');
  }
  return problems;
}
