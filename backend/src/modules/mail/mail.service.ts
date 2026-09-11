import { Inject, Injectable } from '@nestjs/common';
import { MAIL_PORT, MailPort } from './mail.port';
import { emailVerificationTemplate, passwordResetTemplate } from './mail.templates';
import { greetingName, NameSourceLike } from './greeting-name';

/**
 * MailService — servicio de dominio de correo (plantillas + i18n por `User.locale`).
 * Construye el mensaje bilingüe y lo delega al `MailPort` (Resend o Noop). ARCHITECTURE §4.11.
 * Los links (`link`) los construye el caller (AuthService) contra APP_BASE_URL del frontend.
 */
@Injectable()
export class MailService {
  constructor(@Inject(MAIL_PORT) private readonly mail: MailPort) {}

  // v1.67 (§4.47.5): `nameSource` decide si el saludo lleva nombre (`greetingName()`); con `derived`
  // (nombre fabricado a partir del correo) el correo saluda SIN nombre. Opcional por compatibilidad.
  async sendEmailVerification(
    user: { email: string; name: string; nameSource?: NameSourceLike | null; locale?: string | null },
    link: string,
  ): Promise<void> {
    const msg = emailVerificationTemplate(link, greetingName(user), user.locale);
    await this.mail.send({ ...msg, to: user.email });
  }

  async sendPasswordReset(
    user: { email: string; name: string; nameSource?: NameSourceLike | null; locale?: string | null },
    link: string,
  ): Promise<void> {
    const msg = passwordResetTemplate(link, greetingName(user), user.locale);
    await this.mail.send({ ...msg, to: user.email });
  }
}
