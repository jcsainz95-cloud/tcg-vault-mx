import { privacyNoticeEs } from '@/content/legal/privacidad.es';
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
 * en la vista previa). En producción, mientras el texto tenga marcadores (P-LEG-1…3), NO: un enlace
 * a un 404 sería peor que ninguno. Aparece solo, sin cambio de código, cuando el texto queda limpio.
 */
export function privacyLinkVisible(env: LegalEnv = legalEnvFromProcess()): boolean {
  return privacyVisibility(privacyNoticeEs, env) !== 'hidden';
}
