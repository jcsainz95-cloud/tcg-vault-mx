/**
 * wishlist-notify.service.ts — rev v1.87⟨wishlist⟩ (API_CONTRACT §WSH.5, ARCHITECTURE §4.WSH (b)/(c)). El job
 * `wishlist-notify` (cada 5 min): el aviso sale del ESTADO, no de un evento.
 *
 *  0. Single-flight entre instancias: `pg_try_advisory_xact_lock(WISHLIST_NOTIFY_LOCK_KEY)` en una transacción que sostiene
 *     el candado durante toda la corrida y lo suelta al terminar (D-WSH-7; ⛔ no la bandera en memoria).
 *  1. Dial `off` ⇒ no-op con log.
 *  2. Detectar: piezas `wishlistPieceWhere ∧ listed` × `WishlistItem` sin fila para esa cuenta, SOLO las vendibles
 *     (`sellableByIds`) ⇒ `createMany(pending, skipDuplicates)`. El único `(userId, inventoryItemId)` es la deduplicación.
 *  3. Despachar por cuenta: inactiva/pausada/sin verificar ⇒ `skipped` (sin recuperación); pieza `reserved` (o `listed` sin
 *     precio) ⇒ espera; otro estado ⇒ `skipped/unavailable`; ventana de agrupado; tope diario por día de México; envío con
 *     CAS `pending → sent` y la foto del día (806/825) en UNA transacción, correo DESPUÉS del commit, sin reintento.
 *
 * ⛔ No escribe `InventoryItem`, `Order` ni Stripe (815).
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Locale, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { CatalogService } from '../catalog/catalog.service';
import { MAIL_PORT, MailPort } from '../mail/mail.port';
import { fits, maxDisplay, WishlistPct } from '../../common/wishlist-math';
import { dayMx } from '../spend-alerts/spend-alerts.service';
import { mxDayStart } from '../spend-alerts/mx-day';
import { readWishlistDials } from './wishlist-dials';
import { keyOf, WishlistMarketService } from './wishlist-market.service';
import { undetectedMatches } from './wishlist-pieces';
import { WishlistService } from './wishlist.service';
import { renderWishlistMail, WishlistMailLine } from './wishlist-mail';
import { WISHLIST_CLOCK, WISHLIST_NOTIFY_LOCK_KEY, WishlistClock, WishlistDials, WishlistSkipReason } from './wishlist.constants';

const JOB = 'wishlist-notify';
const PENDING_INCLUDE = {
  user: { select: { id: true, status: true, email: true, emailVerified: true, wishlistAlertsPausedAt: true, locale: true } },
  wishlistItem: { include: { card: { include: { set: true } } } },
  inventoryItem: { select: { status: true } },
} as const;
type PendingNotice = Prisma.WishlistNoticeGetPayload<{ include: typeof PENDING_INCLUDE }>;
/** Estados en los que una pieza detectada PUEDE volver a la venta: el aviso espera (810). */
const MAY_COME_BACK = new Set(['reserved', 'listed']);

export type WishlistNotifyResult =
  | { job: 'wishlist-notify'; enqueued: false; reason: 'WISHLIST_DISABLED' | 'ALREADY_RUNNING' }
  | { job: 'wishlist-notify'; enqueued: true; detected: number; sent: number; skipped: number; waiting: number };

@Injectable()
export class WishlistNotifyService {
  private readonly logger = new Logger(WishlistNotifyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly catalog: CatalogService,
    private readonly market: WishlistMarketService,
    private readonly wishlist: WishlistService,
    @Inject(MAIL_PORT) private readonly mail: MailPort,
    @Inject(WISHLIST_CLOCK) private readonly clock: WishlistClock,
  ) {}

