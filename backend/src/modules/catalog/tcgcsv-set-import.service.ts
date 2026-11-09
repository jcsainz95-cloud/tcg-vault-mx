import { HttpStatus, Injectable, Logger, Optional } from '@nestjs/common';
import { Finish, Role, StampType } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/business.exception';
import { ErrorCode } from '../../common/error-codes';
import { normalizeMatchText } from '../../common/card-version';
import { deriveNumberParts } from '../../common/card-order';
import { normalizeRarity } from '../../common/rarity-catalog';
import { TcgcsvCatalogClient } from '../pricing/providers/tcgcsv-singles.provider';
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
import { AuditService } from '../audit/audit.service';
import { findImportableGroup, TCGCSV_IMPORTABLE_GROUPS } from './tcgcsv-importable-groups';
import {
  TcgcsvSkipReason,
  exceedsFieldLimits,
  parseTcgcsvCardName,
  tcgcsvCardExternalId,
  tcgcsvSetExternalId,
} from './tcgcsv-card-name';

/** Mismo tope de cordura que el barrido diario (tcgcsv-singles-bulk.provider.ts): un `market` mayor es dato corrupto. */
const MAX_SANE_MARKET_USD = 50_000;
/** Candado consultivo por grupo: `pg_try_advisory_xact_lock(hashtext(KEY), groupId)`; sin espera (2.º clic ⇒ 409). */
const TCGCSV_IMPORT_LOCK_KEY = 'tcgcsv-import';
/** La lista viva de pokemontcg.io no puede colgar la petición (fail-closed ⇒ 503). */
// Debe ser MAYOR que el presupuesto del cliente (20 s): si no, el timer gana la carrera y la caché de respaldo nunca llega a usarse.
const PTCG_TIMEOUT_MS = 22_000;
/** `$transaction` interactiva: 1 sola conexión por petición; espera máx. 5 s por conexión y 60 s de trabajo. */
const TX_OPTS = { maxWait: 5_000, timeout: 60_000 } as const;

type Db = Prisma.TransactionClient;

