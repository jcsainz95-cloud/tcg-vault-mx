import { Inject, Injectable, Logger } from '@nestjs/common';
import { CARD_SHOW_COUNTER_STORE, CardShowCounterStore } from './card-show-counter.store';
import { HOUR_MS, MIN_MS, THROTTLE } from './card-show.constants';

/**
 * card-show-throttle.service.ts — v1.93⟨cardshow⟩ (API_CONTRACT §CARDSHOW.4, C7).
 *
 * Throttle por IP en **Redis** (la compuerta de la landing; el `ThrottlerModule` en memoria es la
 * segunda red holgada). La clave es `ipKey` = `req.ip` normalizado (`ipThrottleKey`) — ⛔ no una
 * cabecera del cliente. Ventanas FIJAS: 5/min y 20/h por IP en cada POST, 60/min GLOBAL, 120/h en
 * `/form-token` (⭐v1.98 M-87 IMP-6, antes 30/h), 30/min en `/confirm`·`/unsubscribe`·`/cancel`.
 *
 * Al exceder ⇒ `allowed:false` con `retryAfterSeconds` **entero ≥ 1**. Si Redis falla, fail-OPEN
 * (deja pasar y loguea): el riesgo de la landing es el ENVÍO —acotado por el presupuesto fail-closed—
 * no el acceso; tumbar la captura por un Redis intermitente sería peor que el throttler en memoria.
 */
export interface ThrottleDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

const ALLOW: ThrottleDecision = { allowed: true, retryAfterSeconds: 0 };

@Injectable()
export class CardShowThrottleService {
  private readonly logger = new Logger(CardShowThrottleService.name);

  constructor(@Inject(CARD_SHOW_COUNTER_STORE) private readonly store: CardShowCounterStore) {}

  /** POST /leads y /players: 5/min + 20/h por IP (cada endpoint) y 60/min global. */
  async hitPost(endpoint: 'leads' | 'players', ipKey: string): Promise<ThrottleDecision> {
    try {
      const minKey = `t:${endpoint}:m:${ipKey}`;
      const nMin = await this.store.hit(minKey, MIN_MS);
      if (nMin > THROTTLE.POST_PER_MIN) return await this.deny(minKey);

      const hourKey = `t:${endpoint}:h:${ipKey}`;
      const nHour = await this.store.hit(hourKey, HOUR_MS);
      if (nHour > THROTTLE.POST_PER_HOUR) return await this.deny(hourKey);

      const globalKey = `t:global:m`;
      const nGlobal = await this.store.hit(globalKey, MIN_MS);
      if (nGlobal > THROTTLE.GLOBAL_PER_MIN) return await this.deny(globalKey);

      return ALLOW;
    } catch (e) {
      this.failOpen('hitPost', e);
      return ALLOW;
    }
  }

  /** GET /form-token: 120/h por IP (⇒ 429 en la 121.ª; ⭐v1.98 M-87 IMP-6, antes 30/h). */
  async hitFormToken(ipKey: string): Promise<ThrottleDecision> {
    return this.single(`t:form-token:h:${ipKey}`, HOUR_MS, THROTTLE.FORM_TOKEN_PER_HOUR);
  }

  /** POST /confirm·/unsubscribe·/cancel: 30/min por IP (⇒ 429 en la 31.ª). */
  async hitConfirm(ipKey: string): Promise<ThrottleDecision> {
    return this.single(`t:confirm:m:${ipKey}`, MIN_MS, THROTTLE.CONFIRM_PER_MIN);
  }

  private async single(key: string, ttlMs: number, limit: number): Promise<ThrottleDecision> {
    try {
      const n = await this.store.hit(key, ttlMs);
      if (n > limit) return await this.deny(key);
      return ALLOW;
    } catch (e) {
      this.failOpen('single', e);
      return ALLOW;
    }
  }

  private async deny(key: string): Promise<ThrottleDecision> {
    const ttl = await this.store.ttlMs(key).catch(() => MIN_MS);
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(ttl / 1000)) };
  }

  private failOpen(op: string, e: unknown): void {
    this.logger.warn(
      `Redis no respondió en ${op} (${e instanceof Error ? e.message : String(e)}): el throttle por IP de ` +
        'la landing cae a la segunda red (ThrottlerModule en memoria). El presupuesto de envíos sigue fail-closed.',
    );
  }
}
