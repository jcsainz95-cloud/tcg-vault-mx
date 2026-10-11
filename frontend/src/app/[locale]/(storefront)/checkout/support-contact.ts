/**
 * Buzón de soporte de RESPALDO (contrato v1.82 §PNL.1).
 *
 * La fuente del correo en pantalla es `GET /support/contact` (hook `useSupportContact`, y en el
 * seguimiento del invitado `support.evidenceContact`). Este valor fijo se usa **solo** cuando esa
 * llamada falla (o en una página de servidor cuyo `fetch` falla). ⛔ Ninguna pantalla lo pinta
 * mientras la llamada carga, y ningún texto del catálogo lo lleva escrito.
 *
 * Es el mismo default que el resolutor único del backend (`supportContact()`,
 * `backend/src/modules/mail/support-contact.ts`).
 */
export const SUPPORT_CONTACT_FALLBACK = 'soporte@tcghunt.mx';
