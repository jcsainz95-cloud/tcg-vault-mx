/**
 * MailPort — puerto de bajo nivel para enviar un correo YA renderizado. ARCHITECTURE §4.11.
 * Desacopla el dominio del proveedor (Resend) → mockeable en tests, intercambiable de proveedor.
 * Token DI: `MAIL_PORT` (se resuelve a ResendMailAdapter con RESEND_API_KEY, o NoopMailAdapter).
 */
export const MAIL_PORT = 'MAIL_PORT';

/**
 * ⭐ rev BSD-1 (API_CONTRACT §BSD.8.2): un adjunto. Hoy solo la etiqueta PDF de la guía de entrada en AV-7 (a lo sumo uno,
 * ≤ 5 MB por `downloadLabelPdf`). `ResendMailAdapter` lo pasa; `NoopMailAdapter` lo ignora (solo lo cuenta en el log).
 */
export interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType: 'application/pdf';
}

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments?: MailAttachment[];
  /**
   * ⭐ v1.93⟨cardshow⟩ (API_CONTRACT §CARDSHOW.9, C3): remitente POR MENSAJE. El Card Show manda desde
   * su SUBDOMINIO de envío propio (`CARD_SHOW_MAIL_FROM`), distinto del `From` general de la tienda.
   * Ausente ⇒ el adaptador usa su `from` de construcción (el cuerpo de hoy, bit a bit).
   */
  from?: string;
  /**
   * ⭐ v1.93⟨cardshow⟩ (§CARDSHOW.9): cabeceras extra (p. ej. `List-Unsubscribe` + `List-Unsubscribe-Post`,
   * RFC 8058). Ausente ⇒ sin cabeceras extra (comportamiento previo, byte a byte).
   */
  headers?: Record<string, string>;
  /**
   * ⭐ CC de PRIMERA CLASE (no cabecera arbitraria). El aviso interno del Card Show manda copia real al
   * equipo (Jakomi/scarranza): `ResendMailAdapter` lo pasa al parámetro `cc` NATIVO de Resend — una cabecera
   * `Cc` arbitraria NO garantiza la copia real. Ausente ⇒ la clave no viaja (el cuerpo de los demás correos
   * queda byte a byte igual, como `from?`/`headers?`). Infra backend aditiva (⛔ no toca el contrato).
   */
  cc?: string | string[];
}

export interface MailPort {
  send(msg: MailMessage): Promise<{ id?: string }>;
}
