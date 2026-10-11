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
 * - `openCaseVariantKeys()`: qué variantes tienen caso `open` — lo leen el resolvedor de lectura y el
 *   gate del cotizador de compra para NUNCA ofertar/publicar sobre un valor inflado (§PRE.5).
 */
import { Injectable } from '@nestjs/common';
import { Finish, PriceAxis, PriceReviewStatus, ProductType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BusinessException } from '../../common/business.exception';
import { ErrorCode } from '../../common/error-codes';
import { QuoteSnapshot, RobustResult, LockDecision } from '../../common/robust-market';
import { PricingService } from './pricing.service';

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

/** La foto de la variante para `variantKey` del `Map` de casos abiertos (sin `axis`: bloquea ambos). */
export function reviewVariantKeyString(k: ReviewVariantKey): string {
  return [
    k.cardId,
    k.productType,
    k.gradeKey,
    k.finish,
    k.cardProductId ?? '∅',
    k.sealedProductId ?? '∅',
  ].join('|');
}

@Injectable()
export class PriceReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly pricing: PricingService,
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
   * - `decision.openCase` ⇒ abre caso `open` (o lo deja si ya hay uno con el MISMO candidato; si el
   *   candidato cambió, supersede el viejo y abre otro).
   * - `!decision.openCase` (publicó o salto normal) ⇒ el mercado se asentó para este eje ⇒ cierra
   *   `superseded` cualquier caso `open` del MISMO eje+clave (automático, HECHOS «regla general»).
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
      where: { ...this.whereKey(key), axis, status: PriceReviewStatus.open },
    });

    if (!decision.openCase) {
      // Mercado asentado para este eje ⇒ cierra el caso abierto, si lo hay.
      if (existing) {
        await this.prisma.priceReviewCase.updateMany({
          where: { id: existing.id, status: PriceReviewStatus.open },
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
        where: { id: existing.id, status: PriceReviewStatus.open },
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
    return created.id;
  }

  /**
   * Variantes con caso `open` (CUALQUIER eje). El valor es la `axis` que disparó (informativo). Lo leen
   * el resolvedor de lectura (suprime el inflado en la tienda) y el gate del cotizador de compra.
   */
  async openCaseVariantKeys(keys: ReviewVariantKey[]): Promise<Set<string>> {
    const out = new Set<string>();
    if (keys.length === 0) return out;
    const rows = await this.prisma.priceReviewCase.findMany({
      where: {
        status: PriceReviewStatus.open,
        OR: keys.map((k) => this.whereKey(k)),
      },
      select: {
        cardId: true,
        productType: true,
        gradeKey: true,
        finish: true,
        cardProductId: true,
        sealedProductId: true,
      },
    });
    for (const r of rows) out.add(reviewVariantKeyString(r));
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

    // Candado de estado: el caso debe estar `open` en el `where` (count===1), como el resolve de disputas.
    // ⛔ NO idempotente: una segunda resolución es 409, no «repetir».
    const theCase = await this.prisma.priceReviewCase.findUnique({ where: { id } });
    if (!theCase) throw BusinessException.notFound('NOT_FOUND', `El caso ${id} no existe.`);

    let resolvedPriceRefId: string | null = null;
    if (action === 'manual') {
      // Delega en la vía existente de override (tier 0 manual, §4.27f-2). Raw/sellado por carta.
      const { ref } = await this.pricing.applyManualOverride({
        cardId: theCase.cardId,
        productType: theCase.productType,
        gradeKey: theCase.gradeKey,
        finish: theCase.finish,
        priceMxnCents: manualPriceMxnCents as number,
      });
      resolvedPriceRefId = ref.id;
    }

    const newStatus: PriceReviewStatus =
      action === 'accept'
        ? PriceReviewStatus.accepted
        : action === 'keep'
          ? PriceReviewStatus.kept
          : PriceReviewStatus.manual;

    const guard = await this.prisma.priceReviewCase.updateMany({
      where: { id, status: PriceReviewStatus.open },
      data: {
        status: newStatus,
        resolvedAction: action,
        resolvedByUserId: actorUserId,
        resolvedPriceRefId,
        resolvedAt: new Date(),
      },
    });
    if (guard.count !== 1) {
      const current = await this.prisma.priceReviewCase.findUnique({
        where: { id },
        select: { status: true, resolvedAt: true },
      });
      throw BusinessException.conflict(
        'CONFLICT',
        'Este caso de revisión ya fue resuelto y no puede resolverse de nuevo.',
        { status: current?.status ?? theCase.status, resolvedAt: current?.resolvedAt ?? null },
      );
    }

    // `accept` ⇒ publica el propuesto como valor sano (escribe override tier 0 = lo vuelve la referencia
    // viva). El dueño ACEPTÓ el número que el candado detuvo, así que se trata como su decisión manual.
    if (action === 'accept') {
      const { ref } = await this.pricing.applyManualOverride({
        cardId: theCase.cardId,
        productType: theCase.productType,
        gradeKey: theCase.gradeKey,
        finish: theCase.finish,
        priceMxnCents: theCase.proposedMxnCents,
      });
      await this.prisma.priceReviewCase.update({
        where: { id },
        data: { resolvedPriceRefId: ref.id },
      });
      resolvedPriceRefId = ref.id;
    }

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
