import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Finish, StampType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/business.exception';
import { ErrorCode } from '../../common/error-codes';
import { normalizeMatchText } from '../../common/card-version';
import { deriveNumberParts } from '../../common/card-order';
import { normalizeRarity } from '../../common/rarity-catalog';
import { TcgcsvCatalogClient } from '../pricing/providers/tcgcsv-singles.provider';
import { matchTcgcsvGroupByName } from '../pricing/providers/tcgcsv-group-match';
import {
  TcgcsvCardProductRef,
  TcgcsvGroupRef,
  TcgcsvPriceRow,
  deriveStructuralFinishes,
  tcgcsvSubTypeToFinish,
} from '../pricing/pricing.types';
import { PricingService } from '../pricing/pricing.service';
import { FxService } from '../pricing/fx.service';
import { sanitizeSealedImageUrl, upgradeSealedImageUrl } from '../inventory/sealed-image-host';
import { FinishReconciler } from './finish-reconciler.service';
import { PokemonTcgIoClient } from './pokemontcg-io.client';
import { normalizeCardNumber } from './card-product-resolver.service';
import {
  TcgcsvSkipReason,
  isTcgcsvOrigin,
  parseTcgcsvCardName,
  tcgcsvCardExternalId,
  tcgcsvSetExternalId,
} from './tcgcsv-card-name';

/** Mismo tope de cordura que el barrido diario (tcgcsv-singles-bulk.provider.ts): un `market` mayor es dato corrupto. */
const MAX_SANE_MARKET_USD = 50_000;
/** Espacio del candado consultivo por grupo (`pg_advisory_xact_lock(ns, groupId)`): 2 clics ⇒ se serializan. */
const TCGCSV_IMPORT_LOCK_NAMESPACE = 5120;

export interface TcgcsvGroupRow {
  groupId: number;
  name: string;
  publishedOn: string | null;
  imported: boolean;
  cardCount: number;
}

export interface TcgcsvImportResult {
  /** `CardSet.id` interno (el que usan `/admin/inventory/master-sets/:setId` y el binder). */
  setId: string;
  created: number;
  updated: number;
  stamped: number;
  noPrice: number;
  skipped: { productId: number; name: string; reason: TcgcsvSkipReason }[];
}

/**
 * TcgcsvSetImportService (P-PROMOS opción C · ARCHITECTURE §5.12) — crea el set y sus cartas desde un grupo de TCGCSV
 * que pokemontcg.io NO tiene (p. ej. 24451 «ME: Mega Evolution Promo»). Sin migración: el origen se marca con el
 * prefijo `tcgcsv:` del `externalId` (`isTcgcsvOrigin`). Money-safe: el precio sale solo de TCGCSV (`tcgcsv_singles`,
 * misma escritura y regla que el barrido diario); sin precio ⇒ la carta se crea sin `PriceReference` (PRICE_PENDING).
 */
@Injectable()
export class TcgcsvSetImportService {
  private readonly logger = new Logger(TcgcsvSetImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tcgcsv: TcgcsvCatalogClient,
    private readonly ptcg: PokemonTcgIoClient,
    private readonly finishReconciler: FinishReconciler,
    private readonly pricing: PricingService,
    private readonly fx: FxService,
  ) {}

  /** GET /admin/catalog/tcgcsv-groups — grupos de TCGCSV SIN set de pokemontcg.io. */
  async listGroups(): Promise<TcgcsvGroupRow[]> {
    const groups = await this.guard(() => this.tcgcsv.listGroups());
    const covered = await this.coveredGroupIds(groups);
    const local = await this.prisma.cardSet.findMany({
      select: { externalId: true, _count: { select: { cards: true } } },
    });
    const own = new Map<string, number>();
    for (const s of local) if (isTcgcsvOrigin(s.externalId)) own.set(s.externalId, s._count.cards);
    return groups
      .filter((g) => !covered.has(g.groupId))
      .map((g) => ({
        groupId: g.groupId,
        name: g.name,
        publishedOn: g.publishedOn ?? null,
        imported: own.has(tcgcsvSetExternalId(g.groupId)),
        cardCount: own.get(tcgcsvSetExternalId(g.groupId)) ?? 0,
      }))
      .sort((a, b) => (b.publishedOn ?? '').localeCompare(a.publishedOn ?? '') || a.groupId - b.groupId);
  }

