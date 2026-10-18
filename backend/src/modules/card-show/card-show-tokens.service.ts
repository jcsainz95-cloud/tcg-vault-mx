import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import {
  ENV,
  FORM_TOKEN_MAX_AGE_MS,
  FORM_TOKEN_MIN_AGE_MS,
  FormPurpose,
  LINK_PURPOSES,
  LinkKind,
  LinkPurpose,
  FORM_PURPOSES,
  LINK_KINDS,
} from './card-show.constants';

/**
 * card-show-tokens.service.ts — v1.93⟨cardshow⟩ (API_CONTRACT §CARDSHOW.5/.6, ARCHITECTURE §4.CARDSHOW.f).
 *
 * DOS familias de token, con secretos DISTINTOS (⛔ nunca el mismo, §CARDSHOW.5):
 *  - **Token de formulario** (`CARD_SHOW_FORM_SECRET`, L0-SEG-04): lleva `iat` + propósito (`leads`/
 *    `players`). Frena bots sin captcha: un POST sin token / demasiado rápido / reusado / de otro
 *    propósito no tiene efecto. NO se persiste: su «un solo uso» lo da la idempotencia del alta.
 *  - **Token de enlace** (`CARD_SHOW_LINK_SECRET`, C4): ata una fila (`kind`+`id`) a un propósito
 *    disjunto (`confirm`/`cancel`/`unsubscribe`) con `iat` para la caducidad. El «un solo uso» lo da
 *    el ESTADO de la fila (confirmar dos veces ⇒ 410): aquí solo se verifica firma, propósito y edad.
 *
 * Ambos secretos: fail-closed en no-local (se exigen al arrancar); en el ARNÉS (test/dev/local) sin
 * env se derivan EFÍMEROS aleatorios por proceso y DISTINTOS entre sí — ninguna cadena del repo firma
 * nada, y las pruebas que inyectan secretos explícitos siguen funcionando.
 */

const HARNESS_ENVS = new Set(['development', 'test', 'local']);

export type FormTokenResult =
  | { status: 'ok'; iat: number }
  | { status: 'too_fast' } // POST < 2 s ⇒ silencioso (200 idéntico, 0/0)
  | { status: 'expired' } // > 2 h ⇒ 400 FORM_EXPIRED
  | { status: 'invalid' }; // sin token / firma mala / 1 byte alterado / propósito ajeno ⇒ 400

export type LinkTokenResult =
  | { status: 'ok'; kind: LinkKind; id: string; purpose: LinkPurpose; iat: number }
  | { status: 'expired' } // caducado ⇒ la fila ya se borró / 410
  | { status: 'invalid' }; // firma mala / alterado / propósito ajeno / forma mala ⇒ 400

@Injectable()
export class CardShowTokensService {
  private readonly logger = new Logger(CardShowTokensService.name);
  private readonly formSecret: Buffer;
  private readonly linkSecret: Buffer;
  private static ephemeralForm?: Buffer;
  private static ephemeralLink?: Buffer;

  constructor(config: ConfigService) {
    this.formSecret = this.resolve(config, ENV.FORM_SECRET, 'form');
    this.linkSecret = this.resolve(config, ENV.LINK_SECRET, 'link');
  }

  private resolve(config: ConfigService, key: string, which: 'form' | 'link'): Buffer {
    const raw = (config.get<string>(key) ?? '').trim();
    if (raw.length > 0) {
      const b64 = Buffer.from(raw, 'base64');
      return b64.length >= 32 ? b64 : Buffer.from(raw, 'utf8');
    }
    const nodeEnv = process.env.NODE_ENV;
    const harness = nodeEnv !== undefined && nodeEnv.trim() !== '' && HARNESS_ENVS.has(nodeEnv);
    if (!harness) {
      throw new Error(
        `${key} is required here (NODE_ENV=${nodeEnv ?? 'unset'}). The Card Show form/link tokens ` +
          'cannot be signed with a derivable fallback. Generate: openssl rand -base64 32',
      );
    }
    this.logger.warn(`${key} not set — using an EPHEMERAL per-process secret (${which}, harness only).`);
    if (which === 'form') {
      if (!CardShowTokensService.ephemeralForm) CardShowTokensService.ephemeralForm = randomBytes(32);
      return CardShowTokensService.ephemeralForm;
    }
    if (!CardShowTokensService.ephemeralLink) CardShowTokensService.ephemeralLink = randomBytes(32);
    return CardShowTokensService.ephemeralLink;
  }