  async run(): Promise<WishlistNotifyResult> {
    const dials = await readWishlistDials(this.settings);
    if (!dials.enabled) {
      this.logger.log(JSON.stringify({ job: JOB, enqueued: false, reason: 'WISHLIST_DISABLED' }));
      return { job: JOB, enqueued: false, reason: 'WISHLIST_DISABLED' };
    }
    const result = await this.prisma.$transaction(
      async (lockTx) => {
        const [{ locked }] = await lockTx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(${WISHLIST_NOTIFY_LOCK_KEY}) AS locked`;
        if (!locked) return null;
        return this.runLocked(dials);
      },
      { timeout: 10 * 60_000, maxWait: 10_000 },
    );
    if (!result) {
      this.logger.warn('wishlist-notify ya en curso en otra instancia; no se lanza otro (candado consultivo).');
      return { job: JOB, enqueued: false, reason: 'ALREADY_RUNNING' };
    }
    this.logger.log(JSON.stringify(result));
    return result;
  }

  private async runLocked(dials: WishlistDials): Promise<WishlistNotifyResult> {
    const now = this.clock.now();
    const detected = await this.detect(now);
    const { sent, skipped, waiting } = await this.dispatch(dials, now);
    return { job: JOB, enqueued: true, detected, sent, skipped, waiting };
  }

  /** Paso 2. */
  private async detect(now: Date): Promise<number> {
    const candidates = await undetectedMatches(this.prisma);
    if (candidates.length === 0) return 0;
    const sellable = new Set(
      (await this.catalog.sellableByIds(candidates.map((c) => c.inventoryItemId))).map((s) => s.inventoryItemId),
    );
    const rows = candidates.filter((c) => sellable.has(c.inventoryItemId));
    if (rows.length === 0) return 0;
    const r = await this.prisma.wishlistNotice.createMany({
      data: rows.map((c) => ({ ...c, status: 'pending' as const, detectedAt: now })),
      skipDuplicates: true,
    });
    return r.count;
  }

  private async skip(ids: string[], reason: WishlistSkipReason, now: Date): Promise<number> {
    if (ids.length === 0) return 0;
    const r = await this.prisma.wishlistNotice.updateMany({
      where: { id: { in: ids }, status: 'pending' },
      data: { status: 'skipped', skipReason: reason, resolvedAt: now },
    });
    return r.count;
  }

  /** Paso 3. */
  private async dispatch(dials: WishlistDials, now: Date): Promise<{ sent: number; skipped: number; waiting: number }> {
    const pending = await this.prisma.wishlistNotice.findMany({
      where: { status: 'pending' },
      include: PENDING_INCLUDE,
      orderBy: { detectedAt: 'asc' },
    });
    if (pending.length === 0) return { sent: 0, skipped: 0, waiting: 0 };
    let sent = 0;
    let skipped = 0;
    let waiting = 0;

    // Vendible AHORA (mismo seam del catálogo): P de hoy.
    const priceById = new Map(
      (await this.catalog.sellableByIds(pending.map((n) => n.inventoryItemId))).map((s) => [s.inventoryItemId, s.displayPriceCents]),
    );
    const byUser = new Map<string, PendingNotice[]>();
    for (const n of pending) byUser.set(n.userId, [...(byUser.get(n.userId) ?? []), n]);
    const windowMs = dials.mailWindowMin * 60_000;
    const dayStart = mxDayStart(dayMx(now));

    for (const [userId, notices] of byUser) {
      const user = notices[0].user;
      // 3a. La cuenta: ⛔ sin recuperación posterior («una vez por pieza»).
      const accountReason: WishlistSkipReason | null =
        user.status !== 'active' ? 'inactive' : user.wishlistAlertsPausedAt != null ? 'paused' : !user.emailVerified || !user.email ? 'unverified' : null;
      if (accountReason) {
        skipped += await this.skip(notices.map((n) => n.id), accountReason, now);
        continue;
      }
      // 3b. La pieza.
      const ready: PendingNotice[] = [];
      const gone: string[] = [];
      for (const n of notices) {
        if (priceById.has(n.inventoryItemId)) ready.push(n);
        else if (MAY_COME_BACK.has(n.inventoryItem.status)) waiting += 1;
        else gone.push(n.id);
      }
      skipped += await this.skip(gone, 'unavailable', now);
      if (ready.length === 0) continue;
      // 3c. Ventana: se espera mientras el más viejo sea posterior a now − ventana (811).
      const oldest = Math.min(...ready.map((n) => n.detectedAt.getTime()));
      if (oldest > now.getTime() - windowMs) {
        waiting += ready.length;
        continue;
      }
      // 3d. Tope diario por día de México.
      const today = await this.prisma.wishlistMail.count({ where: { userId, sentAt: { gte: dayStart } } });
      if (today >= dials.dailyMailCap) {
        waiting += ready.length;
        continue;
      }
      // 3e. Enviar.
      sent += await this.send(userId, user.email as string, user.locale, ready, priceById, dials, now);
    }
    return { sent, skipped, waiting };
  }

  private async send(
    userId: string,
    email: string,
    locale: Locale,
    notices: PendingNotice[],
    priceById: Map<string, number>,
    dials: WishlistDials,
    now: Date,
  ): Promise<number> {
    const iva = await this.market.ivaDials();
    // `M` DEL DÍA DEL ENVÍO (806).
    const market = await this.market.marketOf(notices.map((n) => ({ cardId: n.wishlistItem.cardId, finish: n.wishlistItem.finish })));
    const snap = notices.map((n) => {
      const M = market.get(keyOf(n.wishlistItem)) ?? null;
      const pct = n.wishlistItem.maxPct as WishlistPct;
      const P = priceById.get(n.inventoryItemId) as number;
      const max = M == null ? null : maxDisplay(M, pct, dials.ivaMode, iva);
      return { n, M, P, max, fits: fits(P, M, pct, dials.ivaMode, iva) };
    });

    const mailRow = await this.prisma.$transaction(async (tx) => {
      const mail = await tx.wishlistMail.create({ data: { userId, locale, itemCount: 0, sentAt: now } });
      const won: typeof snap = [];
      for (const s of snap) {
        // CAS `pending → sent` con la foto (806/825).
        const r = await tx.wishlistNotice.updateMany({
          where: { id: s.n.id, status: 'pending' },
          data: {
            status: 'sent',
            mailId: mail.id,
            priceDisplayCents: s.P,
            marketCents: s.M,
            maxDisplayCents: s.max,
            fits: s.fits,
            resolvedAt: now,
          },
        });
        if (r.count === 1) won.push(s);
      }
      if (won.length === 0) throw new NothingToSend();
      const itemIds = [...new Set(won.map((s) => s.n.wishlistItemId))];
      await tx.wishlistItem.updateMany({ where: { id: { in: itemIds } }, data: { lastNotifiedAt: now } });
      await tx.wishlistMail.update({ where: { id: mail.id }, data: { itemCount: itemIds.length } });
      return { mail, won };
    }).catch((e) => {
      if (e instanceof NothingToSend) return null;
      throw e;
    });
    if (!mailRow) return 0;

    // Una línea por deseo: el P más bajo y «N disponibles».
    const lines = new Map<string, WishlistMailLine>();
    for (const s of mailRow.won) {
      const wi = s.n.wishlistItem;
      const cur = lines.get(wi.id);
      if (cur) {
        cur.count += 1;
        if (s.P < cur.priceDisplayCents) {
          cur.priceDisplayCents = s.P;
          cur.fits = s.fits;
        }
        continue;
      }
      lines.set(wi.id, {
        wishlistItemId: wi.id,
        removeToken: this.wishlist.mailToken('remove', wi.id),
        cardId: wi.cardId,
        cardName: wi.card.name,
        setName: wi.card.set.name,
        number: wi.card.number,
        finish: wi.finish,
        imageSmallUrl: wi.card.imageSmallUrl,
        count: 1,
        priceDisplayCents: s.P,
        maxDisplayCents: s.max,
        fits: s.fits,
      });
    }
    const l = locale === 'en' ? 'en' : 'es';
    const msg = renderWishlistMail({
      locale: l,
      mailId: mailRow.mail.id,
      pauseToken: this.wishlist.mailToken('pause', mailRow.mail.id),
      lines: [...lines.values()],
    });
    try {
      await this.mail.send({ to: email, subject: msg.subject, text: msg.text, html: msg.html });
    } catch (e) {
      // ⛔ Sin reintento (a lo sumo una vez). ⛔ Sin el correo del destinatario en el log.
      this.logger.error(`wishlist-notify: el proveedor rechazó el correo ${mailRow.mail.id}: ${e instanceof Error ? e.message : String(e)}`);
      await this.prisma.wishlistMail.update({ where: { id: mailRow.mail.id }, data: { failedAt: this.clock.now() } });
    }
    return mailRow.won.length;
  }
}

class NothingToSend extends Error {}