  /**
   * Grupos que YA empatan con un set de pokemontcg.io: `pptSetId`/`tcgcsvGroupId` del set local o match por nombre
   * (`matchTcgcsvGroupByName`, la escalera única) con los sets locales de pokemontcg.io y, si responde, los remotos.
   * Los sets `tcgcsv:` NO cuentan como «cubiertos» (son nuestro propio origen).
   */
  private async coveredGroupIds(groups: readonly TcgcsvGroupRef[]): Promise<Set<number>> {
    const covered = new Set<number>();
    const local = await this.prisma.cardSet.findMany({
      select: { externalId: true, name: true, pptSetId: true, tcgcsvGroupId: true },
    });
    const names = new Set<string>();
    for (const s of local) {
      if (isTcgcsvOrigin(s.externalId)) continue;
      if (s.pptSetId && /^\d+$/.test(s.pptSetId)) covered.add(parseInt(s.pptSetId, 10));
      if (s.tcgcsvGroupId != null) covered.add(s.tcgcsvGroupId);
      names.add(s.name);
    }
    try {
      for (const r of await this.ptcg.getSets()) if (r?.name) names.add(r.name);
    } catch (e) {
      this.logger.warn(`tcgcsv-groups: pokemontcg.io no respondió (${(e as Error).message}); se usan solo los sets locales.`);
    }
    for (const name of names) {
      const m = matchTcgcsvGroupByName(name, groups);
      if (m.groupId != null) covered.add(m.groupId);
    }
    return covered;
  }

  /** POST /admin/catalog/import-tcgcsv-set — idempotente; 2 llamadas simultáneas se serializan por `groupId`. */
  async importGroup(groupId: number): Promise<TcgcsvImportResult> {
    const groups = await this.guard(() => this.tcgcsv.listGroups());
    const group = groups.find((g) => g.groupId === groupId);
    if (!group) {
      throw new BusinessException(
        ErrorCode.TCGCSV_GROUP_UNKNOWN,
        HttpStatus.NOT_FOUND,
        `El grupo ${groupId} no existe en TCGCSV.`,
      );
    }
    if ((await this.coveredGroupIds(groups)).has(groupId)) {
      throw BusinessException.conflict(
        ErrorCode.TCGCSV_GROUP_COVERED,
        `El grupo ${groupId} ("${group.name}") ya corresponde a un set de pokemontcg.io; se importa con POST /admin/catalog/sync.`,
        { groupId },
      );
    }
    // Todo el fetch remoto ANTES de escribir (fallo ⇒ 502 y nada escrito).
    const [products, prices] = await this.guard(() =>
      Promise.all([this.tcgcsv.getCardProducts(groupId), this.tcgcsv.getPrices(groupId)]),
    );
    const fxSnap = await this.fx.getCurrent();

    // Candado por grupo: la transacción SOLO sostiene el `pg_advisory_xact_lock`; el trabajo corre por `this.prisma`.
    return this.prisma.$transaction(
      async (lockTx) => {
        await lockTx.$executeRaw`SELECT pg_advisory_xact_lock(${TCGCSV_IMPORT_LOCK_NAMESPACE}::int, ${groupId}::int)`;
        return this.runImport(group, products, prices, fxSnap);
      },
      { timeout: 300_000, maxWait: 60_000 },
    );
  }

