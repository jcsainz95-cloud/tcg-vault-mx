import { privacyNoticeEs, type LegalDocument } from '@/content/legal/privacidad.es';
import { legalEnvFromProcess, privacyVisibility, type LegalEnv } from '@/content/legal/legal-gate';

/**
 * Resuelve la razón social del footer de forma data-driven (P-21).
 *
 * El humano decidió publicar SIN razón social por ahora, así que `footer.legalEntity`
 * puede venir vacío o como placeholder («[Razón social pendiente]» / «[Legal entity pending]»).
 * En esos casos devolvemos `null` para OMITIR la línea legal: nunca debe verse un
 * placeholder entre corchetes en producción. Cuando el humano cargue una razón social
 * real (sin corchetes), aparece sin cambios de código.
 *
 * Se considera «sin definir» cualquier valor vacío/en blanco o envuelto en corchetes
 * (convención de placeholder de los archivos de mensajes).
 */
export function resolveLegalEntity(raw: string | undefined | null): string | null {
  const value = (raw ?? '').trim();
  if (value === '') return null;
  if (value.startsWith('[') && value.endsWith(']')) return null;
  return value;
}

/**
 * LIVE-8 · ¿el pie enlaza «Aviso de privacidad»? Solo si la página se sirve (publicada, o borrador
 * en la vista previa). En producción, mientras el texto tenga marcadores o el modo provisional sea
 * incoherente (§14.17), NO: un enlace a un 404 sería peor que ninguno. `doc` solo lo cambian las
 * pruebas (fixtures con marcadores); la app usa siempre el aviso real.
 */
export function privacyLinkVisible(
  env: LegalEnv = legalEnvFromProcess(),
  doc: LegalDocument = privacyNoticeEs,
): boolean {
  return privacyVisibility(doc, env) !== 'hidden';
}
