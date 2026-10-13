import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { CARD_SHOW_COUNTER_STORE, CardShowCounterStore } from './card-show-counter.store';
import { ENV, SENDING_CUT_FLAG, WEBHOOK_CUT } from './card-show.constants';

/**
 * card-show-webhook.service.ts — v1.93⟨cardshow⟩ (API_CONTRACT §CARDSHOW.10, C6).
 *
 * Verifica la FIRMA del webhook de Resend (Svix) y aplica el corte: ≥ 2 quejas (`complained`) o ≥ 10
 * rebotes duros (`bounced`) en 24 h ⇒ se cortan las confirmaciones (mismo efecto que C1 al 100 %), y
 * **solo un humano reabre** (`POST /admin/card-show/reopen-sending`). Resend es el mismo equipo que la
 * tienda ⇒ este corte protege la reputación de envío de TODO el negocio.
 *
 * Firma Svix (misma que Resend): `signedContent = "<svix-id>.<svix-timestamp>.<rawBody>"`, HMAC-SHA256
 * con el secreto (`whsec_<base64>`), base64. La cabecera `svix-signature` trae varias `v1,<sig>`;
 * basta que una cuadre. Tolerancia de reloj: ±5 min. Fail-CLOSED: sin secreto ⇒ rechaza.
 */
@Injectable()
export class CardShowWebhookService {
  private readonly logger = new Logger(CardShowWebhookService.name);
  private static readonly TOLERANCE_MS = 5 * 60 * 1000;

  constructor(
    @Inject(CARD_SHOW_COUNTER_STORE) private readonly store: CardShowCounterStore,
    private readonly config: ConfigService,
  ) {}

  /** Verifica la firma. `rawBody` debe ser el cuerpo EXACTO recibido (sin re-serializar). */
  verifySignature(
    rawBody: string,
    headers: { id?: string; timestamp?: string; signature?: string },
    now: number = Date.now(),
  ): boolean {
    const secretRaw = (this.config.get<string>(ENV.RESEND_WEBHOOK_SECRET) ?? '').trim();
    if (!secretRaw) {
      this.logger.error('Webhook de Resend rechazado: secreto ausente (fail-closed, §CARDSHOW.10).');
      return false;
    }
    const { id, timestamp, signature } = headers;
    if (!id || !timestamp || !signature) return false;

    const ts = Number(timestamp) * 1000;
    if (!Number.isFinite(ts) || Math.abs(now - ts) > CardShowWebhookService.TOLERANCE_MS) return false;

    const secretBytes = secretRaw.startsWith('whsec_')
      ? Buffer.from(secretRaw.slice('whsec_'.length), 'base64')
      : Buffer.from(secretRaw, 'utf8');
    const signedContent = `${id}.${timestamp}.${rawBody}`;
    const expected = createHmac('sha256', secretBytes).update(signedContent).digest('base64');
    const provided = signature.split(' ').map((p) => (p.includes(',') ? p.split(',')[1] : p));
    const exp = Buffer.from(expected);
    return provided.some((sig) => {
      const got = Buffer.from(sig);
      return got.length === exp.length && timingSafeEqual(got, exp);
    });
  }

  /**
   * Procesa un evento ya verificado. Devuelve `{ cutNow }` = si ESTE evento disparó el corte (para la
   * alerta + AuditLog del llamador). Cuenta por tipo en ventanas de 24 h.
   */
  async handleEvent(type: string, _now: number = Date.now()): Promise<{ cutNow: boolean }> {
    let n = 0;
    let threshold = 0;
    if (type === 'email.complained') {
      n = await this.store.hit('wh:complained', WEBHOOK_CUT.WINDOW_MS);
      threshold = WEBHOOK_CUT.COMPLAINED_THRESHOLD;
    } else if (type === 'email.bounced') {
      n = await this.store.hit('wh:bounced', WEBHOOK_CUT.WINDOW_MS);
      threshold = WEBHOOK_CUT.BOUNCED_THRESHOLD;
    } else {
      return { cutNow: false }; // delivered/opened/… no cortan
    }
    if (n < threshold) return { cutNow: false };
    const already = await this.store.flag(SENDING_CUT_FLAG);
    await this.store.setFlag(SENDING_CUT_FLAG);
    return { cutNow: !already };
  }

  /** ¿Están cortadas las confirmaciones ahora mismo? */
  async isCut(): Promise<boolean> {
    return this.store.flag(SENDING_CUT_FLAG).catch(() => false);
  }

  /** Corta (C1 al 100 %) marcando la bandera. */
  async cut(): Promise<void> {
    await this.store.setFlag(SENDING_CUT_FLAG);
  }

  /** Reabre (solo humano, auditado por el llamador). */
  async reopen(): Promise<void> {
    await this.store.clearFlag(SENDING_CUT_FLAG);
  }
}
