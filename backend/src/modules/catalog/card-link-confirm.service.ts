import { HttpStatus, Injectable, Logger, Optional } from '@nestjs/common';
import { CardProductKind, Finish, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BusinessException } from '../../common/business.exception';
import { SettingsService } from '../settings/settings.service';
import { FxService } from '../pricing/fx.service';
import { patternClassifyEnabled } from '../pricing/pattern-dials';
import { TcgcsvCatalogClient, deriveCardProductsFromTcgcsv, type DerivedCardProduct } from '../pricing/providers/tcgcsv-singles.provider';
import { usdToMxnCents } from '../../common/money';
import { variantKey } from '../../common/variant-key';
import { safeErrorTag } from '../shipments/guest-mail-link';
import { CardProductResolverService, normalizeCardNumber } from './card-product-resolver.service';
import { CardLinkRepairService, LINK_REPAIR_GATE_NAMESPACE } from './card-link-repair.service';
import { planCardLinks } from './card-link-plan';
import { isTcgcsvOrigin } from './tcgcsv-card-name';
import { TcgcsvGroupsCache } from './tcgcsv-groups-cache';
import { AutoLinkPriceGate } from './auto-link-price-gate.service';

export const CARD_CONFIRM_COOLDOWN_MS = 60_000;
export const CARD_LIST_MAX = 50;
export const CARD_CANDIDATES_MAX = 5;
const CLAIM = 'catalog.card_confirm_claim';
const PAYLOAD_TTL_MS = 30 * 60_000;
const PAYLOAD_MAX_ENTRIES = 16;

export interface CardCandidate {
  productId: number;
  name: string;
  number: string | null;
  finishes: Finish[];
  /** Precio de mercado (MXN, centavos enteros) del primer acabado con precio; `null` si ninguno. */
  priceCents: number | null;
}
export interface CardToConfirm {
  cardId: string;
  name: string;
  number: string;
  reason: 'name_mismatch' | 'collision';
  candidates: CardCandidate[];
}

const isBaseLike = (k: CardProductKind): boolean => k === 'set_base' || k === 'other';

/**
 * §AUTO-ENLACE §9.4 — confirmación POR CARTA (sustituye la del set para `name_mismatch`/`collisions`). Sin schema nuevo: confirmar = crear el enlace
 * `CardProduct` de esa carta con el mismo escritor del plan; ese enlace ES la persistencia (el job es `onlyUnlinked` y nunca lo mueve).
 * Enlace + precios + bitácora van en UNA transacción (AE-10); candado por carta (`FOR UPDATE` + candado consultivo compartido con el job).
 */
