import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as dns } from 'dns';
import { MAIL_PORT, MailPort } from '../mail/mail.port';
import { ctaRows, headingRow, mailShell, proseRow, smallLinkRow, spacerRow } from '../buylist/mail-shell';
import {
  CONFIRM_SUBJECT,
  DEFAULT_INTERNAL_TO,
  DEFAULT_MAIL_FROM,
  DEFAULT_MAIL_REPLY_TO,
  ENV,
  INTERNAL_NOTICE_CC,
  LinkKind,
} from './card-show.constants';
import { emailDomain } from './mailbox.util';
import { renderWelcome, WelcomeParams } from './card-show-welcome.templates';
import {
  DailySummaryParams,
  InternalNoticeParams,
  renderInternalNotice,
  renderVisitorDailySummary,
} from './card-show-internal.templates';

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

  /** `From` del subdominio de envío propio — de entorno. Fallback al `MAIL_FROM` general y, al final, al default del dueño. */
  private from(): string {
    const own = (this.config.get<string>(ENV.MAIL_FROM) ?? '').trim();
    if (own) return own;
    const general = (this.config.get<string>('MAIL_FROM') ?? '').trim();
    return general || DEFAULT_MAIL_FROM;
  }

  /** `Reply-To` de los correos de la landing (decisión del dueño: jsainz@tcghunt.mx). De entorno, con default. */
  private replyTo(): string {
    return (this.config.get<string>(ENV.MAIL_REPLY_TO) ?? '').trim() || DEFAULT_MAIL_REPLY_TO;
  }

  /** Destinatario interno principal (To) del aviso al staff / resumen diario. */
  private internalTo(): string {
    return (this.config.get<string>(ENV.INTERNAL_RECIPIENTS) ?? '').trim() || DEFAULT_INTERNAL_TO;
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

  // ───────────────────────────── C3-W: bienvenida RICA (tras confirmar un lead) ─────────────────────────────

  /**
   * Envía el correo de BIENVENIDA (C3-W) a un buzón YA confirmado. Rico (wa.me/utm/Drive/mailto/.ics/Maps).
   * El llamador (CardShowService) ya decidió que toca enviar (una sola vez, tras PENDING→`new`, con topes/
   * presupuesto reservados). Devuelve `true` si el transporte lo aceptó. ⛔ Nunca a una fila PENDING.
   */
  async sendWelcome(params: WelcomeParams): Promise<boolean> {
    const r = renderWelcome(params);
    try {
      await this.mail.send({
        to: r.to,
        subject: r.subject,
        html: r.html,
        text: r.text,
        from: this.from(),
        headers: { ...r.headers, 'Reply-To': this.replyTo() },
      });
      return true;
    } catch (e) {
      this.logger.error(`Card Show: envío de bienvenida (C3-W) falló (${e instanceof Error ? e.message : String(e)}).`);
      return false;
    }
  }

  /** Expuesto para pruebas: render de la bienvenida C3-W (variante por tipo, enlaces ricos, 0 `playerName`). */
  renderWelcome(params: WelcomeParams): { to: string; subject: string; html: string; text: string; headers: Record<string, string> } {
    return renderWelcome(params);
  }

  // ───────────────────────────── correos INTERNOS (no sujetos a C3; ≤10/h lo gobierna el servicio) ─────────────────────────────

  /**
   * Envía el AVISO INTERNO al confirmar vendedor/patrocinador (copy del dueño). To = destinatario interno
   * principal (jsainz@tcghunt.mx); CC REAL del equipo (Jakomi/scarranza) vía el `cc` de PRIMERA CLASE del
   * puerto → parámetro `cc` nativo de Resend (ya no una cabecera `Cc` arbitraria que Resend podría ignorar).
   */
  async sendInternalNotice(params: InternalNoticeParams): Promise<boolean> {
    const r = renderInternalNotice(params);
    try {
      await this.mail.send({
        to: this.internalTo(),
        subject: r.subject,
        html: r.html,
        text: r.text,
        from: this.from(),
        headers: { 'Reply-To': this.replyTo() },
        cc: [...INTERNAL_NOTICE_CC],
      });
      return true;
    } catch (e) {
      this.logger.error(`Card Show: aviso interno falló (${e instanceof Error ? e.message : String(e)}).`);
      return false;
    }
  }

  /** Expuesto para pruebas: render del aviso interno. */
  renderInternalNotice(params: InternalNoticeParams): { subject: string; html: string; text: string } {
    return renderInternalNotice(params);
  }

  /** Envía el RESUMEN DIARIO de visitantes (interno). To = destinatario interno principal. */
  async sendVisitorDailySummary(params: DailySummaryParams): Promise<boolean> {
    const r = renderVisitorDailySummary(params);
    try {
      await this.mail.send({
        to: this.internalTo(),
        subject: r.subject,
        html: r.html,
        text: r.text,
        from: this.from(),
        headers: { 'Reply-To': this.replyTo() },
      });
      return true;
    } catch (e) {
      this.logger.error(`Card Show: resumen diario falló (${e instanceof Error ? e.message : String(e)}).`);
      return false;
    }
  }

  /** Expuesto para pruebas: render del resumen diario. */
  renderVisitorDailySummary(params: DailySummaryParams): { subject: string; html: string; text: string } {
    return renderVisitorDailySummary(params);
  }

  from_(): string {
    return this.from();
  }
}
