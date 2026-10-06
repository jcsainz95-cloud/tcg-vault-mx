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
}

export interface MailPort {
  send(msg: MailMessage): Promise<{ id?: string }>;
}