  private async runImport(
    group: TcgcsvGroupRef,
    products: TcgcsvCardProductRef[],
    prices: TcgcsvPriceRow[],
    fx: { rate: number; bufferPct: number },
  ): Promise<TcgcsvImportResult> {
    const groupId = group.groupId;
    const pricesByProduct = new Map<number, TcgcsvPriceRow[]>();
    for (const r of prices) {
      const l = pricesByProduct.get(r.productId);
      if (l) l.push(r);
      else pricesByProduct.set(r.productId, [r]);
    }

    const releaseDate = group.publishedOn ? group.publishedOn.slice(0, 10).replace(/-/g, '/') : null;
    const set = await this.prisma.cardSet.upsert({
      where: { externalId: tcgcsvSetExternalId(groupId) },
      create: {
        externalId: tcgcsvSetExternalId(groupId),
        name: group.name,
        releaseDate,
        pptSetId: String(groupId),
        tcgcsvGroupId: groupId,
      },
      update: { name: group.name, ...(releaseDate ? { releaseDate } : {}), pptSetId: String(groupId), tcgcsvGroupId: groupId },
      select: { id: true },
    });

    const res: TcgcsvImportResult = { setId: set.id, created: 0, updated: 0, stamped: 0, noPrice: 0, skipped: [] };
    const skip = (p: TcgcsvCardProductRef, reason: TcgcsvSkipReason) =>
      res.skipped.push({ productId: p.productId, name: p.name, reason });
    const touched = new Set<string>();
    const stampedQueue: { p: TcgcsvCardProductRef; name: string; number: string; stamp: { type: StampType; label: string } }[] = [];

    // 1) Cartas base (sin sello).
    for (const p of products) {
      const parsed = parseTcgcsvCardName(p.name, p.number);
      if (!parsed.ok) {
        skip(p, parsed.reason);
        continue;
      }
      if (parsed.stamp) {
        stampedQueue.push({ p, name: parsed.name, number: parsed.number, stamp: parsed.stamp });
        continue;
      }
      const externalId = tcgcsvCardExternalId(p.productId);
      const own = await this.prisma.card.findUnique({ where: { externalId }, select: { id: true } });
      if (!own) {
        // No duplicar: el producto ya es de otra carta (CardProduct) o una carta de pokemontcg.io ya lo ancla.
        const linked = await this.prisma.cardProduct.findUnique({
          where: { tcgplayerProductId: p.productId },
          select: { id: true },
        });
        if (linked) {
          skip(p, 'product_already_linked');
          continue;
        }
        const foreign = await this.prisma.card.findFirst({
          where: { tcgplayerId: String(p.productId) },
          select: { id: true },
        });
        if (foreign) {
          skip(p, 'card_exists_in_pokemontcg');
          continue;
        }
      }
      const priceRows = pricesByProduct.get(p.productId) ?? [];
      const finishes = deriveStructuralFinishes(priceRows.map((r) => r.subTypeName));
      const parts = deriveNumberParts(parsed.number);
      const small = sanitizeSealedImageUrl(p.imageUrl);
      const large = upgradeSealedImageUrl(small);
      const data = {
        setId: set.id,
        name: parsed.name,
        number: parsed.number,
        numberSort: parts.numberSort,
        numberPrefix: parts.prefix,
        rarity: p.rarity,
        rarityCanonical: normalizeRarity(p.rarity),
        tcgplayerId: String(p.productId),
        // No-degradación: una imagen ausente no borra la que ya hay.
        ...(small ? { imageSmallUrl: small, imageLargeUrl: large } : {}),
      };
      const card = await this.prisma.card.upsert({
        where: { externalId },
        create: {
          externalId,
          ...data,
          catalogFinishes: finishes.length > 0 ? finishes : ['normal'],
          structuralFinishes: finishes.length > 0 ? finishes : ['normal'],
        },
        update: data,
        select: { id: true },
      });
      if (own) res.updated += 1;
      else res.created += 1;
      touched.add(card.id);
      const cp = await this.prisma.cardProduct.upsert({
        where: { tcgplayerProductId: p.productId },
        create: { cardId: card.id, tcgplayerProductId: p.productId, kind: 'set_base', name: p.name, finishes, sourceGroupId: groupId },
        update: { name: p.name, finishes, sourceGroupId: groupId },
        select: { id: true },
      });
      if (!(await this.writePrices(card.id, cp.id, priceRows, fx))) res.noPrice += 1;
    }

    // 2) Versiones con sello: producto aparte colgado de la base ÚNICA del MISMO set.
    if (stampedQueue.length > 0) {
      const cards = await this.prisma.card.findMany({
        where: { setId: set.id },
        select: { id: true, name: true, number: true },
      });
      const byKey = new Map<string, string[]>();
      for (const c of cards) {
        const key = `${normalizeMatchText(c.name)}|${normalizeCardNumber(c.number)}`;
        const l = byKey.get(key);
        if (l) l.push(c.id);
        else byKey.set(key, [c.id]);
      }
      for (const q of stampedQueue) {
        const bases = byKey.get(`${normalizeMatchText(q.name)}|${normalizeCardNumber(q.number)}`) ?? [];
        if (bases.length === 0) {
          skip(q.p, 'no_base');
          continue;
        }
        if (bases.length > 1) {
          skip(q.p, 'ambiguous_base');
          continue;
        }
        const prev = await this.prisma.cardProduct.findUnique({
          where: { tcgplayerProductId: q.p.productId },
          select: { id: true, kind: true, cardId: true },
        });
        if (prev && (prev.kind !== 'stamped' || prev.cardId !== bases[0])) {
          skip(q.p, 'product_already_linked');
          continue;
        }
        const priceRows = pricesByProduct.get(q.p.productId) ?? [];
        const finishes = deriveStructuralFinishes(priceRows.map((r) => r.subTypeName));
        const cp = await this.prisma.cardProduct.upsert({
          where: { tcgplayerProductId: q.p.productId },
          create: {
            cardId: bases[0],
            tcgplayerProductId: q.p.productId,
            kind: 'stamped',
            name: q.p.name,
            finishes,
            stampType: q.stamp.type,
            stampLabel: q.stamp.label,
            sourceGroupId: groupId,
          },
          update: { name: q.p.name, finishes, stampType: q.stamp.type, stampLabel: q.stamp.label, sourceGroupId: groupId },
          select: { id: true },
        });
        res.stamped += 1;
        if (!(await this.writePrices(bases[0], cp.id, priceRows, fx))) res.noPrice += 1;
      }
    }

    await this.finishReconciler.reconcile([...touched]);
    this.logger.log(
      `tcgcsv-import: grupo ${groupId} ("${group.name}") — created=${res.created} updated=${res.updated} ` +
        `stamped=${res.stamped} noPrice=${res.noPrice} skipped=${res.skipped.length}.`,
    );
    return res;
  }

