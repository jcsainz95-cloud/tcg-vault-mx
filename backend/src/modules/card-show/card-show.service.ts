import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CardShowDay, CardShowGame, CardShowLeadStatus, CardShowLeadType, CardShowSignupStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PiiCryptoService } from '../../common/crypto/pii-crypto.service';
import { BusinessException } from '../../common/business.exception';
import { parseEnumFilter } from '../../common/enum-filter';
import { AuditService } from '../audit/audit.service';
import { CardShowTokensService } from './card-show-tokens.service';
import { CardShowBudgetService } from './card-show-budget.service';
import { CardShowMailboxCapsService } from './card-show-mailbox-caps.service';
import { CardShowMailService } from './card-show-mail.service';
import { CardShowWebhookService } from './card-show-webhook.service';
import { CreateLeadDto, CreatePlayerDto } from './dto/card-show.dto';
import { assignOnConfirm, playerIdLast4 } from './tournament.util';
import { normalizeMxPhone } from './phone.util';
import { canonicalizeMailbox, emailDomain, normalizeEmail } from './mailbox.util';
import { CARD_SHOW_GAME_VALUES } from '../../common/enum-values';
import type { LeadsSummaryParams, SummaryWindowCounts } from './card-show-internal.templates';
import { runSerializable } from '../../common/serializable-retry';
import {
  DAY_MS,
  ENV,
  LINK_TTL_LEAD_MS,
  LINK_TTL_SIGNUP_MS,
  LinkPurpose,
  TOURNAMENT,
} from './card-show.constants';

/**
 * card-show.service.ts — v1.93⟨cardshow⟩ (API_CONTRACT §CARDSHOW). Orquesta la captura pública, el
 * doble opt-in y las capas de anti-abuso. ⛔ El throttle por IP (C7) vive en el controlador (necesita
 * `req.ip` y la cabecera `Retry-After`); aquí entran ya el honeypot, el token de formulario, los topes
 * por buzón/dominio (C2), el presupuesto (C1), el corte (C6), la validación MX y el doble opt-in (C4).
 *
 * Todo caso SILENCIOSO devuelve `void` (el controlador responde el neutro 202 idéntico); los errores
 * de FORMA del cliente lanzan `BusinessException` (400/410/413).
 */

/**
 * ⭐ §0-Q punto 4 (C-EQ-1) — dominios de los filtros del panel. `status` es clase **R**: el panel
 * NUNCA muestra `pending` (⛔ no confirmado), así que su dominio aceptado es el enum MENOS `pending`.
 * `?status=pending` y cualquier otro valor fuera del subconjunto ⇒ `400 {field, allowed}` (ya NO se
 * ignora en silencio). `type`/`day` son clase **E** (el enum entero, derivado de Prisma).
 */
export const CARD_SHOW_LEAD_STATUS_FILTER_VALUES = ['new', 'contacted', 'closed', 'discarded'] as const satisfies readonly CardShowLeadStatus[];
export const CARD_SHOW_PLAYER_STATUS_FILTER_VALUES = ['confirmed', 'waitlist', 'cancelled', 'checked_in'] as const satisfies readonly CardShowSignupStatus[];

