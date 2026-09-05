import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { envOr } from './mail-env.util';
import { MAIL_PORT, MailPort } from './mail.port';
import { MailService } from './mail.service';
import { ResendMailAdapter } from './resend-mail.adapter';
import { NoopMailAdapter } from './noop-mail.adapter';

// P-21 (rebrand, MIGRACIÓN CERRADA — ago-2026): el buzón `@tcghunt.mx` YA recibe correo, que era
// la condición que `.env.example` exigía para mover este default. El remitente REAL sigue viniendo
// de la env `MAIL_FROM` (devops fija `MAIL_FROM="TCG HUNT <no-reply@tcghunt.mx>"`, remitente
// visible "TCG HUNT", DESIGN_SYSTEM §17.3); este default es solo la RED DE SEGURIDAD si la env
// falta.
//
// NO REVERTIR al histórico `no-reply@tcgvaultmx.com`: ese dominio ya no es del negocio y Resend
// rechaza cualquier remitente de dominio NO verificado ⇒ ningún correo transaccional sale
// (verificación de email, reset de contraseña, confirmación de pedido…) y el fallo es difícil de
// ver desde fuera. El valor correcto de este default es un buzón del dominio VIVO.
const DEFAULT_MAIL_FROM = 'no-reply@tcghunt.mx';

/**
 * MailModule — provee `MAIL_PORT` (adaptador) + `MailService`. ARCHITECTURE §4.11.
 * Factory de selección: si hay RESEND_API_KEY → ResendMailAdapter (no-local/prod); si no →
 * NoopMailAdapter (LOCAL_ENVS sin key: loguea el correo/link, no envía). En no-local la key es
 * requerida por env.validation, así que ahí SIEMPRE es el adaptador real (nunca Noop silencioso).
 */
@Global()
@Module({
  providers: [
    {
      provide: MAIL_PORT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): MailPort => {
        const logger = new Logger('MailModule');
        const apiKey = config.get<string>('RESEND_API_KEY');
        // P-21 cierre: `envOr` (no `??`) — con `MAIL_FROM=` vacía/blanca cae al default
        // (un from `''` haría que Resend rechazara TODO envío).
        const rawFrom = config.get<string>('MAIL_FROM');
        const from = envOr(rawFrom, DEFAULT_MAIL_FROM);
        const usingDefaultFrom = from === DEFAULT_MAIL_FROM && !rawFrom?.trim();
        if (apiKey) {
          logger.log(`Correo: ResendMailAdapter (from=${from}).`);
          // Observabilidad del remitente (P-21 cierre): con envío REAL y sin `MAIL_FROM`, el
          // remitente es el default de código. Si ese dominio no está verificado en Resend, TODOS
          // los envíos fallan; se avisa en el arranque para que no se descubra por un usuario que
          // nunca recibió su correo de verificación. No aborta: la decisión de fail-closed (exigir
          // `MAIL_FROM` en no-local) es cambio de arranque y está escalada al arquitecto.
          if (usingDefaultFrom) {
            logger.warn(
              `Correo: MAIL_FROM no está fijada → se usa el default de código "${DEFAULT_MAIL_FROM}". ` +
                'Verifica que ese dominio esté verificado en Resend o los envíos fallarán.',
            );
          }
          return new ResendMailAdapter(apiKey, from);
        }
        logger.warn(
          'Correo: RESEND_API_KEY ausente → NoopMailAdapter (no envía; loguea link). ' +
            'Solo válido en entornos locales (dev/CI/tests).',
        );
        return new NoopMailAdapter();
      },
    },
    MailService,
  ],
  exports: [MAIL_PORT, MailService],
})
export class MailModule {}