  /** Escribe el precio de mercado por acabado (`tcgcsv_singles`, write-on-change). `true` si escribió alguno. */
  private async writePrices(
    cardId: string,
    cardProductId: string,
    rows: TcgcsvPriceRow[],
    fx: { rate: number; bufferPct: number },
  ): Promise<boolean> {
    let wrote = false;
    const seen = new Set<Finish>();
    for (const r of rows) {
      const finish = tcgcsvSubTypeToFinish(r.subTypeName);
      if (finish == null || seen.has(finish)) continue;
      seen.add(finish);
      const m = r.marketPrice;
      if (m == null || !Number.isFinite(m) || m <= 0 || m > MAX_SANE_MARKET_USD) continue;
      const cents = Math.round(m * 100);
      if (cents <= 0) continue;
      try {
        await this.pricing.persistMarketReference(
          cardId,
          finish,
          { marketCents: cents, currency: 'USD', source: 'tcgcsv_singles' },
          fx,
          cardProductId,
        );
        wrote = true;
      } catch (e) {
        this.logger.warn(`tcgcsv-import: precio de ${cardProductId}/${finish} falló (${(e as Error).message}); queda pendiente.`);
      }
    }
    return wrote;
  }

  /** Un fallo remoto de TCGCSV ⇒ 502 UPSTREAM_ERROR accionable (nada se escribió); una BusinessException se preserva. */
  private async guard<T>(op: () => Promise<T>): Promise<T> {
    try {
      return await op();
    } catch (e) {
      if (e instanceof BusinessException) throw e;
      this.logger.warn(`tcgcsv-import: TCGCSV no disponible: ${(e as Error).message}`);
      throw new BusinessException(
        ErrorCode.UPSTREAM_ERROR,
        HttpStatus.BAD_GATEWAY,
        'TCGCSV no respondió; no se escribió nada. Reintenta en unos minutos.',
      );
    }
  }
}
