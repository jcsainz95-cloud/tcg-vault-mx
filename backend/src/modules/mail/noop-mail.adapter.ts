import { Logger } from '@nestjs/common';
import { MailMessage, MailPort } from './mail.port';

/**
 * NoopMailAdapter — NO envía correo. Loguea destinatario + asunto y (en no-prod) el cuerpo
 * de texto, que incluye el LINK con el token en claro, para dev/CI/tests SIN RESEND_API_KEY.
 * Se selecciona cuando falta la key en LOCAL_ENVS (ARCHITECTURE §4.11; en no-local la key es
 * requerida por env.validation, así que ahí nunca se cae a Noop).
 */
export class NoopMailAdapter implements MailPort {
  private readonly logger = new Logger(NoopMailAdapter.name);

  async send(msg: MailMessage): Promise<{ id?: string }> {
    this.logger.log(
      `[NOOP MAIL] to=${msg.to} subject="${msg.subject}" (no se envía; adaptador Noop)`,
    );
    // El texto lleva el link con el token en claro: útil para dev/CI. Nunca en prod (allí es Resend).
    this.logger.debug(`[NOOP MAIL] body:\n${msg.text}`);
    return { id: undefined };
  }
}
