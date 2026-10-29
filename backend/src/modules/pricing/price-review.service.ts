/**
 * price-review.service.ts — v1.91⟨precios⟩ (M-75, §PRE.D/E/F / ARCHITECTURE §4.PRE (d)) — la COLA DE
 * REVISIÓN del candado anti-inflado. 💰 DINERO (bloquea venta y compra).
 *
 * - `recordArbiterDecision()`: lo llama el barrido/publicación tras `decideLock()`. Abre un
 *   `PriceReviewCase open` cuando el candado detuvo un salto sin consenso; lo cierra `superseded`
 *   AUTOMÁTICO cuando el mercado se asienta (el candidato ya no dispara) — «regla general» HECHOS.
 * - `getQueue()`: `GET /admin/pricing/review-queue` (super_admin, read-only, paginado, filtros).
 * - `resolve()`: `POST …/:id/resolve` con guarda de estado (409), `manual` exige precio (422),
 *   delega en el override tier 0 existente. Audita actor+fecha (criterio 877).
 * - `vigenteCaseVariantKeySet()`: qué variantes RAW tienen caso VIGENTE (`open`/`kept`) — lo lee el gate del cotizador de
 *   compra para NUNCA ofertar sobre un valor que el candado detuvo (§PRE.5, §DYN.5.9). La venta NO pasa por aquí: el cuerpo de
 *   venta lee el caso en su entrada (`SaleDecisionService.loadReferences` → `PricingService.saleRetentionFor`, v1.114).
 */
import { Injectable, Optional } from '@nestjs/common';
import { Finish, PriceAxis, PriceReviewStatus, ProductType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BusinessException } from '../../common/business.exception';
import { ErrorCode } from '../../common/error-codes';
import { QuoteSnapshot, RobustResult, LockDecision } from '../../common/robust-market';
import { PricingService } from './pricing.service';
import { ListingPriceService } from './listing-price.service';
import { vigenteStatusWhere } from './review-vigente';

/** Clave lógica de una variante (la misma que dedup la cola, §PRE.D). */
export interface ReviewVariantKey {
  cardId: string;
  productType: ProductType;
  gradeKey: string;
  finish: Finish;
  cardProductId?: string | null;
  sealedProductId?: string | null;
}

export type ReviewAction = 'accept' | 'keep' | 'manual';
const REVIEW_ACTIONS: readonly ReviewAction[] = ['accept', 'keep', 'manual'];

/**
 * v1.91⟨precios⟩ errata (cuestión B) — la fuente REPRESENTATIVA de la mediana, para que `accept` escriba
 * la `PriceReference` robusta con una fuente ADMITIDA (el barrido la sigue arbitrando). Se elige la quote
 * cuyo `priceMxnCents` ES la mediana (`proposedMxnCents`); si ninguna coincide, la primera; ⛔ nunca
 * `manual`. Fallback `tcgcsv_singles` (admitida) si el snapshot viene vacío/ilegible — jamás tier-0.
 */
export function representativeSourceOf(quotesSnapshot: unknown, proposedMxnCents: number): 'tcgdex' | 'cardmarket' | 'tcgcsv_singles' | string {
  const quotes = Array.isArray(quotesSnapshot) ? (quotesSnapshot as QuoteSnapshot[]) : [];
  const admitted = quotes.filter((q) => q && typeof q.source === 'string' && q.source !== 'manual');
  const exact = admitted.find((q) => q.priceMxnCents === proposedMxnCents);
  return exact?.source ?? admitted[0]?.source ?? 'tcgcsv_singles';
}

