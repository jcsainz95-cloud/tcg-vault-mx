import { privacyNoticeEs, type LegalDocument } from './privacidad.es';

/**
 * Solo pruebas. El aviso real ya no tiene marcadores (modo provisional, §14.17): las pruebas del
 * candado «con marcadores ⇒ 404 / sin enlace» (LEG-2, LEG-4, F-7) usan esta copia con los dos
 * marcadores típicos del borrador — dato del dueño y fecha — para seguir mordiendo.
 */
export function privacyNoticeWithMarkers(): LegalDocument {
  const doc: LegalDocument = JSON.parse(JSON.stringify(privacyNoticeEs));
  doc.updatedAt = '[FECHA DE PUBLICACIÓN]';
  doc.sections[0].blocks.push({ type: 'p', text: 'RFC: **[DATO DEL DUEÑO: RFC]**.' });
  return doc;
}
