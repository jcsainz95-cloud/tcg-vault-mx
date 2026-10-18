import { Inject, Injectable } from '@nestjs/common';
import { CARD_SHOW_COUNTER_STORE, CardShowCounterStore } from './card-show-counter.store';
import { isPublicFreemailDomain, MAILBOX, TOURNAMENT } from './card-show.constants';

/**
 * card-show-mailbox-caps.service.ts — v1.93⟨cardshow⟩ (API_CONTRACT §CARDSHOW.8/.11/.12, C2).
 *
 * Los topes de ENVÍO por buzón/dominio/avisos internos, sobre el contador en Redis (reloj del store,
 * inyectable en pruebas). Cuentan ENVÍOS, no filas. Cada `reserve*` es atómico: ⛔ no consume cupo si
 * va a retener. La clave de buzón es el `mailboxHmac` (canonicalizado: +etiqueta y puntos de Gmail
 * fuera ⇒ `victima+1@`, `v.ictima@gmail` y `victima@` comparten tope).
 */
@Injectable()
export class CardShowMailboxCapsService {
  constructor(@Inject(CARD_SHOW_COUNTER_STORE) private readonly store: CardShowCounterStore) {}

  /**
   * Buzón NO confirmado: máx 2 confirmaciones en toda la campaña, separadas ≥ 24 h. Con una pendiente
   * (dentro de 24 h), retiene. Reloj simulado: altas t0, t0+25 h, t0+50 h ⇒ 2 envíos.
   */
  async reserveUnconfirmedSend(mailboxHmac: string): Promise<boolean> {
    const countKey = `mbox:unconf:count:${mailboxHmac}`;
    const gapKey = `mbox:unconf:gap:${mailboxHmac}`;
    const total = await this.store.count(countKey);
    if (total >= MAILBOX.UNCONFIRMED_MAX) return false; // ya gastó sus 2 en la campaña
    const gapOk = await this.store.claimOnce(gapKey, MAILBOX.UNCONFIRMED_GAP_MS);
    if (!gapOk) return false; // una pendiente dentro de 24 h ⇒ retenida sin correo
    // Campaña larga: TTL muy amplio (el tope es «en toda la campaña»).
    await this.store.hit(countKey, 365 * 24 * 60 * 60 * 1000);
    return true;
  }

  /** Buzón confirmado: máx 4 correos / 24 h (el 5.º no sale). */
  async reserveConfirmedSend(mailboxHmac: string): Promise<boolean> {
    const r = await this.store.reserve(`mbox:conf:${mailboxHmac}`, MAILBOX.CONFIRMED_MAX_PER_DAY, MAILBOX.CONFIRMED_READD_WINDOW_MS);
    return r.allowed;
  }

  /**
   * Tope por dominio no masivo: 20 / 24 h (el 21.º no sale). Los freemail públicos (gmail/outlook/…)
   * quedan EXENTOS: un tope plano por dominio sobre ellos es un DoS contra sus usuarios legítimos (20
   * envíos a cualquier `@gmail.com` retendrían al 21.º registro legítimo). Eximirlos es seguro — el abuso
   * sigue acotado por el tope por BUZÓN (`reserveUnconfirmedSend`) y el throttle por IP (C7). Ver
   * `PUBLIC_FREEMAIL_DOMAINS` en `card-show.constants.ts`.
   */
  async reserveDomainSend(domain: string): Promise<boolean> {
    if (isPublicFreemailDomain(domain)) return true; // ⛔ no consume cupo por dominio (anti-DoS)
    const r = await this.store.reserve(`dom:${domain}`, MAILBOX.DOMAIN_MAX_PER_DAY, 24 * 60 * 60 * 1000);
    return r.allowed;
  }

  /** Avisos internos (vendedor/patrocinador/jsainz@): ≤ 10/h. */
  async reserveInternalNotice(): Promise<boolean> {
    const r = await this.store.reserve('internal:notice', MAILBOX.INTERNAL_MAX_PER_HOUR, 60 * 60 * 1000);
    return r.allowed;
  }

  /** Torneo: máx 4 playerId por buzón y día (el 5.º ⇒ 0 filas). */
  async reservePlayerPerMailboxDay(mailboxHmac: string, day: string): Promise<boolean> {
    const r = await this.store.reserve(
      `torneo:mbox-day:${mailboxHmac}:${day}`,
      TOURNAMENT.MAX_PLAYERS_PER_MAILBOX_DAY,
      24 * 60 * 60 * 1000,
    );
    return r.allowed;
  }
}
