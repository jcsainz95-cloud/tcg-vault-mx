import type { LegalDocument } from './privacidad.es';
import { PENDING_OWNER_DATUM_LABEL, findLegalMarkers, provisionalProblems } from './legal-gate';
import { PRIVACY_NOTICE_SITES, missingUses } from './privacy-sites';

/**
 * LIVE-8 · puerta de PUBLICACIÓN del aviso de privacidad (criterio 501; API_CONTRACT §14.17 E4-3).
 * Función pura: quien la llama le pasa el documento, los mensajes y el fuente (sin comentarios) de
 * cada sitio. La usan `publish-ready.test.ts` (`npm run check:legal[:provisional]`) y las pruebas
 * LEG-P1…P7.
 *
 *  - Ambos modos: marcadores del aviso, coherencia provisional, `updatedAt` cargado y los SIETE sitios
 *    (LEG-5; 503–505 no los cubre la excepción del dueño).
 *  - Solo `final`: `pendingOwnerData` vacío (P-LEG-1…3) y `common.footer.legalEntity` real en es y en.
 */
export type LegalPublishMode = 'provisional' | 'final';

type FooterMessages = { common: { footer: { legalEntity: string } } };
export interface LegalMessages {
  es: FooterMessages;
  en: FooterMessages;
}

export interface LegalPublishInput {
  doc: LegalDocument;
  messages: LegalMessages;
  /** Fuente de cada sitio por `id` (ya sin comentarios). Un sitio sin entrada cuenta como ausente. */
  siteSources: Readonly<Record<number, string | undefined>>;
}

export function legalPublishProblems(mode: LegalPublishMode, { doc, messages, siteSources }: LegalPublishInput): string[] {
  const problems: string[] = [];

  for (const m of findLegalMarkers(doc)) problems.push(`marcador en el aviso: «${m}»`);
  problems.push(...provisionalProblems(doc));
  if (doc.updatedAt.trim() === '') problems.push('updatedAt vacío: el aviso no dice su fecha de actualización');

  for (const site of PRIVACY_NOTICE_SITES) {
    const label = `sitio ${site.id} · ${site.name} (${site.file}, lote ${site.lote})`;
    const src = siteSources[site.id];
    if (src === undefined) problems.push(`${label}: fichero no encontrado`);
    else if (missingUses(site, src).length > 0) problems.push(`${label}: falta el componente del aviso`);
  }

  if (mode === 'final') {
    const pending = doc.pendingOwnerData ?? [];
    if (pending.length > 0) {
      const names = pending.map((v) => PENDING_OWNER_DATUM_LABEL[v] ?? v).join(', ');
      problems.push(`faltan P-LEG-1…3: ${names} (pendingOwnerData no está vacío)`);
    }
    for (const loc of ['es', 'en'] as const) {
      const v = (messages[loc]?.common?.footer?.legalEntity ?? '').trim();
      if (v === '' || /^\[.*\]$/.test(v)) {
        problems.push(`common.footer.legalEntity (${loc}) vacío o entre corchetes: «${v}»`);
      }
    }
  }
  return problems;
}
