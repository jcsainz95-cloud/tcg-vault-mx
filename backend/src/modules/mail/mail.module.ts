import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { envOr } from './mail-env.util';
import { MAIL_PORT, MailPort } from './mail.port';
import { MailService } from './mail.service';
import { ResendMailAdapter } from './resend-mail.adapter';
import { NoopMailAdapter } from './noop-mail.adapter';

// P-21 (rebrand): el remitente REAL viene de la env `MAIL_FROM` (devops). Este default de código
// conserva el buzón histórico verificado en Resend para no romper envíos si la env no está; cuando
// devops verifique el dominio nuevo debe fijar `MAIL_FROM="TCG HUNT <no-reply@tcghunt.mx>"`
// (remitente visible "TCG HUNT", DESIGN_SYSTEM §17.3).
const DEFAULT_MAIL_FROM = 'no-reply@tcgvaultmx.com';

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
        const from = envOr(config.get<string>('MAIL_FROM'), DEFAULT_MAIL_FROM);
        if (apiKey) {
          logger.log(`Correo: ResendMailAdapter (from=${from}).`);
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