@Injectable()
export class CardLinkConfirmService {
  private readonly logger = new Logger(CardLinkConfirmService.name);
  private readonly payloads = new Map<number, { at: number; derived: DerivedCardProduct[] }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly tcgcsv: TcgcsvCatalogClient,
    private readonly groupsCache: TcgcsvGroupsCache,
    private readonly resolver: CardProductResolverService,
    private readonly repair: CardLinkRepairService,
    private readonly fx: FxService,
    @Optional() private readonly gate?: AutoLinkPriceGate,
    @Optional() private readonly settings?: SettingsService,
  ) {}

  private upstream(e: unknown): BusinessException {
    this.logger.warn(`card-link-confirm: proveedor falló (${safeErrorTag(e)}).`);
    return BusinessException.retriable('UPSTREAM_ERROR', 'The price provider failed; try again later');
  }

  /** Productos del grupo (estructura + acabados) con caché corta: GET y POST comparten el mismo payload (≤ 2 llamadas por set y 30 min). */
  private async groupProducts(groupId: number): Promise<DerivedCardProduct[]> {
    const hit = this.payloads.get(groupId);
    if (hit && Date.now() - hit.at <= PAYLOAD_TTL_MS) return hit.derived;
    const [products, prices] = [await this.tcgcsv.getProducts(groupId), await this.tcgcsv.getPrices(groupId)];
    const derived = deriveCardProductsFromTcgcsv(products, prices, { variantEnabled: await patternClassifyEnabled(this.settings) });
    if (this.payloads.size >= PAYLOAD_MAX_ENTRIES) this.payloads.delete(this.payloads.keys().next().value as number);
    this.payloads.set(groupId, { at: Date.now(), derived });
    return derived;
  }

  /** Candidatos por carta SIN enlace que el plan NO liga solo (nombre/número en conflicto). Solo lectura local + payload del grupo. */
  private async compute(setId: string): Promise<{ items: CardToConfirm[]; derived: DerivedCardProduct[]; groupId: number | null; set: { id: string; externalId: string } }> {
    const set = await this.prisma.cardSet.findUnique({ where: { id: setId }, select: { id: true, externalId: true } });
    if (!set) throw BusinessException.notFound();
    const empty = { items: [], derived: [], groupId: null, set };
    if (isTcgcsvOrigin(set.externalId)) return empty;
    let groupId: number | null;
    let derived: DerivedCardProduct[];
    try {
      const groups = await this.groupsCache.get();
      groupId = (await this.resolver.describeGroup(setId, groups)).groupId;
      if (groupId == null) return empty;
      derived = await this.groupProducts(groupId);
    } catch (e) {
      throw this.upstream(e);
    }
    const [cards, owners] = await Promise.all([
      this.prisma.card.findMany({ where: { setId }, select: { id: true, number: true, name: true, tcgplayerId: true, _count: { select: { cardProducts: true } } } }),
      this.prisma.cardProduct.findMany({ where: { tcgplayerProductId: { in: derived.map((d) => d.productId) } }, select: { tcgplayerProductId: true, cardId: true } }),
    ]);
    const ownerOf = new Map(owners.map((o) => [o.tcgplayerProductId, o.cardId]));
    const plan = planCardLinks(
      derived.map((d) => ({ productId: d.productId, name: d.name, number: d.number, kind: d.kind })),
      cards.map((c) => ({ id: c.id, number: c.number, name: c.name, tcgplayerId: c.tcgplayerId, productCount: c._count.cardProducts })),
      ownerOf,
      normalizeCardNumber,
      { onlyUnlinked: true },
    );
    const autoLinkable = new Set([...plan.links.values()].map((l) => l.cardId));
    const unlinked = cards.filter((c) => c._count.cardProducts === 0 && !autoLinkable.has(c.id));
    const unlinkedByNumber = new Map<string, number>();
    for (const c of unlinked) unlinkedByNumber.set(normalizeCardNumber(c.number), (unlinkedByNumber.get(normalizeCardNumber(c.number)) ?? 0) + 1);
    const free = derived.filter((d) => isBaseLike(d.kind) && d.number != null && !ownerOf.has(d.productId) && !plan.links.has(d.productId));
    let fx: { rate: number; bufferPct: number } | null = null;
    try {
      fx = await this.fx.getCurrent();
    } catch {
      fx = null;
    }
    const items: CardToConfirm[] = [];
    for (const c of unlinked) {
      const n = normalizeCardNumber(c.number);
      const cands = free.filter((d) => normalizeCardNumber(d.number!) === n);
      if (cands.length === 0) continue;
      items.push({
        cardId: c.id, name: c.name, number: c.number,
        reason: cands.length > 1 || (unlinkedByNumber.get(n) ?? 0) > 1 ? 'collision' : 'name_mismatch',
        candidates: cands.slice(0, CARD_CANDIDATES_MAX).map((d) => {
          const usd = d.pricesByFinish.find((p) => p.marketPrice != null && p.marketPrice > 0)?.marketPrice ?? null;
          return {
            productId: d.productId, name: d.name, number: d.number, finishes: d.finishes,
            priceCents: usd != null && fx ? usdToMxnCents(Math.round(usd * 100), fx.rate, fx.bufferPct) : null,
          };
        }),
      });
    }
    items.sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }) || a.name.localeCompare(b.name));
    return { items, derived, groupId, set };
  }

  /** `GET /admin/catalog/link-exceptions/:setId/cards` (super_admin; ≤ 50). */
  async list(setId: string): Promise<{ setId: string; items: CardToConfirm[] }> {
    const { items } = await this.compute(setId);
    return { setId, items: items.slice(0, CARD_LIST_MAX) };
  }

  /** `POST …/:setId/cards/:cardId/confirm {productId}`. */
  async confirm(setId: string, cardId: string, productId: number, user: { id: string; role: Role }): Promise<{ cardId: string; productId: number; priced: number; alreadyConfirmed: boolean; held?: number }> {
    const card = await this.prisma.card.findUnique({ where: { id: cardId }, select: { id: true, setId: true, name: true, number: true } });
    if (!card || card.setId !== setId) throw BusinessException.notFound();
    // Idempotente: el mismo producto ya es de esta carta ⇒ 200 sin escribir (antes del límite y del proveedor).
    const already = await this.prisma.cardProduct.findUnique({ where: { tcgplayerProductId: productId }, select: { cardId: true } });
    if (already?.cardId === cardId) return { cardId, productId, priced: 0, alreadyConfirmed: true };
    if (already) throw BusinessException.conflict('PRODUCT_TAKEN', 'That product is already linked to another card', { cardId, productId });

    const { items, derived } = await this.compute(setId); // RE-CALCULA los candidatos de esa carta
    const mine = items.find((i) => i.cardId === cardId);
    const dp = derived.find((d) => d.productId === productId);
    if (!mine || !dp || !mine.candidates.some((c) => c.productId === productId)) {
      // La carta ya tiene otro enlace ⇒ carrera perdida (409); si no, el producto simplemente no es candidato (422).
      if ((await this.prisma.cardProduct.count({ where: { cardId } })) > 0) throw BusinessException.conflict('PRODUCT_TAKEN', 'This card was linked a moment ago', { cardId, productId });
      throw BusinessException.validation('PRODUCT_NOT_CANDIDATE', 'That product is not a candidate for this card', { cardId, productId });
    }

    // Candado de precios ANTES de escribir (lectura): lo retenido no se publica, el enlace sí.
    const fx = await this.fx.getCurrent().catch((e) => {
      throw this.upstream(e);
    });
    const mxnOf = (m: number | null): number => (m != null && m > 0 ? usdToMxnCents(Math.round(m * 100), fx.rate, fx.bufferPct) : 0);
    const priceable = dp.pricesByFinish.filter((p) => mxnOf(p.marketPrice) > 0);
    const verdicts = this.gate ? await this.gate.evaluate(priceable.map((p) => ({ cardId, finish: p.finish, candidateMxnCents: mxnOf(p.marketPrice) }))) : new Map();
    const heldVerdicts = [...verdicts.values()].filter((v) => v.held);
    const held = new Set<Finish>(heldVerdicts.map((v) => v.finish));
    void variantKey;

    let result: { cardProductId: string; priced: Finish[] } | null = null;
    let notWritten: 'taken' | 'cooldown' | 'already' | null = null;
    let waitMs = 0;
    try {
      result = await this.prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT "id" FROM "Card" WHERE "id" = ${cardId} FOR UPDATE`; // serializa por carta (AE-10)
          // 1 por carta cada 60 s (reclamo en la misma transacción: si algo falla, el cupo se devuelve solo).
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LINK_REPAIR_GATE_NAMESPACE}::int, hashtext(${'cardconfirm:' + cardId}))`;
          // Repetición idempotente (otra llamada ganó el candado antes): el mismo producto ya es de esta carta ⇒ no es un 429 ni una escritura.
          const owner = await tx.cardProduct.findUnique({ where: { tcgplayerProductId: productId }, select: { cardId: true } });
          if (owner?.cardId === cardId) {
            notWritten = 'already';
            return null;
          }
          const prev = await tx.auditLog.findFirst({ where: { action: CLAIM, entityId: cardId }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
          if (prev && Date.now() - prev.createdAt.getTime() < CARD_CONFIRM_COOLDOWN_MS) {
            waitMs = CARD_CONFIRM_COOLDOWN_MS - (Date.now() - prev.createdAt.getTime());
            notWritten = 'cooldown';
            return null;
          }
          const w = await this.resolver.writeConfirmedLink(tx, { cardId, dp, held, fx });
          if (!w) {
            notWritten = 'taken';
            return null;
          }
          await tx.auditLog.create({ data: { actorUserId: user.id, action: CLAIM, entityType: 'Card', entityId: cardId, after: { cardId, productId } } });
          await this.audit.log(
            { actorUserId: user.id, actorRole: user.role, action: 'catalog.card_link_confirmed', entityType: 'Card', entityId: cardId, before: null, after: { cardId, productId, setId, reason: mine.reason, before: null } },
            tx,
          );
          return w;
        },
        { timeout: 30_000, maxWait: 10_000 },
      );
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw BusinessException.conflict('PRODUCT_TAKEN', 'That product was linked a moment ago', { cardId, productId });
      throw e;
    }
    if (notWritten === 'cooldown') {
      throw new BusinessException('RATE_LIMITED', HttpStatus.TOO_MANY_REQUESTS, 'This card was confirmed a moment ago', { retryAfterSeconds: Math.max(1, Math.ceil(waitMs / 1000)) });
    }
    if (!result && notWritten === 'already') return { cardId, productId, priced: 0, alreadyConfirmed: true };
    if (!result) {
      // Otro ligó la carta o el producto entre medias: si fue ESTE mismo producto es una repetición idempotente.
      const now = await this.prisma.cardProduct.findUnique({ where: { tcgplayerProductId: productId }, select: { cardId: true } });
      if (now?.cardId === cardId) return { cardId, productId, priced: 0, alreadyConfirmed: true };
      throw BusinessException.conflict('PRODUCT_TAKEN', 'That product was linked a moment ago', { cardId, productId });
    }
    if (this.gate) {
      await this.gate.recordHeld(heldVerdicts);
      await this.gate.recordWritten(result.priced.map((finish) => ({ cardId, finish })));
    }
    await this.repair.correctInventoryFinish([cardId], 'card_confirm').catch((e) => this.logger.warn(`card-link-confirm: piezas de ${cardId} no corregidas (${safeErrorTag(e)}).`));
    return { cardId, productId, priced: result.priced.length, alreadyConfirmed: false, ...(held.size > 0 ? { held: held.size } : {}) };
  }
}