export interface TcgcsvGroupRow {
  groupId: number;
  name: string;
  publishedOn: string | null;
  imported: boolean;
  /** Productos con número en TCGCSV (candidatos a carta); `null` si TCGCSV no respondió. */
  productCount: number | null;
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
 * TcgcsvSetImportService (P-PROMOS opción C · ARCHITECTURE §5.12) — crea el set y sus cartas desde un grupo de la LISTA
 * EXPLÍCITA `TCGCSV_IMPORTABLE_GROUPS` (hoy 24451 «ME: Mega Evolution Promo»). Sin migración: el origen se marca con el
 * prefijo `tcgcsv:` del `externalId`. Money-safe: el precio sale solo de TCGCSV (`tcgcsv_singles`); sin precio ⇒ sin
 * `PriceReference` (PRICE_PENDING). Atomicidad: red ANTES; luego UNA `$transaction` con `pg_try_advisory_xact_lock` primero.
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
    @Optional() private readonly audit?: AuditService,
  ) {}

  /** GET /admin/catalog/tcgcsv-groups — SOLO los grupos de la lista explícita, `publishedOn` desc. */
  async listGroups(): Promise<TcgcsvGroupRow[]> {
    const groups = await this.guard(() => this.tcgcsv.listGroups());
    const local = await this.prisma.cardSet.findMany({
      where: { externalId: { in: TCGCSV_IMPORTABLE_GROUPS.map((g) => tcgcsvSetExternalId(g.groupId)) } },
      select: { externalId: true, _count: { select: { cards: true } } },
    });
    const own = new Map<string, number>();
    for (const sRow of local) own.set(sRow.externalId, sRow._count.cards);
    const rows: TcgcsvGroupRow[] = [];
    for (const imp of TCGCSV_IMPORTABLE_GROUPS) {
      const g = groups.find((x) => x.groupId === imp.groupId);
      if (!g) continue;
      let productCount: number | null = null;
      try {
        productCount = (await this.tcgcsv.getCardProducts(g.groupId)).filter((p) => (p.number ?? '').trim() !== '').length;
      } catch (e) {
        this.logger.warn(`tcgcsv-groups: productCount de ${g.groupId} no disponible (${(e as Error).message}).`);
      }
      const ext = tcgcsvSetExternalId(g.groupId);
      rows.push({
        groupId: g.groupId,
        name: g.name,
        publishedOn: g.publishedOn ?? null,
        imported: own.has(ext),
        productCount,
        cardCount: own.get(ext) ?? 0,
      });
    }
    return rows.sort((a, b) => (b.publishedOn ?? '').localeCompare(a.publishedOn ?? '') || a.groupId - b.groupId);
  }

  /** Lista VIVA de pokemontcg.io (no los sets locales). Sin respuesta/timeout ⇒ 503 `POKEMONTCG_UNAVAILABLE` (fail-closed). */
  private async liveSetsOrFail(): Promise<{ id: string; name: string }[]> {
    let timer: NodeJS.Timeout | undefined;
    try {
      const sets = await Promise.race([
        this.ptcg.getSetsBounded(),
        new Promise<never>((_, rej) => {
          timer = setTimeout(() => rej(new Error('timeout')), PTCG_TIMEOUT_MS);
        }),
      ]);
      if (!Array.isArray(sets)) throw new Error('payload inválido');
      return sets;
    } catch (e) {
      this.logger.warn(`tcgcsv-import: pokemontcg.io no respondió (${(e as Error).message}); el import NO procede.`);
      throw BusinessException.retriable(
        ErrorCode.POKEMONTCG_UNAVAILABLE,
        'No se pudo consultar pokemontcg.io para comprobar que el set no existe ahí; no se escribió nada. Reintenta en unos minutos.',
      );
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** POST /admin/catalog/import-tcgcsv-set — todo-o-nada, idempotente; un segundo import simultáneo ⇒ 409 inmediato. */
  async importGroup(
    groupId: number,
    actor?: { id: string; role: Role } | { kind: 'system'; job: string; jobId?: string; attempt?: number },
  ): Promise<TcgcsvImportResult> {
    // AUTO (docs/specs/AUTO_CATALOGO.md §A): el actor `system` solo lo construye el job; sin rol, SOLO sobre la lista explicita
    // (la guardia de arriba ya rechaza grupos fuera de ella). La auditoria no lleva usuario y marca `metadata.actor='system'`.
    const sys = actor && 'kind' in actor ? actor : null;
    const human = actor && !('kind' in actor) ? actor : undefined;
    const entry = findImportableGroup(groupId);
    if (!entry) {
      throw new BusinessException(
        ErrorCode.TCGCSV_GROUP_UNKNOWN,
        HttpStatus.NOT_FOUND,
        `El grupo ${groupId} no está en la lista de grupos importables.`,
      );
    }
    // Fail-closed: lista VIVA de pokemontcg.io ANTES de cualquier escritura.
    const live = await this.liveSetsOrFail();
    const groups = await this.guard(() => this.tcgcsv.listGroups());
    const group = groups.find((g) => g.groupId === groupId);
    if (!group) {
      throw new BusinessException(ErrorCode.TCGCSV_GROUP_UNKNOWN, HttpStatus.NOT_FOUND, `El grupo ${groupId} no existe en TCGCSV.`);
    }
    const groupName = normalizeMatchText(group.name);
    const covering = live.find((r) => entry.ptcgSetIds.includes(r?.id) || (r?.name != null && normalizeMatchText(r.name) === groupName));
    if (covering) {
      throw BusinessException.conflict(
        ErrorCode.TCGCSV_GROUP_COVERED,
        `El grupo ${groupId} ("${group.name}") ya corresponde al set "${covering.id}" de pokemontcg.io; se importa con POST /admin/catalog/sync.`,
        { groupId, ptcgSetId: covering.id },
      );
    }
    // Todo el fetch remoto ANTES de abrir la transacción (fallo ⇒ 502 y nada escrito; la conexión no espera a la red).
    const [products, prices] = await this.guard(() =>
      Promise.all([this.tcgcsv.getCardProducts(groupId), this.tcgcsv.getPrices(groupId)]),
    );
    const fxSnap = await this.fx.getCurrent();

    try {
      return await this.prisma.$transaction(async (tx) => {
        const got = await tx.$queryRaw<{ ok: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext(${TCGCSV_IMPORT_LOCK_KEY}), ${groupId}::int) AS ok`;
        if (got[0]?.ok !== true) {
          throw BusinessException.conflict(
            ErrorCode.TCGCSV_IMPORT_IN_PROGRESS,
            `Ya hay un import del grupo ${groupId} en curso; espera a que termine.`,
            { groupId },
          );
        }
        const res = await this.runImport(tx, group, products, prices, fxSnap);
        // La bitácora participa del MISMO commit/rollback que el import.
        await this.audit?.log(
          {
            actorUserId: human?.id,
            actorRole: human?.role,
            action: 'catalog.tcgcsv_import',
            entityType: 'CardSet',
            entityId: res.setId,
            after: {
              groupId,
              created: res.created,
              updated: res.updated,
              stamped: res.stamped,
              noPrice: res.noPrice,
              skipped: res.skipped.length,
              ...(sys
                ? { metadata: { actor: 'system', job: sys.job, jobId: sys.jobId ?? null, attempt: sys.attempt ?? null, groupId, status: res.created > 0 ? 'imported' : 'updated', created: res.created, updated: res.updated } }
                : {}),
            },
          },
          tx,
        );
        return res;
      }, TX_OPTS);
    } catch (e) {
      if (e instanceof BusinessException) throw e;
      this.logger.error(`tcgcsv-import: grupo ${groupId} falló y se revirtió por completo: ${(e as Error).message}`);
      throw BusinessException.retriable(
        ErrorCode.TCGCSV_IMPORT_FAILED,
        'El import falló y se revirtió por completo (0 filas escritas). Reintenta en unos minutos.',
        { groupId },
      );
    }
  }

  private async runImport(
    tx: Db,
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
    const set = await tx.cardSet.upsert({
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

    // 1) Cartas base (sin sello). PROMO-B8: un sello que NO es [Staff] y cuya carta plana (mismo nombre y número) no existe en el
    // grupo se crea como CARTA PROPIA con la etiqueta en el nombre («Miraidon (Pitch Black Stamped)»); su [Staff] cuelga de ella.
    const parsedAll = products.map((p) => ({ p, parsed: parseTcgcsvCardName(p.name, p.number) }));
    const plainKeys = new Set<string>();
    for (const { parsed } of parsedAll) {
      if (parsed.ok && !parsed.stamp) plainKeys.add(`${normalizeMatchText(parsed.name)}|${normalizeCardNumber(parsed.number)}`);
    }
    /** clave plana (nombre+número) → cartas propias promovidas en esta corrida. */
    const promotedByKey = new Map<string, string[]>();
    for (const { p, parsed: parsed0 } of parsedAll) {
      let parsed = parsed0;
      if (!parsed.ok) {
        skip(p, parsed.reason);
        continue;
      }
      if (exceedsFieldLimits({ name: parsed.name, number: parsed.number, rarity: p.rarity, stampLabel: parsed.stamp?.label })) {
        skip(p, 'field_too_long');
        continue;
      }
      let promotedKey: string | null = null;
      if (parsed.stamp) {
        const key = `${normalizeMatchText(parsed.name)}|${normalizeCardNumber(parsed.number)}`;
        if (parsed.stamp.type === 'staff' || plainKeys.has(key)) {
          stampedQueue.push({ p, name: parsed.name, number: parsed.number, stamp: parsed.stamp });
          continue;
        }
        const ownName = `${parsed.name} (${parsed.stamp.label})`;
        if (exceedsFieldLimits({ name: ownName, number: parsed.number, rarity: p.rarity, stampLabel: null })) {
          skip(p, 'field_too_long');
          continue;
        }
        promotedKey = key;
        parsed = { ok: true, name: ownName, number: parsed.number, stamp: null };
      }
      const externalId = tcgcsvCardExternalId(p.productId);
      const own = await tx.card.findUnique({ where: { externalId }, select: { id: true } });
      if (!own) {
        // No duplicar: el producto ya es de otra carta (CardProduct) o una carta de pokemontcg.io ya lo ancla.
        const linked = await tx.cardProduct.findUnique({
          where: { tcgplayerProductId: p.productId },
          select: { id: true },
        });
        if (linked) {
          skip(p, 'product_already_linked');
          continue;
        }
        const foreign = await tx.card.findFirst({
          where: { tcgplayerId: String(p.productId), externalId: { not: externalId } },
          select: { id: true },
        });
        if (foreign) {
          skip(p, 'product_already_linked');
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
      const card = await tx.card.upsert({
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
      if (promotedKey) promotedByKey.set(promotedKey, [...(promotedByKey.get(promotedKey) ?? []), card.id]);
      const cp = await tx.cardProduct.upsert({
        where: { tcgplayerProductId: p.productId },
        create: { cardId: card.id, tcgplayerProductId: p.productId, kind: 'set_base', name: p.name, finishes, sourceGroupId: groupId },
        update: { name: p.name, finishes, sourceGroupId: groupId },
        select: { id: true },
      });
      if (!(await this.writePrices(tx, card.id, cp.id, priceRows, fx))) res.noPrice += 1;
    }

    // 2) Versiones con sello: producto aparte colgado de la base ÚNICA del MISMO set.
    if (stampedQueue.length > 0) {
      const cards = await tx.card.findMany({
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
        const baseKey = `${normalizeMatchText(q.name)}|${normalizeCardNumber(q.number)}`;
        const bases = byKey.get(baseKey) ?? promotedByKey.get(baseKey) ?? [];
        if (bases.length === 0) {
          skip(q.p, 'no_base');
          continue;
        }
        if (bases.length > 1) {
          skip(q.p, 'ambiguous_base');
          continue;
        }
        const prev = await tx.cardProduct.findUnique({
          where: { tcgplayerProductId: q.p.productId },
          select: { id: true, kind: true, cardId: true },
        });
        if (prev && (prev.kind !== 'stamped' || prev.cardId !== bases[0])) {
          skip(q.p, 'product_already_linked');
          continue;
        }
        const priceRows = pricesByProduct.get(q.p.productId) ?? [];
        const finishes = deriveStructuralFinishes(priceRows.map((r) => r.subTypeName));
        const cp = await tx.cardProduct.upsert({
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
        if (!(await this.writePrices(tx, bases[0], cp.id, priceRows, fx))) res.noPrice += 1;
      }
    }

    await this.finishReconciler.reconcile([...touched], tx);
    this.logger.log(
      `tcgcsv-import: grupo ${groupId} ("${group.name}") — created=${res.created} updated=${res.updated} ` +
        `stamped=${res.stamped} noPrice=${res.noPrice} skipped=${res.skipped.length}.`,
    );
    return res;
  }

  /** Escribe el precio de mercado por acabado (`tcgcsv_singles`, write-on-change). `true` si escribió alguno. */
  private async writePrices(
    tx: Db,
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
          tx,
        );
        wrote = true;
      } catch (e) {
        // Dentro de la transacción un error de BD la deja abortada: se propaga ⇒ rollback total (503 FAILED).
        this.logger.warn(`tcgcsv-import: precio de ${cardProductId}/${finish} falló (${(e as Error).message}).`);
        throw e;
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
