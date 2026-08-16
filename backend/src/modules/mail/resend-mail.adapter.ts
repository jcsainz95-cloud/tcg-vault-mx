import { Logger } from '@nestjs/common';
import { Resend } from 'resend';
import { MailMessage, MailPort } from './mail.port';

/**
 * ResendMailAdapter — envía por Resend (POST https://api.resend.com/emails) con RESEND_API_KEY.
 * Remitente = MAIL_FROM (default `no-reply@tcgvaultmx.com`). Se usa en no-local (staging+prod),
 * donde RESEND_API_KEY es requerida (env.validation). ARCHITECTURE §4.11.
 */
export class ResendMailAdapter implements MailPort {
  private readonly logger = new Logger(ResendMailAdapter.name);
  private readonly resend: Resend;

  constructor(
    apiKey: string,
    private readonly from: string,
  ) {
    this.resend = new Resend(apiKey);
  }

  async send(msg: MailMessage): Promise<{ id?: string }> {
    const { data, error } = await this.resend.emails.send({
      from: this.from,
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
    });
    if (error) {
      // El caller (AuthService) decide si el fallo aborta o es best-effort (registro/reenvío/olvido).
      this.logger.error(`Resend send failed: ${error.name}: ${error.message}`);
      throw new Error(`Resend send failed: ${error.message}`);
    }
    return { id: data?.id };
  }
}
