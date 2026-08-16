/**
 * MailPort — puerto de bajo nivel para enviar un correo YA renderizado. ARCHITECTURE §4.11.
 * Desacopla el dominio del proveedor (Resend) → mockeable en tests, intercambiable de proveedor.
 * Token DI: `MAIL_PORT` (se resuelve a ResendMailAdapter con RESEND_API_KEY, o NoopMailAdapter).
 */
export const MAIL_PORT = 'MAIL_PORT';

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface MailPort {
  send(msg: MailMessage): Promise<{ id?: string }>;
}
