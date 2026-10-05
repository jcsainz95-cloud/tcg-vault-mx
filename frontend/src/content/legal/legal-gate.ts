import type { LegalDocument } from './privacidad.es';

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

function textsOf(doc: LegalDocument): string[] {
  const out = [doc.title, doc.updatedAt];
  for (const s of doc.sections) {
    out.push(s.title);
    for (const b of s.blocks) {
      if (b.type === 'p') out.push(b.text);
      else if (b.type === 'list') out.push(...b.items);
      else out.push(...b.head, ...b.rows.flat());
    }
  }
  return out;
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
 * - Sin marcadores ⇒ `published`.
 * - Con marcadores ⇒ `draft` (se ve, con aviso y marcadores resaltados) SOLO en la vista previa
 *   de Vercel, en `next dev` o con `LEGAL_DRAFT_PREVIEW=1` fuera de la producción de Vercel.
 * - Todo lo demás ⇒ `hidden`: 404 y sin enlace. Falla hacia lo seguro: un servidor sin
 *   `VERCEL_ENV` cuenta como producción.
 */
export function privacyVisibility(doc: LegalDocument, env: LegalEnv): LegalVisibility {
  if (findLegalMarkers(doc).length === 0) return 'published';
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