@Injectable()
export class CardShowService {
  private readonly logger = new Logger(CardShowService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pii: PiiCryptoService,
    private readonly tokens: CardShowTokensService,
    private readonly budget: CardShowBudgetService,
    private readonly caps: CardShowMailboxCapsService,
    private readonly mail: CardShowMailService,
    private readonly webhook: CardShowWebhookService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  /** `mailboxHmac` = blindIndex del BUZÓN canonicalizado, con prefijo de propósito propio (§CARDSHOW.8). */
  mailboxHmac(email: string): string {
    return this.pii.blindIndex(`card-show-mbox:v1:${canonicalizeMailbox(email)}`);
  }

  private privacyVersion(): string {
    return (this.config.get<string>('PRIVACY_POLICY_VERSION') ?? 'provisional').trim() || 'provisional';
  }

  private tournamentCap(): number | null {
    const raw = (this.config.get<string>(ENV.TOURNAMENT_CAP_PER_DAY) ?? '').trim();
    if (raw === '') return null; // cupo desconocido (Jakomi aún no lo fija) ⇒ no se recorta
    const n = Number(raw);
    return Number.isInteger(n) && n >= 0 ? n : null;
  }

  /**
   * ⭐v1.98 — IMP-5 (tester-e2e): instrumenta los DESCARTES SILENCIOSOS (los `return` sin efecto que el
   * contrato manda responder con el 202 neutro). Un descarte silencioso sin log NO es diagnosticable —
   * tester-e2e midió 1/14 «los dos días» LIGERA creando 1 sola fila (NO REPRODUCIDO) y no había rastro
   * de por qué. El `debug` registra MOTIVO + PROPÓSITO (+ día + prefijo del `mailboxHmac` para
   * correlacionar sin reconstruir el censo de buzones) ⛔ con 0 PII: ni email, ni name, ni phone, ni
   * playerId, ni IP cruda. El `mailboxHmac` es un blindIndex HMAC (no reversible); se recorta a prefijo.
   */
  private logDiscard(
    reason: 'honeypot' | 'too_fast' | 'suppressed' | 'no_mx' | 'dedupe' | 'tope',
    purpose: 'leads' | 'players',
    ctx?: { day?: CardShowDay; mailboxHmac?: string },
  ): void {
    const parts = [`reason=${reason}`, `purpose=${purpose}`];
    if (ctx?.day) parts.push(`day=${ctx.day}`);
    if (ctx?.mailboxHmac) parts.push(`mbox=${ctx.mailboxHmac.slice(0, 12)}`);
    this.logger.debug(`cardshow discard ${parts.join(' ')}`);
  }

  // ───────────────────────────── «Avísame» (lead) ─────────────────────────────

  async createLead(dto: CreateLeadDto, now: number = Date.now()): Promise<void> {
    if (dto.website && dto.website.trim() !== '') {
      this.logDiscard('honeypot', 'leads');
      return; // honeypot ⇒ silencioso
    }

    // ⭐M-84 (§CARDSHOW.1b) — validación condicional por tipo. Es ERROR DE FORMA (§CARDSHOW.11.v): va ANTES
    // del token/tiempo (que son gates silenciosos anti-bot) para que un campo prohibido/faltante SIEMPRE dé
    // `400 {field}` y ⛔ nunca lo trague el gate silencioso `too_fast`. El honeypot sigue primero (silencio).
    const phone = this.validateLeadFields(dto);

    const ft = this.tokens.verifyFormToken(dto.formToken, 'leads', now);
    if (ft.status === 'invalid') throw BusinessException.badRequest('VALIDATION_ERROR', 'invalid form token', { field: 'formToken' });
    if (ft.status === 'expired') throw BusinessException.badRequest('FORM_EXPIRED', 'form token expired');
    if (ft.status === 'too_fast') {
      this.logDiscard('too_fast', 'leads');
      return; // < 2 s ⇒ silencioso
    }

    const email = normalizeEmail(dto.email);
    const mailboxHmac = this.mailboxHmac(email);
    const domain = emailDomain(email);

    // Buzón suprimido («No fui yo») o dado de baja ⇒ 0 envíos / 0 fila nueva, respuesta idéntica.
    if (await this.isSuppressedOrUnsubscribed(mailboxHmac, now)) {
      this.logDiscard('suppressed', 'leads', { mailboxHmac });
      return;
    }

    // Dominio sin MX ni A ⇒ 0 envío / 0 fila / 200 idéntico.
    if (!(await this.mail.domainCanReceive(email))) {
      this.logDiscard('no_mx', 'leads', { mailboxHmac });
      return;
    }

    const type = dto.type as Prisma.CardShowLeadCreateInput['type'];
    const existing = await this.prisma.cardShowLead.findUnique({ where: { email_type: { email, type } } });

    // Ya confirmado ⇒ no hay nada que confirmar; re-alta dentro de 24 h ⇒ 0 envíos.
    if (existing?.confirmedAt) {
      this.logDiscard('dedupe', 'leads', { mailboxHmac });
      return;
    }

    const lead =
      existing ??
      (await this.prisma.cardShowLead.create({
        data: {
          type,
          name: dto.name,
          phone, // ⭐M-84 solo dígitos (o null); validado/normalizado en validateLeadFields
          email,
          mailboxHmac,
          gameInterest: (dto.gameInterest as CardShowGame | undefined) ?? null,
          raffleOptIn: dto.raffleOptIn === true,
          raffleTermsVersion: dto.raffleTermsVersion ?? null,
          sellsWhat: dto.sellsWhat ?? null,
          consentAt: new Date(now),
          privacyVersion: this.privacyVersion(),
          source: dto.source as Prisma.CardShowLeadCreateInput['source'],
          utmSource: dto.utmSource,
          utmMedium: dto.utmMedium,
          utmCampaign: dto.utmCampaign,
          utmContent: dto.utmContent,
          referrerHost: dto.referrerHost,
          // ⛔ `mesaInteres` RETIRADO (§CARDSHOW.1a-bis): no se escribe.
        },
      }));

    await this.maybeSendConfirmation({ kind: 'lead', rowId: lead.id, email, mailboxHmac, domain, now });
  }

  /**
   * ⭐M-84 (§CARDSHOW.1b) — valida los campos de `CardShowLead` SEGÚN el tipo. Violación ⇒ `400 {field}`
   * (⛔ no silencioso: es error de forma, §CARDSHOW.11.v). Devuelve el `phone` NORMALIZADO (solo dígitos) o
   * `null` cuando no aplica. ⛔ No persiste nada: solo decide.
   */
  private validateLeadFields(dto: CreateLeadDto): string | null {
    const bad = (field: string): never => {
      throw BusinessException.badRequest('VALIDATION_ERROR', `invalid ${field} for lead type`, { field });
    };
    const isVisitor = dto.type === 'visitor';
    const isSeller = dto.type === 'merchant' || dto.type === 'sponsor';

    // phone: OBLIGATORIO merchant/sponsor; ⛔ PROHIBIDO visitor.
    let phone: string | null = null;
    if (isVisitor) {
      if (dto.phone !== undefined) bad('phone');
    } else if (isSeller) {
      if (dto.phone === undefined || dto.phone.trim() === '') bad('phone');
      phone = normalizeMxPhone(dto.phone as string);
      if (phone === null) bad('phone'); // no reduce a 10 dígitos MX
    }

    // gameInterest / raffleOptIn: SOLO visitor; ⛔ PROHIBIDO merchant/sponsor.
    if (isSeller && dto.gameInterest !== undefined) bad('gameInterest');
    if (isSeller && dto.raffleOptIn !== undefined) bad('raffleOptIn');

    // raffleTermsVersion ⇔ raffleOptIn=true.
    const optIn = dto.raffleOptIn === true;
    if (optIn && (dto.raffleTermsVersion === undefined || dto.raffleTermsVersion.trim() === '')) bad('raffleTermsVersion');
    if (!optIn && dto.raffleTermsVersion !== undefined) bad('raffleTermsVersion');

    // sellsWhat: opcional merchant/sponsor; ⛔ PROHIBIDO visitor.
    if (isVisitor && dto.sellsWhat !== undefined) bad('sellsWhat');

    return phone;
  }

  // ───────────────────────────── preinscripción al torneo ─────────────────────────────

  async createPlayer(dto: CreatePlayerDto, now: number = Date.now()): Promise<void> {
    if (dto.website && dto.website.trim() !== '') {
      this.logDiscard('honeypot', 'players');
      return; // honeypot
    }

    // ⭐M-84 (§CARDSHOW.12) — regla FORMAL (pokemon) vs LIGERA (resto) sobre `playerId`. Error de forma
    // (§CARDSHOW.11.v) ⇒ 400 {field:'playerId'}, ANTES del token/tiempo (gates silenciosos).
    this.validatePlayerFields(dto);

    const ft = this.tokens.verifyFormToken(dto.formToken, 'players', now);
    if (ft.status === 'invalid') throw BusinessException.badRequest('VALIDATION_ERROR', 'invalid form token', { field: 'formToken' });
    if (ft.status === 'expired') throw BusinessException.badRequest('FORM_EXPIRED', 'form token expired');
    if (ft.status === 'too_fast') {
      this.logDiscard('too_fast', 'players');
      return;
    }

    // Menor sin consentimiento del tutor ⇒ error de campo (⛔ no silencioso, §CARDSHOW.12).
    if (dto.isMinor && dto.guardianConsent !== true) {
      throw BusinessException.badRequest('VALIDATION_ERROR', 'guardian consent required for a minor', { field: 'guardianConsent' });
    }

    const game = dto.game as CardShowGame;
    const email = normalizeEmail(dto.email);
    const mailboxHmac = this.mailboxHmac(email);
    const domain = emailDomain(email);
    const days: CardShowDay[] = dto.day === 'both' ? [CardShowDay.sat, CardShowDay.sun] : [dto.day as CardShowDay];

    if (await this.isSuppressedOrUnsubscribedSignup(mailboxHmac, now)) {
      this.logDiscard('suppressed', 'players', { mailboxHmac });
      return;
    }
    if (!(await this.mail.domainCanReceive(email))) {
      this.logDiscard('no_mx', 'players', { mailboxHmac });
      return;
    }

    // «los dos» ⇒ 2 filas pero 1 envío (un correo cubre la preinscripción de ese buzón). Cada día que no
    // crea fila ya dejó su log de descarte dentro de `insertPendingSignup` (motivo + día) ⇒ el caso
    // «1/14: los dos días crearon 1 fila» (IMP-5) es ahora diagnosticable por día.
    let anyNewPending = false;
    for (const day of days) {
      const created = await this.insertPendingSignup(dto, game, email, mailboxHmac, day, now);
      if (created) anyNewPending = true;
    }
    if (!anyNewPending) return; // nada nuevo (duplicado exacto / topes) ⇒ 0 envíos (ya logueado por día)

    await this.maybeSendConfirmation({
      kind: 'signup',
      rowId: `${mailboxHmac}`, // el token de confirmación del torneo se emite por fila al confirmar; aquí solo cuenta el envío
      email,
      mailboxHmac,
      domain,
      now,
      playerIdLast4: dto.playerId ? playerIdLast4(dto.playerId) : undefined,
      signupToken: true,
      game,
      playerId: dto.playerId,
      days,
    });
  }

  /**
   * ⭐M-84 (§CARDSHOW.12) — `game=pokemon` ⇒ `playerId` OBLIGATORIO (solo dígitos); `game≠pokemon` (LIGERA) ⇒
   * `playerId` PROHIBIDO (si viene ⇒ `400 {field:'playerId'}`, ⛔ no silencioso). El formato del playerId ya
   * lo validó el DTO (`PLAYER_ID`); aquí solo la regla condicional por juego.
   */
  private validatePlayerFields(dto: CreatePlayerDto): void {
    const isPokemon = dto.game === 'pokemon';
    const hasPlayerId = dto.playerId !== undefined && dto.playerId !== null && dto.playerId !== '';
    if (isPokemon && !hasPlayerId) {
      throw BusinessException.badRequest('VALIDATION_ERROR', 'playerId required for pokemon', { field: 'playerId' });
    }
    if (!isPokemon && hasPlayerId) {
      throw BusinessException.badRequest('VALIDATION_ERROR', 'playerId forbidden for non-pokemon game', { field: 'playerId' });
    }
  }

  /**
   * Inserta una fila PENDING de preinscripción, respetando los topes de contención: máx 4 playerId por
   * buzón y día; máx 3 PENDING por playerId; duplicado exacto (correo+playerId+día) ⇒ no crea otra.
   * Devuelve `true` si creó una fila nueva. ⛔ Una alta NUEVA es INSERT, nunca `upsert` sobre una activa.
   */
  private async insertPendingSignup(
    dto: CreatePlayerDto,
    game: CardShowGame,
    email: string,
    mailboxHmac: string,
    day: CardShowDay,
    now: number,
  ): Promise<boolean> {
    if (game === CardShowGame.pokemon) {
      // ───── FORMAL (Pokémon): cupo/waitlist/índice por (playerId, día) ─────
      // Duplicado exacto (mismo correo+playerId+día, aún vivo) ⇒ 1 fila, no crea otra.
      const dup = await this.prisma.cardShowPlayerSignup.findFirst({
        where: { email, game, playerId: dto.playerId, day, status: { in: ['pending', 'confirmed', 'waitlist', 'checked_in'] } },
      });
      if (dup) {
        this.logDiscard('dedupe', 'players', { day, mailboxHmac });
        return false;
      }

      // Máx 3 PENDING por playerId (la 4.ª ⇒ 0 filas).
      const pendingForPlayer = await this.prisma.cardShowPlayerSignup.count({
        where: { game, playerId: dto.playerId, day, status: 'pending' },
      });
      if (pendingForPlayer >= TOURNAMENT.MAX_PENDING_PER_PLAYER) {
        this.logDiscard('tope', 'players', { day, mailboxHmac });
        return false;
      }

      // Máx 4 playerId por buzón y día (el 5.º ⇒ 0 filas).
      if (!(await this.caps.reservePlayerPerMailboxDay(mailboxHmac, day))) {
        this.logDiscard('tope', 'players', { day, mailboxHmac });
        return false;
      }

      await this.prisma.cardShowPlayerSignup.create({
        data: {
          game,
          day,
          playerName: dto.playerName,
          playerId: dto.playerId,
          email,
          mailboxHmac,
          isMinor: dto.isMinor,
          guardianConsentAt: dto.isMinor ? new Date(now) : null,
          consentAt: new Date(now),
          privacyVersion: this.privacyVersion(),
          utmSource: dto.utmSource,
          utmMedium: dto.utmMedium,
          utmCampaign: dto.utmCampaign,
          utmContent: dto.utmContent,
        },
      });
      return true;
    }

    // ───── LIGERA (resto): solo interés por (buzón, juego, día). Sin cupo/waitlist/índice. ─────
    // Dedupe: una re-alta ACTIVA del mismo (buzón, juego, día) ⇒ 0 filas (máx 1 activa). §CARDSHOW.12.
    const active = await this.prisma.cardShowPlayerSignup.findFirst({
      where: { mailboxHmac, game, day, status: { in: ['confirmed', 'checked_in'] } },
    });
    if (active) {
      this.logDiscard('dedupe', 'players', { day, mailboxHmac });
      return false;
    }

    // Cap de contención LIGERA: máx 3 PENDING por (buzón, juego, día) (la 4.ª ⇒ 0 filas).
    const pendingLigera = await this.prisma.cardShowPlayerSignup.count({
      where: { mailboxHmac, game, day, status: 'pending' },
    });
    if (pendingLigera >= TOURNAMENT.MAX_PENDING_PER_PLAYER) {
      this.logDiscard('tope', 'players', { day, mailboxHmac });
      return false;
    }

    await this.prisma.cardShowPlayerSignup.create({
      data: {
        game,
        day,
        playerName: dto.playerName,
        playerId: null, // ⭐M-84 LIGERA ⇒ sin playerId (no entra al índice único parcial)
        email,
        mailboxHmac,
        isMinor: dto.isMinor,
        guardianConsentAt: dto.isMinor ? new Date(now) : null,
        consentAt: new Date(now),
        privacyVersion: this.privacyVersion(),
        utmSource: dto.utmSource,
        utmMedium: dto.utmMedium,
        utmCampaign: dto.utmCampaign,
        utmContent: dto.utmContent,
      },
    });
    return true;
  }

  // ───────────────────────────── envío con topes + presupuesto + corte ─────────────────────────────

  /**
   * Decide y ejecuta el ENVÍO de la confirmación tras las capas: corte C6/C1, tope por dominio, tope
   * por buzón, presupuesto C1. Cualquier capa que no pase ⇒ 0 envíos (silencioso). Emite las alertas
   * del presupuesto (50 % / corte) con su `AuditLog`.
   */
  private async maybeSendConfirmation(args: {
    kind: 'lead' | 'signup';
    rowId: string;
    email: string;
    mailboxHmac: string;
    domain: string;
    now: number;
    playerIdLast4?: string;
    signupToken?: boolean;
    game?: CardShowGame;
    playerId?: string;
    days?: CardShowDay[];
  }): Promise<void> {
    // Corte por webhooks (C6) o C1 al 100 % ⇒ fila PENDING retenida, 0 envíos.
    if (await this.webhook.isCut()) {
      await this.hold(args.kind, args.rowId, args.now);
      return;
    }

    if (!(await this.caps.reserveDomainSend(args.domain))) return; // tope por dominio
    const mboxOk = await this.caps.reserveUnconfirmedSend(args.mailboxHmac);
    if (!mboxOk) return; // tope por buzón (retenido sin correo)

    const b = await this.budget.tryReserve(args.now);
    if (b.crossed50) await this.alert('card_show.budget_50', { hour: b.hour, day: b.day });
    if (b.cut) await this.alert('card_show.budget_cut', { hour: b.hour, day: b.day });
    if (!b.allowed) {
      await this.hold(args.kind, args.rowId, args.now);
      if (b.failClosed) await this.alert('card_show.budget_fail_closed', {});
      return;
    }

    // Enlaces SOLO del dominio propio (confirmar / «No fui yo» / aviso). El one-click (RFC 8058) DEBE
    // llevar el token de un solo uso (propósito `unsubscribe`) en el QUERY, y ese token ata la FILA de
    // cada rama (lead ⇒ `args.rowId`; torneo ⇒ `first.id`), por eso se arma dentro de cada rama (DESV-CS-3).
    const base = this.publicBase();
    const privacyUrl = `${base}/privacidad`;

    if (args.kind === 'lead') {
      const confirmUrl = `${base}/card-show/confirm?token=${encodeURIComponent(this.tokens.issueLinkToken('lead', args.rowId, 'confirm', args.now))}`;
      const notMeUrl = `${base}/card-show/unsubscribe?token=${encodeURIComponent(this.tokens.issueLinkToken('lead', args.rowId, 'unsubscribe', args.now))}`;
      const unsubOneClick = `${base}/api/v1/card-show/unsubscribe-oneclick?token=${encodeURIComponent(this.tokens.issueLinkToken('lead', args.rowId, 'unsubscribe', args.now))}`;
      await this.mail.sendConfirmation({ to: args.email, kind: 'lead', confirmUrl, notMeUrl, unsubscribeOneClickUrl: unsubOneClick, privacyUrl });
      return;
    }

    // Torneo: un token de confirmación por buzón+(juego)+día del grupo recién creado (el POST confirma por
    // fila). ⭐M-84: se acota por `game` (y por `playerId` solo en el FORMAL; la LIGERA tiene playerId NULL).
    const rows = await this.prisma.cardShowPlayerSignup.findMany({
      where: {
        mailboxHmac: args.mailboxHmac,
        status: 'pending',
        ...(args.game ? { game: args.game } : {}),
        ...(args.game === CardShowGame.pokemon ? { playerId: args.playerId } : {}),
        ...(args.days ? { day: { in: args.days } } : {}),
      },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    const first = rows[0];
    if (!first) return;
    const confirmUrl = `${base}/card-show/confirm?token=${encodeURIComponent(this.tokens.issueLinkToken('signup', first.id, 'confirm', args.now))}`;
    const notMeUrl = `${base}/card-show/unsubscribe?token=${encodeURIComponent(this.tokens.issueLinkToken('signup', first.id, 'unsubscribe', args.now))}`;
    const unsubOneClick = `${base}/api/v1/card-show/unsubscribe-oneclick?token=${encodeURIComponent(this.tokens.issueLinkToken('signup', first.id, 'unsubscribe', args.now))}`;
    await this.mail.sendConfirmation({
      to: args.email,
      kind: 'signup',
      confirmUrl,
      notMeUrl,
      unsubscribeOneClickUrl: unsubOneClick,
      privacyUrl,
      playerIdLast4: args.playerIdLast4,
    });
  }

  private async hold(kind: 'lead' | 'signup', rowId: string, now: number): Promise<void> {
    if (kind === 'lead') {
      await this.prisma.cardShowLead.update({ where: { id: rowId }, data: { confirmationHeldAt: new Date(now) } }).catch(() => undefined);
    }
    // Torneo: la retención no resta cupo (el cupo se asigna al confirmar); la fila sigue PENDING.
  }

  private async alert(action: string, after: Record<string, unknown>): Promise<void> {
    await this.audit.log({ action, entityType: 'CardShow', after }).catch((e) => this.logger.error(`audit ${action}: ${e}`));
    // El correo de alerta a `CARD_SHOW_ALERT_EMAIL` lo manda el operador/monitor a partir del AuditLog;
    // en Fase 1 el hecho queda registrado (1 AuditLog por evento). Ver BACKEND_NOTES.
  }

  private publicBase(): string {
    const raw = (this.config.get<string>(ENV.PUBLIC_BASE_URL) ?? this.config.get<string>('APP_BASE_URL') ?? 'https://tcghunt.mx').trim();
    return raw.split(',')[0].replace(/\/+$/, '');
  }

  // ───────────────────────────── doble opt-in: cambios de estado (C4) ─────────────────────────────

  /**
   * Confirma (POST). Devuelve un resultado para el controlador: `ok` (nuevo estado), `already` (410),
   * `invalid` (400), `occupied` (torneo: el Player ID ya está preinscrito ese día).
   */
  async confirm(token: string, now: number = Date.now()): Promise<ConfirmResult> {
    const leadTry = this.tokens.verifyLinkToken(token, 'confirm', LINK_TTL_LEAD_MS, now);
    const parsed = leadTry.status === 'ok' ? leadTry : this.tokens.verifyLinkToken(token, 'confirm', LINK_TTL_SIGNUP_MS, now);
    if (parsed.status === 'invalid') throw BusinessException.badRequest('LINK_INVALID', 'invalid link');
    if (parsed.status === 'expired') throw new BusinessException('LINK_ALREADY_USED', HttpStatus.GONE, 'link expired');

    if (parsed.kind === 'lead') return this.confirmLead(parsed.id, now);
    return this.confirmSignup(parsed.id, now);
  }

  private async confirmLead(id: string, now: number): Promise<ConfirmResult> {
    const lead = await this.prisma.cardShowLead.findUnique({ where: { id } });
    if (!lead) throw new BusinessException('LINK_ALREADY_USED', HttpStatus.GONE, 'gone');
    if (lead.confirmedAt) throw new BusinessException('LINK_ALREADY_USED', HttpStatus.GONE, 'already confirmed'); // un solo uso

    // ⭐ Transición PENDING→`new` ATÓMICA y de un solo uso: `updateMany … where confirmedAt IS NULL`
    // ⇒ dos POST simultáneos del mismo token dan `count:1` en UNO solo. Ese UNO es el gatillo de la
    // bienvenida C3-W y del aviso interno ⇒ ambos se disparan EXACTAMENTE una vez (§CARDSHOW.6/.9); el
    // 2.º POST ve `count:0` ⇒ 410, 0 bienvenidas nuevas, 0 avisos nuevos.
    const res = await this.prisma.cardShowLead.updateMany({
      where: { id, confirmedAt: null },
      data: { confirmedAt: new Date(now), status: 'new', confirmationHeldAt: null },
    });
    if (res.count !== 1) throw new BusinessException('LINK_ALREADY_USED', HttpStatus.GONE, 'already confirmed');

    // ⭐ D1 (blindaje, techlead) — la fila YA quedó `new` (confirmación PERSISTIDA). La bienvenida y el
    // aviso interno son best-effort por DISEÑO (gates C1/C2/C6 pueden dejar 0 envíos sin tumbar nada);
    // sus gates leen Redis (`webhook.isCut`, `caps.reserve*`, `budget.tryReserve`), así que un parpadeo
    // de Redis AQUÍ ⛔ NUNCA debe convertir una confirmación ya guardada en un `500` que pierda el aviso.
    // Se envuelve TODO en try/catch que loguee y SIGA: la confirmación es el hecho que importa.
    try {
      // Bienvenida RICA (C3-W) a buzón YA confirmado: 1 sola vez, variante por tipo. Cuenta contra C1/C2.
      await this.sendWelcome(lead, now);

      // Para vendedor/patrocinador: 1 aviso interno (≤ 10/h), copy del dueño. (Además queda 1 AuditLog.)
      if (lead.type === 'merchant' || lead.type === 'sponsor') {
        if (await this.caps.reserveInternalNotice()) {
          await this.mail
            .sendInternalNotice({
              type: lead.type,
              name: lead.name, // ⭐M-84: nombre/MARCA real del lead (ya se persiste; ⛔ nunca `playerName`)
              phone: lead.phone, // ⭐M-84: teléfono real (obligatorio merchant/sponsor); correo INTERNO al staff
              email: lead.email,
              utmSource: lead.utmSource,
              utmMedium: lead.utmMedium,
              utmCampaign: lead.utmCampaign,
              createdAt: lead.createdAt,
              // IMP-2: ruta REAL del panel (localizada) + pestaña Leads. `/admin/card-show/leads` daba 404.
              adminLink: `${this.publicBase()}/es/admin/card-show?tab=leads`,
            })
            .catch((e) => this.logger.error(`aviso interno: ${e}`));
          await this.audit
            .log({ action: 'card_show.internal_notice', entityType: 'CardShowLead', entityId: id, after: { type: lead.type } })
            .catch(() => undefined);
        }
      }
    } catch (e) {
      // Un gate best-effort cayó (p. ej. Redis). La fila ya está `new`; se registra y se SIGUE.
      this.logger.error(`confirmLead post-persistencia (bienvenida/aviso best-effort): ${e}`);
    }
    return { outcome: 'ok', state: 'new' };
  }

  /**
   * Envía la BIENVENIDA C3-W (§CARDSHOW.9) a un lead recién confirmado. Gates: corte C6/C1, tope por
   * dominio, tope por buzón CONFIRMADO (4/24 h) y presupuesto C1 — «cuenta contra C1/C2 como cualquier
   * envío». Si algún gate no pasa ⇒ 0 bienvenidas (la fila ya quedó `new`; ⛔ no se retiene la bienvenida).
   */
  private async sendWelcome(
    lead: { id: string; type: CardShowLeadType; email: string; mailboxHmac: string },
    now: number,
  ): Promise<void> {
    if (await this.webhook.isCut()) return; // corte C6/C1 ⇒ 0 bienvenidas
    const domain = emailDomain(lead.email);
    if (!(await this.caps.reserveDomainSend(domain))) return; // tope por dominio (C2)
    if (!(await this.caps.reserveConfirmedSend(lead.mailboxHmac))) return; // tope por buzón confirmado (C2)

    const b = await this.budget.tryReserve(now); // presupuesto (C1)
    if (b.crossed50) await this.alert('card_show.budget_50', { hour: b.hour, day: b.day });
    if (b.cut) await this.alert('card_show.budget_cut', { hour: b.hour, day: b.day });
    if (!b.allowed) {
      if (b.failClosed) await this.alert('card_show.budget_fail_closed', {});
      return; // 0 bienvenidas (sin reenvío automático)
    }

    const base = this.publicBase();
    const unsubToken = this.tokens.issueLinkToken('lead', lead.id, 'unsubscribe', now);
    const unsubscribeOneClickUrl = `${base}/api/v1/card-show/unsubscribe-oneclick?token=${encodeURIComponent(unsubToken)}`;
    await this.mail
      .sendWelcome({ to: lead.email, type: lead.type, unsubscribeOneClickUrl, base })
      .catch((e) => this.logger.error(`bienvenida C3-W: ${e}`));
  }

  // ───────────────────────────── resumen diario de visitantes (interno, §CARDSHOW.9) ─────────────────────────────

  /**
   * Arma y envía el RESUMEN DIARIO de visitantes confirmados de un día (ventana `[from, to)`), con el
   * total acumulado. ⚠️ El DISPARO (un job repetible ~08:00 America/Mexico_City) ⛔ NO está cableado aquí:
   * el módulo Card Show no tiene scheduler propio. Devops lo engancha en la cola `tcg-daily` (S9) llamando
   * a este método una vez al día. Ver `BACKEND_NOTES §CARDSHOW` (punto para devops/QA). Reserva 1 cupo de
   * aviso interno (≤ 10/h) para no mezclarse con los avisos al staff.
   */
  async sendVisitorDailySummary(from: Date, to: Date): Promise<void> {
    const [nuevos, totalAcumulado] = await Promise.all([
      this.prisma.cardShowLead.findMany({
        where: { type: 'visitor', confirmedAt: { gte: from, lt: to } },
        orderBy: { confirmedAt: 'asc' },
        select: { email: true, utmSource: true },
      }),
      this.prisma.cardShowLead.count({ where: { type: 'visitor', confirmedAt: { not: null } } }),
    ]);
    if (!(await this.caps.reserveInternalNotice())) return; // ≤ 10/h
    await this.mail
      .sendVisitorDailySummary({
        date: from,
        nuevos: nuevos.map((v) => ({ name: null, email: v.email, utmSource: v.utmSource })),
        totalAcumulado,
      })
      .catch((e) => this.logger.error(`resumen diario: ${e}`));
  }

  // ───────────────────────────── ⭐M-84 resumen periódico (interno, §CARDSHOW.15) ─────────────────────────────

  /**
   * Medianoche de hoy en `America/Mexico_City` como instante UTC. Sin DST en CDMX desde 2023 ⇒ offset fijo
   * −6 h (DECIDIDO; si CDMX recupera DST habría que leer la zona). Base de la ventana «hoy».
   */
  private cdmxMidnight(now: number): number {
    const MX_OFFSET_MS = 6 * 60 * 60 * 1000;
    const shifted = new Date(now - MX_OFFSET_MS);
    shifted.setUTCHours(0, 0, 0, 0);
    return shifted.getTime() + MX_OFFSET_MS;
  }

  /**
   * ⭐M-84 (§CARDSHOW.15, ARCHITECTURE §4.CARDSHOW.q) — arma los CONTEOS agregados del resumen (hoy / 7 días /
   * total), SOLO sobre filas CONFIRMADAS (⛔ PENDING fuera), sin IP y ⛔ sin PII (solo cifras). Carga las filas
   * confirmadas una vez (volumen de un card show) y reparte por ventana en memoria. Expuesto para pruebas.
   */
  async buildLeadsSummaryData(now: number = Date.now()): Promise<LeadsSummaryParams> {
    const [leads, players] = await Promise.all([
      this.prisma.cardShowLead.findMany({
        where: { confirmedAt: { not: null } },
        select: { type: true, gameInterest: true, raffleOptIn: true, confirmedAt: true },
      }),
      this.prisma.cardShowPlayerSignup.findMany({
        where: { confirmedAt: { not: null } },
        select: { game: true, day: true, confirmedAt: true },
      }),
    ]);

    const todayStart = this.cdmxMidnight(now);
    const last7dStart = now - 7 * DAY_MS;
    const window = (start: number): SummaryWindowCounts => {
      const l = leads.filter((r) => (r.confirmedAt ? r.confirmedAt.getTime() >= start : false));
      const p = players.filter((r) => (r.confirmedAt ? r.confirmedAt.getTime() >= start : false));
      const leadsByType: Record<string, number> = {};
      const gameInterest: Record<string, number> = {};
      let raffleOptIns = 0;
      for (const r of l) {
        leadsByType[r.type] = (leadsByType[r.type] ?? 0) + 1;
        if (r.gameInterest) gameInterest[r.gameInterest] = (gameInterest[r.gameInterest] ?? 0) + 1;
        if (r.raffleOptIn) raffleOptIns += 1;
      }
      const playersByGame: Record<string, number> = {};
      const playersByDay: Record<string, number> = {};
      for (const r of p) {
        playersByGame[r.game] = (playersByGame[r.game] ?? 0) + 1;
        playersByDay[r.day] = (playersByDay[r.day] ?? 0) + 1;
      }
      return { leadsByType, gameInterest, raffleOptIns, playersByGame, playersByDay, leadsTotal: l.length, playersTotal: p.length };
    };

    const base = this.publicBase();
    return {
      generatedAt: new Date(now),
      today: window(todayStart),
      last7d: window(last7dStart),
      total: window(0),
      leadsCsvUrl: `${base}/admin/card-show/leads/export.csv`,
      playersCsvUrl: `${base}/admin/card-show/players/export.csv`,
    };
  }

  /**
   * ⭐M-84 — envía el resumen periódico interno. Reserva 1 cupo de aviso interno (≤ 10/h, §CARDSHOW.11) igual
   * que el resumen diario. ⚠️ El DISPARO (job programado) ⛔ NO vive aquí: lo cablea devops (ver BACKEND_NOTES
   * §CARDSHOW M-84 — cadencia sugerida diaria a hora fija America/Mexico_City). Entregable, ⛔ no gate.
   */
  async sendLeadsSummary(now: number = Date.now()): Promise<void> {
    const data = await this.buildLeadsSummaryData(now);
    if (!(await this.caps.reserveInternalNotice())) return; // ≤ 10/h
    await this.mail.sendLeadsSummary(data).catch((e) => this.logger.error(`resumen periódico: ${e}`));
  }

  /**
   * ⭐M-88 (§CARDSHOW.12) — Confirma una preinscripción del TORNEO recorriendo TODO el GRUPO del token.
   *
   * El alta «los dos días» crea 2 filas (`sat`+`sun`, ambas `pending`) y manda UN solo correo con el token
   * de `rows[0]`; confirmar ese correo debe confirmar AMBAS (antes de M-88, `sun` quedaba `pending` colgado
   * hasta caducar a 72 h — BLOQ-A / `D-CS-7`). Al recibir el token de UNA fila, derivamos la CLAVE DE GRUPO
   * y confirmamos todas sus `pending` en orden `createdAt`, dentro de la MISMA tx serializable (la reserva
   * de cupo por día sigue siendo atómica):
   *   - Clave FORMAL `(mailboxHmac, game=pokemon, playerId)`; LIGERA `(mailboxHmac, game)` con `playerId=NULL`.
   *   - FORMAL: cupo/waitlist POR DÍA; un día ya activo por OTRA fila/otro correo ⇒ «ya preinscrito» (0 cambios
   *     en ESE día) y los DEMÁS días del grupo SÍ se confirman.
   *   - LIGERA: todas las filas del grupo ⇒ `confirmed` directo (⛔ sin cupo/waitlist).
   *   - ⛔ Otro `playerId` o `game` distinto = OTRO grupo (TUTOR): su fila sigue retenida y recibe su propio
   *     correo; ⛔ no se auto-confirma (la clave de grupo no la alcanza).
   */
  private async confirmSignup(id: string, now: number): Promise<ConfirmResult> {
    const cap = this.tournamentCap();
    try {
      // `runSerializable` (reintenta el 40001, §serializable-retry): el cuerpo SOLO toca la BD ⇒ un
      // reintento no duplica efectos externos (⛔ el correo del torneo se manda al REGISTRAR, no aquí).
      return await runSerializable(
        this.prisma,
        async (tx) => {
          const row = await tx.cardShowPlayerSignup.findUnique({ where: { id } });
          if (!row) throw new BusinessException('LINK_ALREADY_USED', HttpStatus.GONE, 'gone');
          if (row.confirmedAt) throw new BusinessException('LINK_ALREADY_USED', HttpStatus.GONE, 'already confirmed');

          // Clave de GRUPO derivada de la fila del token (⛔ sin columna nueva — misma consulta que arma el
          // correo, `card-show.service.ts` `sendConfirmation`): FORMAL ata `playerId`; LIGERA lo deja NULL.
          const isFormal = row.game === CardShowGame.pokemon;
          const groupKey = isFormal
            ? { mailboxHmac: row.mailboxHmac, game: CardShowGame.pokemon, playerId: row.playerId }
            : { mailboxHmac: row.mailboxHmac, game: row.game, playerId: null };

          // TODAS las `pending` del grupo, en orden `createdAt` (incluye la fila del token: `confirmedAt` es
          // NULL por el guard de arriba). ⛔ Otro `playerId`/`game` queda fuera por la clave ⇒ no se toca.
          const groupRows = await tx.cardShowPlayerSignup.findMany({
            where: { ...groupKey, status: CardShowSignupStatus.pending },
            orderBy: { createdAt: 'asc' },
          });

          // Resultado por fila: estado nuevo si cambió, o `null` = «ya preinscrito ese día» (0 cambios).
          const results: { id: string; day: CardShowDay; state: CardShowSignupStatus | null }[] = [];
          for (const r of groupRows) {
            // ⭐M-84 LIGERA (game≠pokemon): ⛔ sin cupo, sin waitlist, sin índice — DIRECTO a `confirmed`.
            if (!isFormal) {
              await tx.cardShowPlayerSignup.update({ where: { id: r.id }, data: { confirmedAt: new Date(now), status: CardShowSignupStatus.confirmed } });
              results.push({ id: r.id, day: r.day, state: CardShowSignupStatus.confirmed });
              continue;
            }

            // FORMAL: ¿el Player ID ya está activo ESE día por OTRA fila (otro correo)? ⇒ «ya preinscrito», 0 cambios.
            const activeOther = await tx.cardShowPlayerSignup.findFirst({
              where: {
                id: { not: r.id },
                game: CardShowGame.pokemon,
                playerId: r.playerId,
                day: r.day,
                status: { in: ['confirmed', 'waitlist', 'checked_in'] },
              },
            });
            if (activeOther) {
              results.push({ id: r.id, day: r.day, state: null });
              continue;
            }

            const confirmedCount = await tx.cardShowPlayerSignup.count({
              where: { game: CardShowGame.pokemon, day: r.day, status: 'confirmed' },
            });
            const state = assignOnConfirm(confirmedCount, cap);
            await tx.cardShowPlayerSignup.update({ where: { id: r.id }, data: { confirmedAt: new Date(now), status: state } });
            results.push({ id: r.id, day: r.day, state });
          }

          // Nada cambió (todos los días ya activos por otras filas) ⇒ «ya preinscrito» (shape de hoy, sin `days`).
          const changed = results.filter((r): r is { id: string; day: CardShowDay; state: CardShowSignupStatus } => r.state !== null);
          if (changed.length === 0) return { outcome: 'occupied' as const };

          // `state` top-level = estado de la fila del TOKEN si cambió; si quedó «ya preinscrito», el del 1.º que sí cambió.
          const tokenResult = results.find((r) => r.id === id);
          const state = tokenResult && tokenResult.state !== null ? tokenResult.state : changed[0].state;
          // `days` es ADITIVO y SOLO viaja en la confirmación de GRUPO «los dos días» (groupRows > 1): el
          // frontend lo usa para nombrar sábado Y domingo. Un alta de UN solo día conserva el shape `{state}`
          // de hoy (⛔ no rompe C2/C3 ni al frontend que ya lo parsea).
          if (groupRows.length <= 1) return { outcome: 'ok' as const, state };
          return { outcome: 'ok' as const, state, days: changed.map((r) => ({ day: r.day, state: r.state })) };
        },
        { label: 'card-show.confirm-signup' },
      );
    } catch (e) {
      // P2002 = el índice único parcial atrapó una confirmación simultánea del mismo (playerId, day).
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return { outcome: 'occupied' };
      }
      throw e;
    }
  }

  /** Baja / «No fui yo» (POST). Para lead PENDING = suprime el buzón; confirmado = baja. */
  async unsubscribe(token: string, now: number = Date.now()): Promise<void> {
    const parsed = this.verifyAnyLink(token, 'unsubscribe', now);
    if (parsed.kind === 'lead') {
      const lead = await this.prisma.cardShowLead.findUnique({ where: { id: parsed.id } });
      if (!lead) return;
      const suppressUntil = this.suppressUntil();
      await this.prisma.cardShowLead.update({
        where: { id: parsed.id },
        data: { unsubscribedAt: new Date(now), suppressedUntil: suppressUntil, status: 'discarded' },
      });
    } else {
      await this.prisma.cardShowPlayerSignup.updateMany({
        where: { id: parsed.id, status: { in: ['pending', 'confirmed', 'waitlist'] } },
        data: { status: 'cancelled' },
      });
    }
  }

  /** Cancelar preinscripción (POST): el cupo restante sube 1 (la fila activa pasa a cancelled). */
  async cancel(token: string, now: number = Date.now()): Promise<void> {
    const parsed = this.verifyAnyLink(token, 'cancel', now);
    if (parsed.kind === 'signup') {
      await this.prisma.cardShowPlayerSignup.updateMany({
        where: { id: parsed.id, status: { in: ['pending', 'confirmed', 'waitlist'] } },
        data: { status: 'cancelled' },
      });
    } else {
      await this.prisma.cardShowLead.updateMany({ where: { id: parsed.id }, data: { unsubscribedAt: new Date(now), status: 'discarded' } });
    }
  }

  /** `POST /unsubscribe-oneclick` (RFC 8058): baja por `List-Unsubscribe-Post`. */
  async unsubscribeOneClick(token: string, now: number = Date.now()): Promise<void> {
    // Mismo efecto que `unsubscribe` pero el token puede venir del encabezado del correo; tolera ambos propósitos.
    const r = this.tokens.verifyLinkToken(token, 'unsubscribe', LINK_TTL_LEAD_MS, now);
    if (r.status !== 'ok') return; // one-click no delata: silencioso
    await this.unsubscribe(token, now);
  }

  private verifyAnyLink(token: string, purpose: LinkPurpose, now: number): { kind: 'lead' | 'signup'; id: string } {
    const asLead = this.tokens.verifyLinkToken(token, purpose, LINK_TTL_LEAD_MS, now);
    const parsed = asLead.status === 'ok' ? asLead : this.tokens.verifyLinkToken(token, purpose, LINK_TTL_SIGNUP_MS, now);
    if (parsed.status === 'invalid') throw BusinessException.badRequest('LINK_INVALID', 'invalid link');
    if (parsed.status === 'expired') throw new BusinessException('LINK_ALREADY_USED', HttpStatus.GONE, 'expired');
    return { kind: parsed.kind, id: parsed.id };
  }

  private suppressUntil(): Date | null {
    const raw = (this.config.get<string>(ENV.SUPPRESS_UNTIL) ?? '').trim();
    if (!raw) return new Date(Date.now() + 365 * 24 * 60 * 60 * 1000); // sin valor ⇒ fin de campaña lejano
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) : d;
  }

  private async isSuppressedOrUnsubscribed(mailboxHmac: string, now: number): Promise<boolean> {
    const row = await this.prisma.cardShowLead.findFirst({
      where: { mailboxHmac, OR: [{ suppressedUntil: { gt: new Date(now) } }, { unsubscribedAt: { not: null } }] },
      select: { id: true },
    });
    return !!row;
  }

  private async isSuppressedOrUnsubscribedSignup(mailboxHmac: string, now: number): Promise<boolean> {
    // La supresión vive en los leads (el buzón es el mismo); el torneo la respeta.
    return this.isSuppressedOrUnsubscribed(mailboxHmac, now);
  }

  // ───────────────────────────── contador de clics (§CARDSHOW.13) ─────────────────────────────

  async recordClick(destino: string, mesa?: number, utmSource?: string, utmContent?: string): Promise<void> {
    await this.prisma.cardShowClick.create({ data: { destino, mesa: mesa ?? null, utmSource: utmSource ?? null, utmContent: utmContent ?? null } });
  }

  // ───────────────────────────── webhook de Resend (C6) ─────────────────────────────

  async handleWebhook(type: string, svixId: string, now: number = Date.now()): Promise<void> {
    const { cutNow } = await this.webhook.handleEvent(type, svixId, now);
    if (cutNow) {
      await this.audit.log({ action: 'card_show.sending_cut', entityType: 'CardShow', after: { reason: type } }).catch(() => undefined);
    }
  }

  // ───────────────────────────── panel (super_admin, §CARDSHOW.15) ─────────────────────────────

  /**
   * Lista leads para el panel. ⛔ PENDING no aparece por defecto ni en los conteos: el filtro base
   * excluye `confirmedAt IS NULL` salvo que `?status=` lo pida EXPLÍCITAMENTE (y aun así `pending` no
   * es un estado por defecto). `q` busca por correo; `from`/`to` por `createdAt`.
   */
  async listLeads(params: { status?: string; type?: string; q?: string; from?: string; to?: string; page: number; pageSize: number }) {
    const where = this.leadWhere(params);
    const [data, total] = await Promise.all([
      this.prisma.cardShowLead.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
        // ⛔ sin IP (el modelo no la guarda). ⭐M-84: columnas nuevas (name/phone/gameInterest/raffle*/sellsWhat);
        // son PII ⇒ solo super_admin (ya el rol del controller). ⛔ `mesaInteres` @deprecated, NO se expone.
        select: {
          id: true,
          type: true,
          name: true,
          phone: true,
          email: true,
          gameInterest: true,
          raffleOptIn: true,
          raffleTermsVersion: true,
          sellsWhat: true,
          status: true,
          source: true,
          confirmedAt: true,
          unsubscribedAt: true,
          confirmationHeldAt: true,
          createdAt: true,
        },
      }),
      this.prisma.cardShowLead.count({ where }),
    ]);
    return { data, total, page: params.page, pageSize: params.pageSize };
  }

  async listPlayers(params: { status?: string; day?: string; game?: string; q?: string; from?: string; to?: string; page: number; pageSize: number }) {
    const where = this.playerWhere(params);
    const [data, total] = await Promise.all([
      this.prisma.cardShowPlayerSignup.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
        // ⭐M-84 + `game`; `playerId` viene NULL en las filas LIGERA.
        select: { id: true, game: true, day: true, playerName: true, playerId: true, email: true, isMinor: true, status: true, confirmedAt: true, createdAt: true },
      }),
      this.prisma.cardShowPlayerSignup.count({ where }),
    ]);
    return { data, total, page: params.page, pageSize: params.pageSize };
  }

  /** CSV de leads (panel). ⛔ PENDING fuera, ⛔ sin IP, anti-inyección de fórmulas. */
  async exportLeadsCsv(params: { status?: string; type?: string; q?: string; from?: string; to?: string }): Promise<string> {
    const rows = await this.prisma.cardShowLead.findMany({
      where: this.leadWhere(params),
      orderBy: { createdAt: 'desc' },
      // ⭐M-84 columnas nuevas (name/phone/gameInterest/raffle*/sellsWhat). ⛔ `mesaInteres` @deprecated, fuera.
      select: {
        type: true,
        name: true,
        phone: true,
        email: true,
        gameInterest: true,
        raffleOptIn: true,
        raffleTermsVersion: true,
        sellsWhat: true,
        status: true,
        source: true,
        confirmedAt: true,
        createdAt: true,
      },
    });
    const { csvDocument } = await import('./csv.util');
    return csvDocument(
      ['type', 'name', 'phone', 'email', 'gameInterest', 'raffleOptIn', 'raffleTermsVersion', 'sellsWhat', 'status', 'source', 'confirmedAt', 'createdAt'],
      rows.map((r) => [
        r.type,
        r.name,
        r.phone ?? '',
        r.email,
        r.gameInterest ?? '',
        String(r.raffleOptIn),
        r.raffleTermsVersion ?? '',
        r.sellsWhat ?? '',
        r.status,
        r.source,
        r.confirmedAt?.toISOString() ?? '',
        r.createdAt.toISOString(),
      ]),
    );
  }

  /**
   * CSV para el ORGANIZADOR del torneo (Jakomi): ÚNICO destino autorizado de `playerName`/`playerId`.
   * ⛔ PENDING fuera, ⛔ sin IP, anti-inyección de fórmulas.
   */
  async exportPlayersCsv(params: { status?: string; day?: string; game?: string; q?: string; from?: string; to?: string }): Promise<string> {
    const rows = await this.prisma.cardShowPlayerSignup.findMany({
      where: this.playerWhere(params),
      orderBy: [{ day: 'asc' }, { createdAt: 'asc' }],
      // ⭐M-84 + `game`; `playerId` viene VACÍO en las filas LIGERA (no lo tienen).
      select: { game: true, day: true, playerName: true, playerId: true, email: true, isMinor: true, status: true, confirmedAt: true },
    });
    const { csvDocument } = await import('./csv.util');
    return csvDocument(
      ['game', 'day', 'playerName', 'playerId', 'email', 'isMinor', 'status', 'confirmedAt'],
      rows.map((r) => [r.game, r.day, r.playerName, r.playerId ?? '', r.email, String(r.isMinor), r.status, r.confirmedAt?.toISOString() ?? '']),
    );
  }

  /** Libera un lead retenido por el presupuesto (reintenta el envío si hay presupuesto). Auditado. */
  async releaseLead(id: string, actorUserId: string, now: number = Date.now()): Promise<void> {
    const lead = await this.prisma.cardShowLead.findUnique({ where: { id } });
    if (!lead || !lead.confirmationHeldAt || lead.confirmedAt) throw BusinessException.notFound();
    await this.prisma.cardShowLead.update({ where: { id }, data: { confirmationHeldAt: null } });
    await this.audit.log({ actorUserId, action: 'card_show.release', entityType: 'CardShowLead', entityId: id });
    await this.maybeSendConfirmation({ kind: 'lead', rowId: id, email: lead.email, mailboxHmac: lead.mailboxHmac, domain: emailDomain(lead.email), now });
  }

  /** Reabre los envíos tras un corte C1/C6 (solo super_admin, auditado). */
  async reopenSending(actorUserId: string): Promise<void> {
    await this.webhook.reopen();
    await this.audit.log({ actorUserId, action: 'card_show.reopen_sending', entityType: 'CardShow' });
  }

  private leadWhere(p: { status?: string; type?: string; q?: string; from?: string; to?: string }): Prisma.CardShowLeadWhereInput {
    const where: Prisma.CardShowLeadWhereInput = {};
    // ⛔ PENDING nunca aparece por defecto NI por petición: `?status=pending` (y cualquier valor fuera
    // del subconjunto) ⇒ `400` (§0-Q punto 1: prohibido ignorar el filtro). Ausente/vacío ⇒ el default
    // «solo confirmados». Clase R: el panel acepta a propósito el enum MENOS `pending`.
    const status = parseEnumFilter('status', p.status, CARD_SHOW_LEAD_STATUS_FILTER_VALUES);
    if (status) where.status = status;
    else where.confirmedAt = { not: null };
    const type = parseEnumFilter('type', p.type, Object.values(CardShowLeadType));
    if (type) where.type = type;
    // ⭐v1.98 — M-86 (IMP-3, §CARDSHOW.15): `q` casa `name` OR `email` (`contains`, insensible a
    // mayúsculas, parametrizado). `name` cubre nombre y MARCA de vendedor/patrocinador. ⛔ No casa
    // `phone` ni `sellsWhat`. El `OR` se combina (AND) con `confirmedAt/status` de arriba ⇒ `q` SOLO
    // REDUCE el conjunto ya autorizado y ⛔ NUNCA trae PENDING.
    const qq = this.normalizeQ(p.q);
    if (qq) {
      where.OR = [
        { name: { contains: qq, mode: 'insensitive' } },
        { email: { contains: qq, mode: 'insensitive' } },
      ];
    }
    const range = this.dateRange(p.from, p.to);
    if (range) where.createdAt = range;
    return where;
  }

  private playerWhere(p: { status?: string; day?: string; game?: string; q?: string; from?: string; to?: string }): Prisma.CardShowPlayerSignupWhereInput {
    const where: Prisma.CardShowPlayerSignupWhereInput = {};
    const status = parseEnumFilter('status', p.status, CARD_SHOW_PLAYER_STATUS_FILTER_VALUES);
    if (status) where.status = status;
    else where.confirmedAt = { not: null };
    const day = parseEnumFilter('day', p.day, Object.values(CardShowDay));
    if (day) where.day = day;
    // ⭐M-84 filtro `?game=` (clase E, dominio entero; fuera de dominio ⇒ 400 {field, allowed}).
    const game = parseEnumFilter('game', p.game, CARD_SHOW_GAME_VALUES as CardShowGame[]);
    if (game) where.game = game;
    // ⭐v1.98 — M-86 (IMP-3, §CARDSHOW.15): `q` casa `playerName` OR `email` OR `playerId` (`contains`,
    // insensible a mayúsculas, parametrizado). `playerId` es string de dígitos (⛔ nullable: las filas
    // LIGERA sin `playerId` no casan por ese campo, sin romper). ⛔ No casa `phone` ni `sellsWhat`. El
    // `OR` se combina (AND) con `confirmedAt/status` ⇒ `q` SOLO REDUCE y ⛔ NUNCA trae PENDING.
    const qq = this.normalizeQ(p.q);
    if (qq) {
      where.OR = [
        { playerName: { contains: qq, mode: 'insensitive' } },
        { email: { contains: qq, mode: 'insensitive' } },
        { playerId: { contains: qq, mode: 'insensitive' } },
      ];
    }
    const range = this.dateRange(p.from, p.to);
    if (range) where.createdAt = range;
    return where;
  }

  /**
   * ⭐v1.98 — M-86 (§CARDSHOW.15): normaliza `q` con la gramática de §0 (igual que `/admin/shipments`):
   * `trim`, vacío ≡ ausente (⇒ `undefined`), ≤ 200 chars o `400 {field:'q'}`. ⛔ Exento de §0-Q (no es
   * enum transversal). No decide QUÉ campos cubre — eso lo hace cada `*Where`.
   */
  private normalizeQ(q?: string): string | undefined {
    const qq = (q ?? '').trim();
    if (qq.length > 200) {
      throw BusinessException.badRequest('VALIDATION_ERROR', 'q too long (max 200)', { field: 'q' });
    }
    return qq.length > 0 ? qq : undefined;
  }

  /**
   * Rango `[from, to]` sobre `createdAt`. §0-Q: una fecha MAL FORMADA ⇒ `400 {field}` (⛔ ya NO se
   * ignora en silencio — ignorarla devolvía una lista distinta de la pedida sin avisar). Ausente/vacío
   * (tras `trim()`) ⇒ no acota por esa punta.
   */
  private dateRange(from?: string, to?: string): { gte?: Date; lte?: Date } | undefined {
    const parse = (field: 'from' | 'to', raw?: string): Date | undefined => {
      if (raw === undefined || raw === null || raw.trim() === '') return undefined;
      const d = new Date(raw);
      if (Number.isNaN(d.getTime())) {
        throw BusinessException.badRequest('VALIDATION_ERROR', `invalid ${field} date`, { field });
      }
      return d;
    };
    const r: { gte?: Date; lte?: Date } = {};
    const gte = parse('from', from);
    const lte = parse('to', to);
    if (gte) r.gte = gte;
    if (lte) r.lte = lte;
    return r.gte || r.lte ? r : undefined;
  }
}

/**
 * Resultado de un `POST /card-show/confirm`.
 *
 * ⭐M-88 (§CARDSHOW.12): `days` es ADITIVO — presente solo en el torneo (confirmación de GRUPO «los dos
 * días»). Lista, en orden `createdAt`, el estado resultante de CADA fila del grupo que SÍ cambió
 * (confirmed/waitlist). ⛔ No incluye los días que quedaron «ya preinscrito» (0 cambios). El `state`
 * top-level se conserva (shape que el frontend ya parsea): es el estado de la fila del TOKEN, o —si esa
 * fila quedó «ya preinscrito»— el de la primera fila del grupo que sí cambió.
 */
export type ConfirmResult =
  | { outcome: 'ok'; state: 'new' | CardShowSignupStatus; days?: { day: CardShowDay; state: CardShowSignupStatus }[] }
  | { outcome: 'occupied' };
