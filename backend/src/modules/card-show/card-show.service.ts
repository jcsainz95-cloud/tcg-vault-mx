import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CardShowDay, CardShowLeadType, CardShowSignupStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PiiCryptoService } from '../../common/crypto/pii-crypto.service';
import { BusinessException } from '../../common/business.exception';
import { AuditService } from '../audit/audit.service';
import { CardShowTokensService } from './card-show-tokens.service';
import { CardShowBudgetService } from './card-show-budget.service';
import { CardShowMailboxCapsService } from './card-show-mailbox-caps.service';
import { CardShowMailService } from './card-show-mail.service';
import { CardShowWebhookService } from './card-show-webhook.service';
import { CreateLeadDto, CreatePlayerDto } from './dto/card-show.dto';
import { assignOnConfirm, playerIdLast4 } from './tournament.util';
import { canonicalizeMailbox, emailDomain, normalizeEmail } from './mailbox.util';
import { runSerializable } from '../../common/serializable-retry';
import {
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

  // ───────────────────────────── «Avísame» (lead) ─────────────────────────────

  async createLead(dto: CreateLeadDto, now: number = Date.now()): Promise<void> {
    if (dto.website && dto.website.trim() !== '') return; // honeypot ⇒ silencioso

    const ft = this.tokens.verifyFormToken(dto.formToken, 'leads', now);
    if (ft.status === 'invalid') throw BusinessException.badRequest('VALIDATION_ERROR', 'invalid form token', { field: 'formToken' });
    if (ft.status === 'expired') throw BusinessException.badRequest('FORM_EXPIRED', 'form token expired');
    if (ft.status === 'too_fast') return; // < 2 s ⇒ silencioso

    const email = normalizeEmail(dto.email);
    const mailboxHmac = this.mailboxHmac(email);
    const domain = emailDomain(email);

    // Buzón suprimido («No fui yo») o dado de baja ⇒ 0 envíos / 0 fila nueva, respuesta idéntica.
    if (await this.isSuppressedOrUnsubscribed(mailboxHmac, now)) return;

    // Dominio sin MX ni A ⇒ 0 envío / 0 fila / 200 idéntico.
    if (!(await this.mail.domainCanReceive(email))) return;

    const type = dto.type as Prisma.CardShowLeadCreateInput['type'];
    const existing = await this.prisma.cardShowLead.findUnique({ where: { email_type: { email, type } } });

    // Ya confirmado ⇒ no hay nada que confirmar; re-alta dentro de 24 h ⇒ 0 envíos.
    if (existing?.confirmedAt) return;

    const lead =
      existing ??
      (await this.prisma.cardShowLead.create({
        data: {
          type,
          email,
          mailboxHmac,
          consentAt: new Date(now),
          privacyVersion: this.privacyVersion(),
          source: dto.source as Prisma.CardShowLeadCreateInput['source'],
          utmSource: dto.utmSource,
          utmMedium: dto.utmMedium,
          utmCampaign: dto.utmCampaign,
          utmContent: dto.utmContent,
          referrerHost: dto.referrerHost,
          mesaInteres: dto.mesaInteres,
        },
      }));

    await this.maybeSendConfirmation({ kind: 'lead', rowId: lead.id, email, mailboxHmac, domain, now });
  }

  // ───────────────────────────── preinscripción al torneo ─────────────────────────────

  async createPlayer(dto: CreatePlayerDto, now: number = Date.now()): Promise<void> {
    if (dto.website && dto.website.trim() !== '') return; // honeypot

    const ft = this.tokens.verifyFormToken(dto.formToken, 'players', now);
    if (ft.status === 'invalid') throw BusinessException.badRequest('VALIDATION_ERROR', 'invalid form token', { field: 'formToken' });
    if (ft.status === 'expired') throw BusinessException.badRequest('FORM_EXPIRED', 'form token expired');
    if (ft.status === 'too_fast') return;

    // Menor sin consentimiento del tutor ⇒ error de campo (⛔ no silencioso, §CARDSHOW.12).
    if (dto.isMinor && dto.guardianConsent !== true) {
      throw BusinessException.badRequest('VALIDATION_ERROR', 'guardian consent required for a minor', { field: 'guardianConsent' });
    }

    const email = normalizeEmail(dto.email);
    const mailboxHmac = this.mailboxHmac(email);
    const domain = emailDomain(email);
    const days: CardShowDay[] = dto.day === 'both' ? [CardShowDay.sat, CardShowDay.sun] : [dto.day as CardShowDay];

    if (await this.isSuppressedOrUnsubscribedSignup(mailboxHmac, now)) return;
    if (!(await this.mail.domainCanReceive(email))) return;

    // «los dos» ⇒ 2 filas pero 1 envío (un correo cubre la preinscripción de ese buzón).
    let anyNewPending = false;
    for (const day of days) {
      const created = await this.insertPendingSignup(dto, email, mailboxHmac, day, now);
      if (created) anyNewPending = true;
    }
    if (!anyNewPending) return; // nada nuevo (duplicado exacto / topes) ⇒ 0 envíos

    await this.maybeSendConfirmation({
      kind: 'signup',
      rowId: `${mailboxHmac}`, // el token de confirmación del torneo se emite por fila al confirmar; aquí solo cuenta el envío
      email,
      mailboxHmac,
      domain,
      now,
      playerIdLast4: playerIdLast4(dto.playerId),
      signupToken: true,
      playerId: dto.playerId,
      days,
    });
  }

  /**
   * Inserta una fila PENDING de preinscripción, respetando los topes de contención: máx 4 playerId por
   * buzón y día; máx 3 PENDING por playerId; duplicado exacto (correo+playerId+día) ⇒ no crea otra.
   * Devuelve `true` si creó una fila nueva. ⛔ Una alta NUEVA es INSERT, nunca `upsert` sobre una activa.
   */
  private async insertPendingSignup(
    dto: CreatePlayerDto,
    email: string,
    mailboxHmac: string,
    day: CardShowDay,
    now: number,
  ): Promise<boolean> {
    // Duplicado exacto (mismo correo+playerId+día, aún vivo) ⇒ 1 fila, no crea otra.
    const dup = await this.prisma.cardShowPlayerSignup.findFirst({
      where: { email, playerId: dto.playerId, day, status: { in: ['pending', 'confirmed', 'waitlist', 'checked_in'] } },
    });
    if (dup) return false;

    // Máx 3 PENDING por playerId (la 4.ª ⇒ 0 filas).
    const pendingForPlayer = await this.prisma.cardShowPlayerSignup.count({
      where: { playerId: dto.playerId, day, status: 'pending' },
    });
    if (pendingForPlayer >= TOURNAMENT.MAX_PENDING_PER_PLAYER) return false;

    // Máx 4 playerId por buzón y día (el 5.º ⇒ 0 filas).
    if (!(await this.caps.reservePlayerPerMailboxDay(mailboxHmac, day))) return false;

    await this.prisma.cardShowPlayerSignup.create({
      data: {
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

    // Torneo: un token de confirmación por buzón+día del grupo recién creado (el POST confirma por fila).
    const rows = await this.prisma.cardShowPlayerSignup.findMany({
      where: { mailboxHmac: args.mailboxHmac, playerId: args.playerId, status: 'pending', ...(args.days ? { day: { in: args.days } } : {}) },
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

    // Bienvenida RICA (C3-W) a buzón YA confirmado: 1 sola vez, variante por tipo. Cuenta contra C1/C2.
    await this.sendWelcome(lead, now);

    // Para vendedor/patrocinador: 1 aviso interno (≤ 10/h), copy del dueño. (Además queda 1 AuditLog.)
    if (lead.type === 'merchant' || lead.type === 'sponsor') {
      if (await this.caps.reserveInternalNotice()) {
        await this.mail
          .sendInternalNotice({
            type: lead.type,
            name: null, // los leads no persisten nombre (⛔ nunca `playerName`) ⇒ «—»
            email: lead.email,
            utmSource: lead.utmSource,
            utmMedium: lead.utmMedium,
            utmCampaign: lead.utmCampaign,
            createdAt: lead.createdAt,
            adminLink: `${this.publicBase()}/admin/card-show/leads`,
          })
          .catch((e) => this.logger.error(`aviso interno: ${e}`));
        await this.audit
          .log({ action: 'card_show.internal_notice', entityType: 'CardShowLead', entityId: id, after: { type: lead.type } })
          .catch(() => undefined);
      }
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

  /** Confirma una preinscripción asignando cupo AL CONFIRMAR, por orden, con reserva atómica (L0-SEG-02). */
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

          // ¿El Player ID ya está activo ese día por OTRA fila? ⇒ página «ya preinscrito», 0 cambios.
          const activeOther = await tx.cardShowPlayerSignup.findFirst({
            where: {
              id: { not: id },
              playerId: row.playerId,
              day: row.day,
              status: { in: ['confirmed', 'waitlist', 'checked_in'] },
            },
          });
          if (activeOther) return { outcome: 'occupied' as const };

          const confirmedCount = await tx.cardShowPlayerSignup.count({
            where: { day: row.day, status: 'confirmed' },
          });
          const state = assignOnConfirm(confirmedCount, cap);
          await tx.cardShowPlayerSignup.update({ where: { id }, data: { confirmedAt: new Date(now), status: state } });
          return { outcome: 'ok' as const, state };
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

  async handleWebhook(type: string, now: number = Date.now()): Promise<void> {
    const { cutNow } = await this.webhook.handleEvent(type, now);
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
        // ⛔ sin IP (el modelo no la guarda); el correo es el único PII del lead.
        select: { id: true, type: true, email: true, status: true, source: true, confirmedAt: true, unsubscribedAt: true, confirmationHeldAt: true, createdAt: true },
      }),
      this.prisma.cardShowLead.count({ where }),
    ]);
    return { data, total, page: params.page, pageSize: params.pageSize };
  }

  async listPlayers(params: { status?: string; day?: string; q?: string; from?: string; to?: string; page: number; pageSize: number }) {
    const where = this.playerWhere(params);
    const [data, total] = await Promise.all([
      this.prisma.cardShowPlayerSignup.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
        select: { id: true, day: true, playerName: true, playerId: true, email: true, isMinor: true, status: true, confirmedAt: true, createdAt: true },
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
      select: { type: true, email: true, status: true, source: true, confirmedAt: true, createdAt: true },
    });
    const { csvDocument } = await import('./csv.util');
    return csvDocument(
      ['type', 'email', 'status', 'source', 'confirmedAt', 'createdAt'],
      rows.map((r) => [r.type, r.email, r.status, r.source, r.confirmedAt?.toISOString() ?? '', r.createdAt.toISOString()]),
    );
  }

  /**
   * CSV para el ORGANIZADOR del torneo (Jakomi): ÚNICO destino autorizado de `playerName`/`playerId`.
   * ⛔ PENDING fuera, ⛔ sin IP, anti-inyección de fórmulas.
   */
  async exportPlayersCsv(params: { status?: string; day?: string; q?: string; from?: string; to?: string }): Promise<string> {
    const rows = await this.prisma.cardShowPlayerSignup.findMany({
      where: this.playerWhere(params),
      orderBy: [{ day: 'asc' }, { createdAt: 'asc' }],
      select: { day: true, playerName: true, playerId: true, email: true, isMinor: true, status: true, confirmedAt: true },
    });
    const { csvDocument } = await import('./csv.util');
    return csvDocument(
      ['day', 'playerName', 'playerId', 'email', 'isMinor', 'status', 'confirmedAt'],
      rows.map((r) => [r.day, r.playerName, r.playerId, r.email, String(r.isMinor), r.status, r.confirmedAt?.toISOString() ?? '']),
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
    // ⛔ PENDING nunca aparece por defecto: solo confirmados (o el estado EXPLÍCITO que no sea pending).
    if (p.status && p.status !== 'pending' && (['new', 'contacted', 'closed', 'discarded'] as string[]).includes(p.status)) {
      where.status = p.status as Prisma.CardShowLeadWhereInput['status'];
    } else {
      where.confirmedAt = { not: null };
    }
    if (p.type && (['merchant', 'sponsor', 'visitor'] as string[]).includes(p.type)) where.type = p.type as Prisma.CardShowLeadWhereInput['type'];
    if (p.q) where.email = { contains: p.q.toLowerCase() };
    const range = this.dateRange(p.from, p.to);
    if (range) where.createdAt = range;
    return where;
  }

  private playerWhere(p: { status?: string; day?: string; q?: string; from?: string; to?: string }): Prisma.CardShowPlayerSignupWhereInput {
    const where: Prisma.CardShowPlayerSignupWhereInput = {};
    if (p.status && p.status !== 'pending' && (['confirmed', 'waitlist', 'cancelled', 'checked_in'] as string[]).includes(p.status)) {
      where.status = p.status as Prisma.CardShowPlayerSignupWhereInput['status'];
    } else {
      where.confirmedAt = { not: null };
    }
    if (p.day && (['sat', 'sun'] as string[]).includes(p.day)) where.day = p.day as Prisma.CardShowPlayerSignupWhereInput['day'];
    if (p.q) where.email = { contains: p.q.toLowerCase() };
    const range = this.dateRange(p.from, p.to);
    if (range) where.createdAt = range;
    return where;
  }

  private dateRange(from?: string, to?: string): { gte?: Date; lte?: Date } | undefined {
    const r: { gte?: Date; lte?: Date } = {};
    if (from) {
      const d = new Date(from);
      if (!Number.isNaN(d.getTime())) r.gte = d;
    }
    if (to) {
      const d = new Date(to);
      if (!Number.isNaN(d.getTime())) r.lte = d;
    }
    return r.gte || r.lte ? r : undefined;
  }
}

export type ConfirmResult =
  | { outcome: 'ok'; state: 'new' | CardShowSignupStatus }
  | { outcome: 'occupied' };
