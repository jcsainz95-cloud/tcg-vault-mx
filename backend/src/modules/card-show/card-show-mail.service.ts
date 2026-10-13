import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as dns } from 'dns';
import { MAIL_PORT, MailPort } from '../mail/mail.port';
import { ctaRows, headingRow, mailShell, proseRow, smallLinkRow, spacerRow } from '../buylist/mail-shell';
import { CONFIRM_SUBJECT, ENV, LinkKind } from './card-show.constants';
import { emailDomain } from './mailbox.util';

/**
 * card-show-mail.service.ts — v1.93⟨cardshow⟩ (API_CONTRACT §CARDSHOW.9, C3; §CARDSHOW.11 MX).
 *
 * El correo de confirmación de PLANTILLA y ASUNTO FIJOS:
 *  - ⛔ NINGÚN valor tecleado (Player ID solo «terminado en NNNN»; ⛔ nunca `playerName`).
 *  - ⛔ NINGÚN enlace de marketing (ni `wa.me`, `mailto`, la tienda ni `utm_*`); ⛔ sin imágenes remotas.
 *  - Los ÚNICOS enlaces son del dominio propio: confirmar, «No fui yo», aviso de privacidad.
 *  - Cabeceras `List-Unsubscribe` + `List-Unsubscribe-Post` (RFC 8058).
 *  - `From` en el SUBDOMINIO de envío propio — **de variable de entorno** (`CARD_SHOW_MAIL_FROM`),
 *    ⛔ nunca hardcodeado. Lo prepara devops (SPF/DKIM/DMARC).
 *
 * El transporte real es `MAIL_PORT` (Resend en no-local; Noop en dev/CI, que SOLO cuenta/loguea).
 * ⛔ Nunca envíos reales en CI. La validación MX corre ANTES de enviar (dominio sin MX ni A ⇒ 0 envío).
 */

/** Resolución MX/A de un dominio (inyectable para pruebas). */
export interface MxResolver {
  /** `true` si el dominio tiene registro MX o, en su defecto, A/AAAA (§CARDSHOW.11). */
  hasMailExchange(domain: string): Promise<boolean>;
}

export const MX_RESOLVER = Symbol('CARD_SHOW_MX_RESOLVER');

/** Resolución real vía DNS. Errores/timeout ⇒ `false` (fail-closed: sin DNS no se envía). */
export class DnsMxResolver implements MxResolver {
  async hasMailExchange(domain: string): Promise<boolean> {
    if (!domain) return false;
    try {
      const mx = await dns.resolveMx(domain);
      if (mx && mx.length > 0) return true;
    } catch {
      /* sigue a A/AAAA */
    }
    try {
      const a = await dns.resolve(domain);
      if (a && a.length > 0) return true;
    } catch {
      /* no hay A */
    }
    try {
      const aaaa = await dns.resolve6(domain);
      return !!aaaa && aaaa.length > 0;
    } catch {
      return false;
    }
  }
}

export interface ConfirmMailParams {
  to: string;
  kind: LinkKind;
  confirmUrl: string;
  notMeUrl: string;
  unsubscribeOneClickUrl: string;
  privacyUrl: string;
  /** Solo para el torneo: los últimos dígitos del Player ID para «terminado en NNNN». ⛔ nunca el completo. */
  playerIdLast4?: string;
}

@Injectable()
export class CardShowMailService {
  private readonly logger = new Logger(CardShowMailService.name);

  constructor(
    @Inject(MAIL_PORT) private readonly mail: MailPort,
    @Inject(MX_RESOLVER) private readonly mx: MxResolver,
    private readonly config: ConfigService,
  ) {}

  /** ¿El dominio del correo puede recibir? (MX o A/AAAA). */
  async domainCanReceive(email: string): Promise<boolean> {
    return this.mx.hasMailExchange(emailDomain(email));
  }

  /** `From` del subdominio de envío propio — de entorno. Fallback al `MAIL_FROM` general si no se fijó. */
  private from(): string {
    const own = (this.config.get<string>(ENV.MAIL_FROM) ?? '').trim();
    if (own) return own;
    const general = (this.config.get<string>('MAIL_FROM') ?? '').trim();
    return general || 'no-reply@tcghunt.mx';
  }

  /**
   * Envía el correo de confirmación de plantilla fija. Devuelve `true` si el transporte lo aceptó.
   * ⛔ El llamador ya validó MX, presupuesto y topes: aquí solo se renderiza y se manda.
   */
  async sendConfirmation(params: ConfirmMailParams): Promise<boolean> {
    const r = this.renderConfirmation(params);
    try {
      await this.mail.send({
        to: r.to,
        subject: r.subject,
        html: r.html,
        text: r.text,
        from: this.from(),
        headers: r.headers,
      });
      return true;
    } catch (e) {
      this.logger.error(`Card Show: envío de confirmación falló (${e instanceof Error ? e.message : String(e)}).`);
      return false;
    }
  }

  /**
   * Renderiza el correo. Público para que las pruebas afirmen el invariante C3 (asunto fijo, 0 valores
   * tecleados, solo enlaces del dominio propio, 0 imágenes/utm, List-Unsubscribe).
   */
  renderConfirmation(params: ConfirmMailParams): {
    to: string;
    subject: string;
    html: string;
    text: string;
    headers: Record<string, string>;
  } {
    const idLine =
      params.kind === 'signup' && params.playerIdLast4
        ? `Tu preinscripción (Player ID terminado en ${params.playerIdLast4}) está casi lista.`
        : '';

    // HTML a través del esqueleto de marca compartido (`mailShell`, §31 / PRIV-4): emite la marca y el
    // PIE con el aviso de privacidad (legalmente requerido). ⛔ El cuerpo NO lleva valores tecleados
    // (solo «terminado en NNNN»), ⛔ ni enlaces de marketing: los ÚNICOS enlaces de ACCIÓN son del
    // dominio propio (confirmar, «No fui yo»). El aviso de privacidad lo pone el propio pie del shell.
    const blocks = [
      headingRow('Confirma tu registro', 22),
      proseRow('Gracias por registrarte en TCG HUNT.'),
      ...(idLine ? [proseRow(idLine)] : []),
      spacerRow(8),
      ctaRows(params.confirmUrl, 'Confirmar mi registro', 'accent'),
      spacerRow(8),
      smallLinkRow(params.notMeUrl, 'No fui yo'),
    ];
    const html = mailShell({
      locale: 'es',
      title: CONFIRM_SUBJECT,
      preheader: 'Confirma tu registro para el Card Show de TCG HUNT.',
      blocks,
      footerWhy: 'Recibes este correo porque alguien usó tu dirección para registrarse en TCG HUNT.',
    });

    const text =
      'Gracias por registrarte en TCG HUNT.\n' +
      (idLine ? `\n${idLine}\n` : '') +
      '\nConfirma tu registro aquí:\n' +
      `${params.confirmUrl}\n` +
      '\n¿No fuiste tú? Dínoslo y no volveremos a escribirte:\n' +
      `${params.notMeUrl}\n` +
      `\nAviso de privacidad: ${params.privacyUrl}\n`;

    return {
      to: params.to,
      subject: CONFIRM_SUBJECT, // asunto FIJO (C3)
      html,
      text,
      headers: {
        'List-Unsubscribe': `<${params.unsubscribeOneClickUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    };
  }

  from_(): string {
    return this.from();
  }
}