  // ── Token de formulario (§CARDSHOW.5) ──────────────────────────────────────────────────────────

  /** Emite un token firmado para `purpose` con `iat = now`. Forma: `<b64url(payload)>.<b64url(hmac)>`. */
  issueFormToken(purpose: FormPurpose, now: number = Date.now()): string {
    const payload = b64urlEncode(JSON.stringify({ p: purpose, t: now }));
    return `${payload}.${this.sign(this.formSecret, payload)}`;
  }

  /** Verifica un token de formulario contra el propósito esperado y la ventana de edad [2 s, 2 h]. */
  verifyFormToken(token: string | undefined | null, expected: FormPurpose, now: number = Date.now()): FormTokenResult {
    const parsed = this.verifySignature(this.formSecret, token);
    if (!parsed) return { status: 'invalid' };
    const purpose = parsed.p;
    const iat = parsed.t;
    if (typeof purpose !== 'string' || !(FORM_PURPOSES as readonly string[]).includes(purpose)) return { status: 'invalid' };
    if (typeof iat !== 'number') return { status: 'invalid' };
    if (purpose !== expected) return { status: 'invalid' }; // token de `players` usado en `leads` ⇒ 400
    const age = now - iat;
    if (age < 0) return { status: 'invalid' }; // `iat` en el futuro: token forjado
    if (age > FORM_TOKEN_MAX_AGE_MS) return { status: 'expired' };
    if (age < FORM_TOKEN_MIN_AGE_MS) return { status: 'too_fast' };
    return { status: 'ok', iat };
  }

  // ── Token de enlace (§CARDSHOW.6) ──────────────────────────────────────────────────────────────

  /** Emite el token de enlace que ata la fila `kind`+`id` al propósito, con `iat = now`. */
  issueLinkToken(kind: LinkKind, id: string, purpose: LinkPurpose, now: number = Date.now()): string {
    const payload = b64urlEncode(JSON.stringify({ k: kind, i: id, p: purpose, t: now }));
    return `${payload}.${this.sign(this.linkSecret, payload)}`;
  }

  /**
   * Verifica un token de enlace. `expected` acota el propósito del endpoint (un token `confirm` en la
   * ruta `unsubscribe` ⇒ `invalid`). `ttlMs` = caducidad según el `kind` (7 d leads / 72 h torneo).
   */
  verifyLinkToken(
    token: string | undefined | null,
    expected: LinkPurpose,
    ttlMs: number,
    now: number = Date.now(),
  ): LinkTokenResult {
    const parsed = this.verifySignature(this.linkSecret, token);
    if (!parsed) return { status: 'invalid' };
    const kind = parsed.k;
    const id = parsed.i;
    const purpose = parsed.p;
    const iat = parsed.t;
    if (typeof kind !== 'string' || !(LINK_KINDS as readonly string[]).includes(kind)) return { status: 'invalid' };
    if (typeof id !== 'string' || id.length === 0) return { status: 'invalid' };
    if (typeof purpose !== 'string' || !(LINK_PURPOSES as readonly string[]).includes(purpose)) return { status: 'invalid' };
    if (typeof iat !== 'number') return { status: 'invalid' };
    if (purpose !== expected) return { status: 'invalid' }; // propósito ajeno ⇒ 400
    const age = now - iat;
    if (age < 0) return { status: 'invalid' };
    if (age > ttlMs) return { status: 'expired' };
    return { status: 'ok', kind: kind as LinkKind, id, purpose: purpose as LinkPurpose, iat };
  }

  // ── primitivas ───────────────────────────────────────────────────────────────────────────────

  private sign(secret: Buffer, payload: string): string {
    return createHmac('sha256', secret).update(payload).digest('base64url');
  }

  /** Separa `payload.sig`, verifica la firma en tiempo constante y devuelve el JSON parseado o `null`. */
  private verifySignature(secret: Buffer, token: string | undefined | null): Record<string, unknown> | null {
    if (!token || typeof token !== 'string') return null;
    const dot = token.lastIndexOf('.');
    if (dot <= 0 || dot === token.length - 1) return null;
    const payload = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const expected = this.sign(secret, payload);
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    try {
      const json = JSON.parse(b64urlDecode(payload));
      return json && typeof json === 'object' ? (json as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
}

function b64urlEncode(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64url');
}
function b64urlDecode(s: string): string {
  return Buffer.from(s, 'base64url').toString('utf8');
}