@Injectable()
export class PriceReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly pricing: PricingService,
    // v1.114 (§DYN.5.9): abrir o renovar un caso encola `review_open` (solo las piezas con fila de la variante). `@Optional`
    // por los mocks posicionales; en DI real siempre se inyecta (mismo módulo).
    @Optional() private readonly listingPrices?: ListingPriceService,
  ) {}

  private whereKey(k: ReviewVariantKey) {
    return {
      cardId: k.cardId,
      productType: k.productType,
      gradeKey: k.gradeKey,
      finish: k.finish,
      cardProductId: k.cardProductId ?? null,
      sealedProductId: k.sealedProductId ?? null,
    };
  }

  /**
   * Llamado por el barrido/publicación tras resolver el árbitro + candado de UNA variante en un eje.
   * El caso que deduplica es el VIGENTE (`open` o `kept`, v1.114 §DYN.5.9: «conservar» sigue reteniendo):
   * - `decision.openCase` ⇒ abre caso `open` (o lo deja si ya hay uno vigente con el MISMO candidato; si el
   *   candidato cambió, el vigente pasa a `superseded` y nace un `open` — con la misma base, porque la base
   *   congelada de `arbiterDetailForKeys` es la del vigente).
   * - `!decision.openCase` (publicó o salto normal) ⇒ el mercado se asentó para este eje ⇒ cierra
   *   `superseded` el vigente del MISMO eje+clave (automático, HECHOS «regla general»; la retención acaba en
   *   el siguiente `daily` o `manual_ingest`: lo automático no dispara cálculo, §DYN.5.3).
   * - Abrir o renovar ⇒ encola `review_open` (§DYN.5.3/.9): cierra la ventana entre que el barrido escribió el
   *   pico y que el caso existe. Solo retiene, así que no adelanta ningún movimiento de mercado.
   *
   * Devuelve el id del caso abierto (o null). Idempotente por el `findFirst` de dedupe (doctrina de la
   * casa, SIN índice único).
   */
  async recordArbiterDecision(
    key: ReviewVariantKey,
    axis: PriceAxis,
    robust: RobustResult,
    decision: LockDecision,
  ): Promise<string | null> {
    const existing = await this.prisma.priceReviewCase.findFirst({
      where: { ...this.whereKey(key), axis, status: vigenteStatusWhere() },
      orderBy: { createdAt: 'desc' },
    });

    if (!decision.openCase) {
      // Mercado asentado para este eje ⇒ cierra el caso vigente, si lo hay.
      if (existing) {
        await this.prisma.priceReviewCase.updateMany({
          where: { id: existing.id, status: vigenteStatusWhere() },
          data: { status: PriceReviewStatus.superseded, resolvedAt: new Date() },
        });
      }
      return null;
    }

    // Candidato que el candado detuvo (0 ⇒ sin mercado, caso de obsolescencia §PRE (f)).
    const proposed = robust.robustMarketMxnCents ?? 0;

    if (existing) {
      // Mismo candidato ⇒ nada que hacer (idempotente). Candidato distinto ⇒ el viejo pasa a
      // `superseded` y nace otro `open` (ARCHITECTURE §4.PRE (d), transición «llega un candidato nuevo»).
      if (existing.proposedMxnCents === proposed) return existing.id;
      await this.prisma.priceReviewCase.updateMany({
        where: { id: existing.id, status: vigenteStatusWhere() },
        data: { status: PriceReviewStatus.superseded, resolvedAt: new Date() },
      });
    }

    const created = await this.prisma.priceReviewCase.create({
      data: {
        ...this.whereKey(key),
        axis,
        proposedMxnCents: proposed,
        baselineMxnCents: decision.conservedMxnCents,
        jumpFactorMilli: decision.jumpFactorMilli,
        sourceCount: robust.sourceCount,
        familyCount: robust.familyCount,
        consensus: robust.consensus,
        quotesSnapshot: robust.quotes as unknown as object,
        status: PriceReviewStatus.open,
      },
      select: { id: true },
    });
    // §DYN.5.9: la venta de la variante pasa a retener YA (no al siguiente `daily`). Solo las variantes que lee el cuerpo
    // (sin producto separado ni sellado) y solo las piezas que ya tienen fila: una sin fila se precia en vivo, ya retenida.
    if (key.cardProductId == null && key.sealedProductId == null) {
      void this.listingPrices?.enqueueVariant(
        'review_open',
        { cardId: key.cardId, productType: key.productType, gradeKey: key.gradeKey, finish: key.finish },
        { onlyWithRow: true },
      );
    }
    return created.id;
  }

  /**
   * v1.91⟨precios⟩ (M-75, §PRE.C/5, criterio 875) — GATE DE COMPRA: ¿qué variantes RAW (set_base,
   * `cardProductId=null`) tienen caso VIGENTE (`open` o `kept`, v1.114 §DYN.5.9)? Devuelve claves en formato
   * `variantKey` (`cardId|productType|gradeKey|finish`) para que el cotizador de compra las ponga en «precio
   * pendiente» (misma forma que §BMK.3) y NUNCA pague sobre un valor que el candado detuvo. 💰 DINERO.
   */
  async vigenteCaseVariantKeySet(
    keys: { cardId: string; productType: ProductType; gradeKey: string; finish: Finish }[],
  ): Promise<Set<string>> {
    const out = new Set<string>();
    if (keys.length === 0) return out;
    const rows = await this.prisma.priceReviewCase.findMany({
      where: {
        status: vigenteStatusWhere(),
        OR: keys.map((k) => ({
          cardId: k.cardId,
          productType: k.productType,
          gradeKey: k.gradeKey,
          finish: k.finish,
          cardProductId: null,
          sealedProductId: null,
        })),
      },
      select: { cardId: true, productType: true, gradeKey: true, finish: true },
    });
    for (const r of rows) out.add(`${r.cardId}|${r.productType}|${r.gradeKey}|${r.finish}`);
    return out;
  }

  /**
   * `GET /admin/pricing/review-queue` — read-only, paginado. `status` ya viene parseado (vacío ⇒ `open`,
   * CLASE E) y `axis` opcional. Respuesta `{ data, total, counts: { open } }` (§PRE.E).
   */
  async getQueue(opts: {
    status: PriceReviewStatus;
    axis?: PriceAxis;
    page?: number;
    pageSize?: number;
  }): Promise<{ data: PriceReviewCaseDTO[]; total: number; counts: { open: number } }> {
    const page = Math.max(1, Math.floor(opts.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Math.floor(opts.pageSize ?? 50)));
    const where = { status: opts.status, ...(opts.axis ? { axis: opts.axis } : {}) };
    const [rows, total, openCount] = await Promise.all([
      this.prisma.priceReviewCase.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.priceReviewCase.count({ where }),
      this.prisma.priceReviewCase.count({ where: { status: PriceReviewStatus.open } }),
    ]);
    const cardIds = [...new Set(rows.map((r) => r.cardId))];
    const cards =
      cardIds.length === 0
        ? []
        : await this.prisma.card.findMany({
            where: { id: { in: cardIds } },
            select: { id: true, name: true, number: true, set: { select: { name: true } } },
          });
    const cardById = new Map(cards.map((c) => [c.id, c]));
    const data = rows.map((r) => toPriceReviewCaseDTO(r, cardById.get(r.cardId)));
    return { data, total, counts: { open: openCount } };
  }

  /**
   * `POST /admin/pricing/review-queue/:id/resolve` (§PRE.F). Guarda de estado (409 si no `open`),
   * `manual` exige precio (422), delega en el override tier 0. Audita (criterio 877).
   */
  async resolve(
    id: string,
    action: ReviewAction,
    manualPriceMxnCents: number | undefined,
    actorUserId: string,
  ): Promise<{ status: PriceReviewStatus }> {
    if (!REVIEW_ACTIONS.includes(action)) {
      throw BusinessException.validation(
        ErrorCode.PRICE_REVIEW_INVALID_ACTION,
        `action "${action}" no válida. Permitidas: ${REVIEW_ACTIONS.join(', ')}.`,
        { field: 'action', allowed: [...REVIEW_ACTIONS] },
      );
    }
    if (action === 'manual' && !(Number.isInteger(manualPriceMxnCents) && (manualPriceMxnCents as number) > 0)) {
      throw BusinessException.validation(
        'VALIDATION_ERROR',
        'action "manual" exige manualPriceMxnCents (entero > 0).',
        { field: 'manualPriceMxnCents' },
      );
    }

    const theCase = await this.prisma.priceReviewCase.findUnique({ where: { id } });
    if (!theCase) throw BusinessException.notFound('NOT_FOUND', `El caso ${id} no existe.`);

    // ⭐ v1.91⟨precios⟩ errata E (techlead, money-safe) — NO se puede ACEPTAR un caso sin precio de
    // mercado. Un caso de «0 quotes frescas pero había base» se abre con `proposedMxnCents=0`
    // (`recordArbiterDecision`, `robust-market` cand==null); aceptarlo publicaría una fila de mercado en
    // $0 (precio-basura deflacionario). `keep` (conserva el último sano) y `manual` (exige `>0`) siguen
    // válidos — son las salidas correctas para ese caso. Antes del `tx`: no se reclama ni se resuelve.
    if (action === 'accept' && !(theCase.proposedMxnCents > 0)) {
      throw BusinessException.validation(
        'VALIDATION_ERROR',
        'No se puede aceptar un caso sin precio de mercado (propuesto 0): usa «Conservar» o «Precio a mano».',
        { field: 'proposedMxnCents' },
      );
    }

    const newStatus: PriceReviewStatus =
      action === 'accept'
        ? PriceReviewStatus.accepted
        : action === 'keep'
          ? PriceReviewStatus.kept
          : PriceReviewStatus.manual;

    // ⭐ v1.91⟨precios⟩ errata (cuestión A, techlead — DINERO) — RECLAMAR ANTES DE ESCRIBIR, en UNA
    // transacción. El código previo aplicaba el override ANTES de la guarda de estado, así que un 2º
    // POST `manual` (doble submit o carrera) ESCRIBÍA el precio y RECIÉN devolvía 409. Ahora la guarda
    // (`updateMany where status=open`, `count===1`) corre PRIMERO dentro de la tx: el perdedor
    // (`count=0`) lanza CONFLICT y la tx **revierte sin escribir precio**. El ganador escribe. 💰 El
    // perdedor NUNCA toca el precio.
    let resolvedPriceRefId: string | null = null;
    await this.prisma.$transaction(async (tx) => {
      const guard = await tx.priceReviewCase.updateMany({
        where: { id, status: PriceReviewStatus.open },
        data: { status: newStatus, resolvedAction: action, resolvedByUserId: actorUserId, resolvedAt: new Date() },
      });
      if (guard.count !== 1) {
        const current = await tx.priceReviewCase.findUnique({ where: { id }, select: { status: true, resolvedAt: true } });
        throw BusinessException.conflict(
          'CONFLICT',
          'Este caso de revisión ya fue resuelto y no puede resolverse de nuevo.',
          { status: current?.status ?? theCase.status, resolvedAt: current?.resolvedAt ?? null },
        );
      }
      if (action === 'manual') {
        // El ÚNICO que fija tier-0 (congela la variante hasta que el dueño quite el override, §4.27f-2).
        const { ref } = await this.pricing.applyManualOverride({
          cardId: theCase.cardId,
          productType: theCase.productType,
          gradeKey: theCase.gradeKey,
          finish: theCase.finish,
          priceMxnCents: manualPriceMxnCents as number,
          tx,
        });
        resolvedPriceRefId = ref.id;
      } else if (action === 'accept') {
        // ⭐ errata cuestión B (§PRE.F / §4.PRE (d)): `accept` promueve una `PriceReference` ROBUSTA
        // NO-manual (NUNCA `source='manual'`) ⇒ el barrido SIGUE arbitrando la variante. Fuente = la
        // representativa de la mediana (admitida, de las quotes del caso).
        const { ref } = await this.pricing.promoteRobustReference({
          cardId: theCase.cardId,
          productType: theCase.productType,
          gradeKey: theCase.gradeKey,
          finish: theCase.finish,
          priceMxnCents: theCase.proposedMxnCents,
          source: representativeSourceOf(theCase.quotesSnapshot, theCase.proposedMxnCents),
          tx,
        });
        resolvedPriceRefId = ref.id;
      }
      if (resolvedPriceRefId != null) {
        await tx.priceReviewCase.update({ where: { id }, data: { resolvedPriceRefId } });
      }
    });

    await this.audit.log({
      actorUserId,
      action: 'pricing.review.resolve',
      entityType: 'PriceReviewCase',
      entityId: id,
      before: { status: 'open', proposedMxnCents: theCase.proposedMxnCents, baselineMxnCents: theCase.baselineMxnCents },
      after: { status: newStatus, action, manualPriceMxnCents: manualPriceMxnCents ?? null, resolvedPriceRefId },
    });

    return { status: newStatus };
  }
}

