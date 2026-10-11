/**
 * wishlist.service.ts — rev v1.87⟨wishlist⟩ (API_CONTRACT §WSH.4, §WSH.5 «se quita sola al pagar», §WSH.6 enlaces).
 * Dueño de `WishlistItem`. ⛔ No escribe `InventoryItem`, `Order` ni Stripe (815; censo WSH-T15).
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Finish, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { SETTING_DEFAULTS, SETTING_VALIDATORS, SettingKey } from '../settings/settings.constants';
import { CatalogService } from '../catalog/catalog.service';
import { PiiCryptoService } from '../../common/crypto/pii-crypto.service';
import { BusinessException } from '../../common/business.exception';
import type { IvaDials } from '../../common/money';
import { fits, maxDisplay, WISHLIST_PCTS, WishlistIvaMode, WishlistPct } from '../../common/wishlist-math';
import { readWishlistDials } from './wishlist-dials';
import { keyOf, WishlistMarketService } from './wishlist-market.service';
import { listedPiecesFor, listedPiecesForKeys, SET_PRODUCT_PREDICATE } from './wishlist-pieces';
import { WISHLIST_CLOCK, WISHLIST_MAIL_DOMAIN, WishlistClock, WishlistDials } from './wishlist.constants';
import { CreateWishlistItemDto, WishlistMailActionDto } from './dto/wishlist.dto';

export interface WishlistActor {
  id: string;
  hasEmail?: boolean;
}

export type MaxTodayDTO = { status: 'priced'; maxDisplayCents: number; approximate: true } | { status: 'no_market' };

export interface WishlistItemDTO {
  id: string;
  card: { id: string; name: string; setName: string; number: string; imageSmallUrl: string | null };
  finish: Finish;
  maxPct: WishlistPct;
  maxToday: MaxTodayDTO;
  availableNow: { count: number; fromDisplayCents: number; fits: boolean | null } | null;
  lastNotifiedAt: string | null;
  createdAt: string;
}

export interface WishlistResponse {
  items: WishlistItemDTO[];
  count: number;
  limit: number;
  alertsPaused: boolean;
  emailVerified: boolean;
  ivaMode: WishlistIvaMode;
  ivaRatePct: number;
}

type ItemRow = Prisma.WishlistItemGetPayload<{ include: { card: { include: { set: true } } } }>;
const ITEM_INCLUDE = { card: { include: { set: true } } } as const;

@Injectable()
export class WishlistService {
  private readonly logger = new Logger(WishlistService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly catalog: CatalogService,
    private readonly market: WishlistMarketService,
    private readonly pii: PiiCryptoService,
    @Inject(WISHLIST_CLOCK) private readonly clock: WishlistClock,
  ) {}

  // ───────────────────────────────────────────── guardas ─────────────────────────────────────────────

  /** `404 FEATURE_DISABLED` con el dial apagado; `403 FORBIDDEN` a una cuenta de staff sin correo. Devuelve los diales. */
  private async gate(actor: WishlistActor): Promise<WishlistDials> {
    const dials = await readWishlistDials(this.settings);
    if (!dials.enabled) throw BusinessException.notFound('FEATURE_DISABLED', 'wishlist is disabled');
    if (actor.hasEmail === false) throw BusinessException.forbidden('FORBIDDEN', 'an account with email is required');
    return dials;
  }

  // ───────────────────────────────────────────── lectura ─────────────────────────────────────────────

  async list(actor: WishlistActor): Promise<WishlistResponse> {
    const dials = await this.gate(actor);
    const [items, user, iva] = await Promise.all([
      this.prisma.wishlistItem.findMany({ where: { userId: actor.id }, include: ITEM_INCLUDE, orderBy: { createdAt: 'desc' } }),
      this.prisma.user.findUniqueOrThrow({ where: { id: actor.id }, select: { wishlistAlertsPausedAt: true, emailVerified: true } }),
      this.market.ivaDials(),
    ]);
    const dtos = await this.toDTOs(items, dials, iva);
    return {
      items: dtos,
      count: items.length,
      limit: dials.maxPerAccount,
      alertsPaused: user.wishlistAlertsPausedAt != null,
      emailVerified: user.emailVerified,
      ivaMode: dials.ivaMode,
      ivaRatePct: iva.ivaRatePct,
    };
  }

  /** Q-WSH-UX-1 — los pesos de cada % ANTES de guardar. ⛔ 0 escrituras. Misma `maxDisplay` y misma lectura de `M`. */
  async preview(actor: WishlistActor, cardId: unknown) {
    if (typeof cardId !== 'string' || cardId.trim() === '') {
      throw BusinessException.badRequest('VALIDATION_ERROR', 'cardId is required', { field: 'cardId' });
    }
    const dials = await this.gate(actor);
    const card = await this.prisma.card.findUnique({ where: { id: cardId }, select: { id: true, availableFinishes: true } });
    if (!card) throw BusinessException.notFound();
    const iva = await this.market.ivaDials();
    const market = await this.market.marketOf(card.availableFinishes.map((finish) => ({ cardId: card.id, finish })));
    return {
      cardId: card.id,
      ivaMode: dials.ivaMode,
      ivaRatePct: iva.ivaRatePct,
      finishes: card.availableFinishes.map((finish) => {
        const M = market.get(keyOf({ cardId: card.id, finish })) ?? null;
        return {
          finish,
          maxToday:
            M == null
              ? { status: 'no_market' as const }
              : {
                  status: 'priced' as const,
                  approximate: true as const,
                  tiers: WISHLIST_PCTS.map((p) => ({ maxPct: p, maxDisplayCents: maxDisplay(M, p, dials.ivaMode, iva) })),
                },
        };
      }),
    };
  }

  private async toDTOs(items: ItemRow[], dials: WishlistDials, iva: IvaDials): Promise<WishlistItemDTO[]> {
    if (items.length === 0) return [];
    const keys = items.map((i) => ({ cardId: i.cardId, finish: i.finish }));
    const market = await this.market.marketOf(keys);
    const pieces = await listedPiecesForKeys(this.prisma, keys);
    const sellable = await this.catalog.sellableByIds(pieces.map((p) => p.id));
    const priceById = new Map(sellable.map((s) => [s.inventoryItemId, s.displayPriceCents]));
    const avail = new Map<string, { count: number; from: number }>();
    for (const p of pieces) {
      const P = priceById.get(p.id);
      if (P == null) continue;
      const k = keyOf(p);
      const cur = avail.get(k);
      avail.set(k, cur ? { count: cur.count + 1, from: Math.min(cur.from, P) } : { count: 1, from: P });
    }
    return items.map((i) => {
      const k = keyOf(i);
      const M = market.get(k) ?? null;
      const pct = i.maxPct as WishlistPct;
      const a = avail.get(k);
      return {
        id: i.id,
        card: { id: i.card.id, name: i.card.name, setName: i.card.set.name, number: i.card.number, imageSmallUrl: i.card.imageSmallUrl },
        finish: i.finish,
        maxPct: pct,
        maxToday: M == null ? { status: 'no_market' } : { status: 'priced', maxDisplayCents: maxDisplay(M, pct, dials.ivaMode, iva), approximate: true },
        availableNow: a ? { count: a.count, fromDisplayCents: a.from, fits: fits(a.from, M, pct, dials.ivaMode, iva) } : null,
        lastNotifiedAt: i.lastNotifiedAt ? i.lastNotifiedAt.toISOString() : null,
        createdAt: i.createdAt.toISOString(),
      };
    });
  }

  private async one(actor: WishlistActor, id: string, dials: WishlistDials): Promise<WishlistItemDTO> {
    const row = await this.prisma.wishlistItem.findFirst({ where: { id, userId: actor.id }, include: ITEM_INCLUDE });
    if (!row) throw BusinessException.notFound();
    const [dto] = await this.toDTOs([row], dials, await this.market.ivaDials());
    return dto;
  }

  // ───────────────────────────────────────────── escritura ─────────────────────────────────────────────

  /**
   * Alta (800–804, 812). En UNA transacción: `SELECT … FOR UPDATE` de la fila de la cuenta (dos altas simultáneas con 19
   * ⇒ exactamente una gana, 803), contar contra el dial leído en esa misma transacción, insertar (P2002 ⇒ 409, 804) y marcar
   * `suppressed` las piezas que YA están a la venta (812), para que la detección no las vea como nuevas.
   */
  async create(actor: WishlistActor, dto: CreateWishlistItemDto): Promise<WishlistItemDTO> {
    const dials = await this.gate(actor);
    const card = await this.prisma.card.findUnique({ where: { id: dto.cardId }, select: { id: true, availableFinishes: true } });
    if (!card) throw BusinessException.notFound();
    if (!card.availableFinishes.includes(dto.finish)) {
      throw BusinessException.validation('FINISH_NOT_AVAILABLE', 'finish not available for this card', {
        finish: dto.finish,
        availableFinishes: card.availableFinishes,
      });
    }
    // La vendibilidad la decide el catálogo FUERA de la tx (lee precios): lo que esté a la venta ahora se suprime.
    const listedNow = await listedPiecesFor(this.prisma, card.id, dto.finish);
    const sellableNow = (await this.catalog.sellableByIds(listedNow)).map((s) => s.inventoryItemId);
    const now = this.clock.now();
    let createdId: string;
    try {
      createdId = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${actor.id} FOR UPDATE`;
        const limit = (await readWishlistDialsTx(tx)).maxPerAccount ?? dials.maxPerAccount;
        const count = await tx.wishlistItem.count({ where: { userId: actor.id } });
        if (count >= limit) {
          throw BusinessException.validation('WISHLIST_LIMIT_REACHED', 'wishlist limit reached', { limit, count });
        }
        const item = await tx.wishlistItem.create({
          data: { userId: actor.id, cardId: card.id, finish: dto.finish, maxPct: dto.maxPct },
        });
        if (sellableNow.length > 0) {
          await tx.wishlistNotice.createMany({
            data: sellableNow.map((inventoryItemId) => ({
              wishlistItemId: item.id,
              userId: actor.id,
              inventoryItemId,
              status: 'suppressed' as const,
              detectedAt: now,
              resolvedAt: now,
            })),
            skipDuplicates: true,
          });
        }
        return item.id;
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const existing = await this.prisma.wishlistItem.findUnique({
          where: { userId_cardId_finish: { userId: actor.id, cardId: card.id, finish: dto.finish } },
          select: { id: true, maxPct: true },
        });
        throw BusinessException.conflict('WISHLIST_DUPLICATE', 'this card and finish is already on your wishlist', {
          wishlistItemId: existing?.id ?? null,
          maxPct: existing?.maxPct ?? null,
        });
      }
      throw e;
    }
    return this.one(actor, createdId, dials);
  }

  async update(actor: WishlistActor, id: string, maxPct: WishlistPct): Promise<WishlistItemDTO> {
    const dials = await this.gate(actor);
    const r = await this.prisma.wishlistItem.updateMany({ where: { id, userId: actor.id }, data: { maxPct } });
    if (r.count === 0) throw BusinessException.notFound(); // ⛔ no 403: no se confirma que exista (805)
    return this.one(actor, id, dials);
  }

  async remove(actor: WishlistActor, id: string): Promise<void> {
    await this.gate(actor);
    const r = await this.prisma.wishlistItem.deleteMany({ where: { id, userId: actor.id } });
    if (r.count === 0) throw BusinessException.notFound();
  }

  async setAlerts(actor: WishlistActor, paused: boolean): Promise<{ alertsPaused: boolean }> {
    await this.gate(actor);
    const u = await this.prisma.user.update({
      where: { id: actor.id },
      data: { wishlistAlertsPausedAt: paused ? this.clock.now() : null },
      select: { wishlistAlertsPausedAt: true },
    });
    return { alertsPaused: u.wishlistAlertsPausedAt != null };
  }

  // ───────────────────────────────────────── enlaces del correo ─────────────────────────────────────────

  /** `token = domainHmac('wsh-mail:v1:', `${action}:${id}`)` — misma llave del índice ciego, prefijo de dominio. */
  mailToken(action: 'remove' | 'pause', id: string): string {
    return this.pii.domainHmac(WISHLIST_MAIL_DOMAIN, `${action}:${id}`);
  }

  /**
   * `POST /wishlist/mail-actions` (814). ⛔ NO depende del dial (Q-WSH-UX-5): quitar una carta o pausar los avisos debe
   * poder hacerse siempre. Token que no cuadra (comparación en tiempo constante) ⇒ `404 WISHLIST_LINK_INVALID`, sin decir
   * por qué. Idempotente: repetir ⇒ `already_done`.
   */
  async mailAction(dto: WishlistMailActionDto): Promise<{ result: 'removed' | 'paused' | 'already_done' }> {
    const expected = this.mailToken(dto.action, dto.id);
    if (!this.pii.blindIndexEquals(expected, dto.token)) {
      throw BusinessException.notFound('WISHLIST_LINK_INVALID', 'invalid link');
    }
    if (dto.action === 'remove') {
      const r = await this.prisma.wishlistItem.deleteMany({ where: { id: dto.id } });
      return { result: r.count > 0 ? 'removed' : 'already_done' };
    }
    const mail = await this.prisma.wishlistMail.findUnique({ where: { id: dto.id }, select: { userId: true } });
    if (!mail) throw BusinessException.notFound('WISHLIST_LINK_INVALID', 'invalid link');
    const r = await this.prisma.user.updateMany({
      where: { id: mail.userId, wishlistAlertsPausedAt: null },
      data: { wishlistAlertsPausedAt: this.clock.now() },
    });
    return { result: r.count > 0 ? 'paused' : 'already_done' };
  }

  // ───────────────────────────────────────── se quita sola al pagar ─────────────────────────────────────────

  /**
   * 816 — tras el commit de las DOS liquidaciones (bóveda y envío directo), best-effort en el llamador. Borra los deseos de
   * `order.userId` cuyo (carta, acabado) coincide con alguna pieza del pedido que cumple la parte «producto de set» del
   * predicado del aviso (`SET_PRODUCT_PREDICATE`, ⭐ v1.87.3 M-1): la promo o el exclusivo de deck de la misma carta y acabado
   * NO quitan el deseo (no lo habrían avisado). ⛔ Sin `status`/`ownerType`/vendibilidad: la pieza ya está pagada.
   * Idempotente; invitado ⇒ nada. ⛔ Solo LEE el pedido y sus piezas.
   */
  async consumeForSettledOrder(orderId: string): Promise<number> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, select: { userId: true } });
    if (!order?.userId) return 0;
    const pairs = await this.prisma.$queryRaw<{ cardId: string; finish: Finish }[]>(Prisma.sql`
      SELECT DISTINCT ii."cardId", ii."finish"::text AS "finish"
      FROM "OrderItem" oi
      JOIN "InventoryItem" ii ON ii."id" = oi."inventoryItemId"
      LEFT JOIN "CardProduct" cp ON cp."tcgplayerProductId" = ii."cardProductId"
      WHERE oi."orderId" = ${orderId} AND ${SET_PRODUCT_PREDICATE}`);
    if (pairs.length === 0) return 0;
    const r = await this.prisma.wishlistItem.deleteMany({
      where: { userId: order.userId, OR: pairs.map((p) => ({ cardId: p.cardId, finish: p.finish })) },
    });
    if (r.count > 0) this.logger.log(`wishlist: ${r.count} deseo(s) cumplidos por el pedido ${orderId}.`);
    return r.count;
  }
}

/** El tope leído DENTRO de la transacción del alta (§WSH.4: «el tope se lee del dial en esa transacción»). */
async function readWishlistDialsTx(tx: Prisma.TransactionClient): Promise<{ maxPerAccount: number | null }> {
  const row = await tx.configSetting.findUnique({ where: { key: SettingKey.WISHLIST_MAX_PER_ACCOUNT } });
  const v = row ? row.valueJson : SETTING_DEFAULTS[SettingKey.WISHLIST_MAX_PER_ACCOUNT];
  return { maxPerAccount: SETTING_VALIDATORS[SettingKey.WISHLIST_MAX_PER_ACCOUNT](v) === null ? (v as number) : null };
}