// ─────────────────────────────── DTO (§PRE.D) ───────────────────────────────
export interface PriceReviewCaseDTO {
  id: string;
  card: { id: string; name: string; setName: string; number: string };
  finish: Finish;
  productType: ProductType;
  gradeKey: string;
  cardProductId?: string | null;
  sealedProductId?: string | null;
  axis: PriceAxis;
  proposedMxnCents: number;
  baselineMxnCents: number | null;
  jumpFactorMilli: number;
  sourceCount: number;
  familyCount: number;
  consensus: boolean;
  quotes: QuoteSnapshot[];
  status: PriceReviewStatus;
  resolvedAction?: ReviewAction | null;
  resolvedBy?: string | null;
  resolvedAt?: string | null;
  createdAt: string;
}

type PriceReviewCaseRow = {
  id: string;
  cardId: string;
  productType: ProductType;
  gradeKey: string;
  finish: Finish;
  cardProductId: string | null;
  sealedProductId: string | null;
  axis: PriceAxis;
  proposedMxnCents: number;
  baselineMxnCents: number | null;
  jumpFactorMilli: number;
  sourceCount: number;
  familyCount: number;
  consensus: boolean;
  quotesSnapshot: unknown;
  status: PriceReviewStatus;
  resolvedAction: string | null;
  resolvedByUserId: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
};

export function toPriceReviewCaseDTO(
  r: PriceReviewCaseRow,
  card?: { id: string; name: string; number: string; set: { name: string } },
): PriceReviewCaseDTO {
  return {
    id: r.id,
    card: {
      id: r.cardId,
      name: card?.name ?? '',
      setName: card?.set?.name ?? '',
      number: card?.number ?? '',
    },
    finish: r.finish,
    productType: r.productType,
    gradeKey: r.gradeKey,
    cardProductId: r.cardProductId,
    sealedProductId: r.sealedProductId,
    axis: r.axis,
    proposedMxnCents: r.proposedMxnCents,
    baselineMxnCents: r.baselineMxnCents,
    jumpFactorMilli: r.jumpFactorMilli,
    sourceCount: r.sourceCount,
    familyCount: r.familyCount,
    consensus: r.consensus,
    quotes: (Array.isArray(r.quotesSnapshot) ? r.quotesSnapshot : []) as QuoteSnapshot[],
    status: r.status,
    resolvedAction: (r.resolvedAction as ReviewAction | null) ?? null,
    resolvedBy: r.resolvedByUserId,
    resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  };
}
