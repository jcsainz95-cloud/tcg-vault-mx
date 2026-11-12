import { Injectable, Logger, Optional } from '@nestjs/common';
import { CardLanguage, Finish, Prisma, Role, StampType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/business.exception';
import { orderFinishes } from '../../common/card-order';
import { FinishLabel, finishLabelOf, scaleByPct, StampDTO, stampDtoOf, StampRef } from '../../common/card-version';
import { variantKey } from '../../common/variant-key';
import { AuditService } from '../audit/audit.service';
import { FxService } from '../pricing/fx.service';
import { hypotheticalRawSaleItem, isPricePending, referenceInfoOf, SaleDecisionBatch, SaleDecisionService, SaleItem } from '../pricing/sale-decision.service';
import { composeVariantPricing } from '../pricing/variant-pricing';
import { StampedIngestService } from '../pricing/stamped-ingest.service';
import { SettingsService } from '../settings/settings.service';
import { ManualVersionMergeService } from '../pricing/manual-version-merge.service';
import { cleanStampLabel, normalizeStampLabel } from '../../common/stamp-label';
import { ErrorCode } from '../../common/error-codes';

/** `VersionComboDTO` (API_CONTRACT §IDS.4). */
export interface VersionComboDTO {
  finish: Finish;
  finishLabel: FinishLabel;
  language: CardLanguage;
  stamp: StampDTO | null;
  previewPriceCents: number | null;
  unavailableReason: 'no_english_market' | 'no_stamped_market' | 'premium_at_floor' | 'no_market' | null;
  /**
   * v1.116.2⟨ids⟩ (§IDS.4, IDS-B20): la referencia de mercado SIN X sobre la que se derivó la combinación (`(·, null)` ⇒ la del
   * inglés de ese acabado; `(·, P)` ⇒ la de P); `null` sin mercado. Es el «Base: MX$…» del desglose de la captura.
   */
  baseReferenceMxnCents: number | null;
  /** v1.116.2⟨ids⟩: X aplicado (`es` ⇒ el dial vigente; `en` ⇒ `null`). */
  appliedMarketPct: number | null;
  /**
   * v1.116.5⟨ids⟩ (§2 «Compra sugerida por versión», IDS-B33…B37): compra sugerida en centavos enteros. `B(R)` = la curva de compra
   * (`composeVariantPricing().buy.effectiveCents`, la del binder) sobre la referencia `R` de la versión; (en, sin liga) ⇒ `B(R_en)`
   * CON override/bounty de la carta (como el binder); el resto, curva PURA (`scaleByPct(B(R), X)` en español). `null` sin referencia,
   * sin compra, X inválido, o graduada/sellado fuera de (en, sin liga).
   */
  buySuggestedCents: number | null;
  /**
   * §ALTA-LIGA-2 (API_CONTRACT_ALTA_LIGA §3): de dónde sale el precio de la combinación. `own_market` ⇒ su propia referencia (o la
   * de la normal cuando la combinación ES la normal); `inherited_base` ⇒ versión de liga MANUAL sin mercado propio, con el precio de
   * la normal del mismo idioma y acabado; `null` ⇒ sin precio.
   */
  priceSource: 'own_market' | 'inherited_base' | null;
}

/** El sello de una combinación, con la marca de versión manual (productId < 0). */
export type VersionStampDTO = StampDTO & { manual: boolean };

export interface CardVersionsResponse {
  combos: (Omit<VersionComboDTO, 'stamp'> & { stamp: VersionStampDTO | null })[];
  candidates: { tcgplayerProductId: number; name: string; stamp: StampDTO; finishes: Finish[] }[];
  /** §ALTA-LIGA-2: el botón «+ Versión de liga» sale siempre (todo `Card` es carta suelta). */
  canAddManual: boolean;
  /** §ALTA-LIGA-2: los tipos de sello para poblar el selector. */
  stampTypes: StampType[];
}

export interface CreateManualVersionInput {
  stampType: StampType;
  stampLabel?: string | null;
  finish: Finish;
}
export interface CreateManualVersionResult {
  created: boolean;
  finishAdded: boolean;
  stamp: VersionStampDTO & { productId: number };
  finishes: Finish[];
  combos: CardVersionsResponse['combos'];
}

/** Candado consultivo del alta manual (clave propia; censo `test/lock-keys.census.spec.ts`). */
export const ALTA_LIGA_NAMESPACE = 116_000_217;
/** Tope de altas manuales por usuario y hora (API_CONTRACT_ALTA_LIGA §2.5). */
export const MANUAL_VERSION_HOURLY_CAP = 20;
export const MANUAL_VERSION_AUDIT_ACTIONS = ['inventory.manual_version_created', 'inventory.manual_version_finish_added'] as const;

const LANGUAGES: CardLanguage[] = ['en', 'es'];
type Reason = NonNullable<VersionComboDTO['unavailableReason']>;
/** Los motivos de `unavailableReason` (§IDS.4), como tabla tipada: un motivo nuevo del cuerpo sin fila aquí no compila. */
const KNOWN_REASON: Record<Reason, true> = { no_english_market: true, no_stamped_market: true, premium_at_floor: true, no_market: true };

/**
 * InventoryVersionsService — v1.116⟨ids⟩ (API_CONTRACT §IDS.4, M1 `vault_operator+`): la captura por versión.
 *  - `GET /admin/inventory/cards/:cardId/versions`: cada combinación (acabado × idioma, y cada producto de liga colgado × sus
 *    acabados × idioma), solo raw NM, con el `P` del CUERPO ÚNICO sobre la pieza hipotética y los diales vigentes
 *    (`previewPriceCents`), o el motivo por el que no hay (`unavailableReason`); más las candidatas de empate ambiguo.
 *  - `POST /admin/inventory/stamped-candidates/:tcgplayerProductId/attach`: elección de IDENTIDAD (nunca de precio).
 */
@Injectable()
export class InventoryVersionsService {
  private readonly logger = new Logger(InventoryVersionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly decider: SaleDecisionService,
    private readonly settings: SettingsService,
    private readonly stampedIngest: StampedIngestService,
    private readonly fx: FxService,
    @Optional() private readonly audit?: AuditService,
    @Optional() private readonly manualMerge?: ManualVersionMergeService,
  ) {}

  async versionsFor(cardId: string): Promise<CardVersionsResponse> {
    const card = await this.prisma.card.findUnique({ where: { id: cardId }, include: { set: true } });
    if (!card) throw BusinessException.notFound('NOT_FOUND', 'Card not found');
    const products = await this.prisma.cardProduct.findMany({
      where: { cardId, kind: 'stamped' },
      orderBy: { tcgplayerProductId: 'asc' },
    });
    const stamps: StampRef[] = products
      .filter((p) => p.stampType != null)
      .map((p) => ({ productId: p.tcgplayerProductId, internalId: p.id, type: p.stampType!, label: p.stampLabel, finishes: p.finishes }));
    // Las piezas HIPOTÉTICAS (no se persisten): raw NM, plataforma, sin precio a mano.
    type Hypo = { item: SaleItem; finish: Finish; language: CardLanguage; stamp: StampRef | null };
    const hypos: Hypo[] = [];
    const mk = (finish: Finish, language: CardLanguage, stamp: StampRef | null): Hypo => ({
      finish,
      language,
      stamp,
      item: hypotheticalRawSaleItem({ id: `preview:${language}:${stamp?.productId ?? 'base'}:${finish}`, folio: 'PREVIEW', card, finish, language, cardProductId: stamp?.productId ?? null }),
    });
    for (const f of orderFinishes(card.availableFinishes)) for (const l of LANGUAGES) hypos.push(mk(f, l, null));
    for (const s of stamps) for (const f of orderFinishes(s.finishes)) for (const l of LANGUAGES) hypos.push(mk(f, l, s));
    const dials = await this.settings.getIvaDials();
    const batch = hypos.length > 0 ? await this.decider.loadBatch(hypos.map((h) => h.item)) : null;
    const combos: CardVersionsResponse['combos'] = [];
    for (const h of hypos) {
      // IDS-B20: el desglose sale del MISMO lote que el precio (la referencia de entrada sin X y el X aplicado).
      const v = { language: h.language, stamp: h.stamp };
      const baseRef = h.stamp == null && h.language === 'en' ? this.decider.referenceIn(batch!.refs, h.item) : undefined;
      const baseReferenceMxnCents =
        h.stamp == null && h.language === 'en'
          ? baseRef?.status === 'priced'
            ? (baseRef.referenceMxnCents ?? null)
            : null
          : this.decider.versionReferences(h.item, v, batch!).guard;
      const appliedMarketPct = h.language === 'es' ? batch!.spanishPct : null;
      // §ALTA-LIGA-2: ¿esta combinación hereda el precio de la normal? (el MISMO cálculo del decisor: `versionReferences`)
      const inherited = h.stamp != null && h.stamp.productId < 0 && this.decider.versionReferences(h.item, v, batch!).inherited;
      // La COMPRA sugerida heredada es la de la combinación NORMAL del mismo idioma y acabado (por confirmar por el dueño).
      const buySuggestedCents = inherited
        ? this.buySuggestedFor(h.item, { language: h.language, stamp: null }, card, batch!, h.language === 'en' ? this.decider.referenceIn(batch!.refs, h.item) : undefined)
        : this.buySuggestedFor(h.item, v, card, batch!, baseRef);
      let previewPriceCents: number | null = null;
      let unavailableReason: Reason | null = null;
      try {
        previewPriceCents = (await this.decider.decide(h.item, dials, batch!)).unitPriceCents;
      } catch (e) {
        if (!isPricePending(e)) throw e;
        const r = (e.details as { reason?: string } | undefined)?.reason;
        unavailableReason = r != null && Object.prototype.hasOwnProperty.call(KNOWN_REASON, r) ? (r as Reason) : 'no_market';
      }
      combos.push({
        finish: h.finish,
        finishLabel: finishLabelOf(h.finish, h.stamp?.label ?? null),
        language: h.language,
        stamp: h.stamp ? { ...stampDtoOf(h.stamp), manual: h.stamp.productId < 0 } : null,
        previewPriceCents,
        unavailableReason,
        baseReferenceMxnCents,
        appliedMarketPct,
        buySuggestedCents,
        priceSource: previewPriceCents == null ? null : inherited ? 'inherited_base' : 'own_market',
      });
    }
    const cands = await this.prisma.stampedProductCandidate.findMany({ where: { cardId }, orderBy: { tcgplayerProductId: 'asc' } });
    return {
      combos,
      candidates: cands.map((c) => ({
        tcgplayerProductId: c.tcgplayerProductId,
        name: c.name,
        stamp: { type: c.stampType, label: c.stampLabel, productId: c.tcgplayerProductId },
        finishes: c.finishes,
      })),
      canAddManual: true,
      stampTypes: Object.values(StampType),
    };
  }

  /**
   * `buySuggestedCents` de una combinación (ver `VersionComboDTO`). La curva y el guardarraíl de COMPRA salen de
   * `composeVariantPricing` (único cuerpo del binder); aquí solo se elige la referencia `R` (la de `versionReferences`) y se
   * aplica `scaleByPct` DESPUÉS de la curva en español. Override/bounty: solo (en, sin liga) (`variantOverrides` solo trae ésa).
   */
  private buySuggestedFor(
    item: SaleItem,
    v: { language: CardLanguage; stamp: StampRef | null },
    card: { rarityCanonical: string | null; rarity: string | null; id: string },
    b: SaleDecisionBatch,
    baseRef: ReturnType<SaleDecisionService['referenceIn']>,
  ): number | null {
    if (item.productType !== 'raw' || !b.curve || !b.premiumFloorPolicy) return null;
    const base = v.stamp == null && v.language === 'en';
    const R = base ? (baseRef?.status === 'priced' ? (baseRef.referenceMxnCents ?? null) : null) : this.decider.versionReferences(item, v, b).guard;
    if (R == null) return null;
    const k = this.decider.refKeyOf(item);
    const override = base && k ? (b.variantOverrides.get(variantKey(k)) ?? null) : null;
    const curveBuy = composeVariantPricing(
      base ? baseRef : referenceInfoOf({ referenceMxnCents: R, capturedDate: null }),
      b.curve,
      override,
      card.rarityCanonical ?? card.rarity,
      b.premiumFloorPolicy,
    ).buy.effectiveCents;
    if (curveBuy == null) return null;
    if (v.language !== 'es') return curveBuy;
    return b.spanishPct == null ? null : scaleByPct(curveBuy, b.spanishPct);
  }

  /**
   * ⭐ §ALTA-LIGA-2 (API_CONTRACT_ALTA_LIGA §2) — `POST /admin/inventory/cards/:cardId/versions`: crea (o reutiliza) una versión de
   * liga MANUAL de la carta: `CardProduct stamped` con `tcgplayerProductId` NEGATIVO de `manual_product_id_seq`. Idempotente por
   * `(cardId, stampType, etiqueta normalizada)` bajo advisory lock + índice único parcial (m104): doble clic o dos operadores ⇒ UN
   * producto; el acabado nuevo se AÑADE. Guardia: si la carta ya tiene candidata o producto REAL del mismo `stampType` ⇒ 409
   * `USE_EXISTING` (se ata con el `attach` de siempre). Tope 20 altas/usuario/hora (cuenta su propia auditoría). ⛔ No escribe
   * ningún precio: la herencia vive en `SaleDecisionService.versionReferences`.
   */
  async createManual(cardId: string, input: CreateManualVersionInput, actor: { id: string; role: Role }): Promise<{ status: 200 | 201; body: CreateManualVersionResult }> {
    const card = await this.prisma.card.findUnique({ where: { id: cardId }, include: { set: true } });
    if (!card) throw BusinessException.notFound('CARD_NOT_FOUND', 'Card not found');
    const label = cleanStampLabel(input.stampLabel);
    if (!label.ok) throw BusinessException.badRequest('VALIDATION_ERROR', 'stampLabel must be 1..40 characters without control characters or HTML', { field: 'stampLabel' });
    if (!(card.availableFinishes as Finish[]).includes(input.finish)) {
      throw BusinessException.validation('FINISH_NOT_AVAILABLE', 'Finish not available for this card', { finish: input.finish, available: card.availableFinishes });
    }
    const norm = normalizeStampLabel(label.label);
    const lockKey = `${cardId}|${input.stampType}|${norm ?? ''}`;
    const out = await this.prisma.$transaction(async (tx) => {
      // Serializa la MISMA llave (doble clic / dos operadores): el segundo ve el producto del primero (200), no un 500 por el índice.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ALTA_LIGA_NAMESPACE}::int, hashtext(${lockKey}))`;
      const existing = await tx.cardProduct.findFirst({
        where: { cardId, kind: 'stamped', stampType: input.stampType, tcgplayerProductId: { lt: 0 }, stampLabelNorm: norm },
      });
      if (existing) {
        if (existing.finishes.includes(input.finish)) return { created: false, finishAdded: false, product: existing };
        await this.assertManualQuota(tx, actor.id);
        const finishes = orderFinishes([...existing.finishes, input.finish]);
        const product = await tx.cardProduct.update({ where: { id: existing.id }, data: { finishes } });
        await this.audit?.log(
          { actorUserId: actor.id, actorRole: actor.role, action: 'inventory.manual_version_finish_added', entityType: 'CardProduct', entityId: product.id,
            after: { actorId: actor.id, cardId, productId: product.tcgplayerProductId, stampType: input.stampType, label: product.stampLabel, finish: input.finish } },
          tx,
        );
        return { created: false, finishAdded: true, product };
      }
      // Guardia contra duplicar lo REAL: producto real o candidata del mismo tipo de sello ⇒ el camino es `attach`.
      const [reals, cands] = await Promise.all([
        tx.cardProduct.findMany({ where: { cardId, kind: 'stamped', stampType: input.stampType, tcgplayerProductId: { gt: 0 } }, select: { tcgplayerProductId: true, name: true, stampLabel: true } }),
        tx.stampedProductCandidate.findMany({ where: { cardId, stampType: input.stampType }, select: { tcgplayerProductId: true, name: true, stampLabel: true } }),
      ]);
      if (reals.length > 0 || cands.length > 0) {
        throw BusinessException.conflict(ErrorCode.USE_EXISTING, 'This card already has a league product of that type; use it', {
          stamps: reals.map((r) => ({ productId: r.tcgplayerProductId, name: r.name, label: r.stampLabel })),
          candidates: cands.map((c) => ({ tcgplayerProductId: c.tcgplayerProductId, name: c.name, label: c.stampLabel })),
        });
      }
      await this.assertManualQuota(tx, actor.id);
      const seq = await tx.$queryRaw<{ id: number }[]>`SELECT nextval('manual_product_id_seq')::int AS id`;
      const productId = seq[0].id;
      const name = `${card.name} (${input.stampType}${label.label ? ` ${label.label}` : ''})`;
      const product = await tx.cardProduct.create({
        data: { cardId, tcgplayerProductId: productId, kind: 'stamped', name, finishes: [input.finish], stampType: input.stampType, stampLabel: label.label, stampLabelNorm: norm, sourceGroupId: null },
      });
      await this.audit?.log(
        { actorUserId: actor.id, actorRole: actor.role, action: 'inventory.manual_version_created', entityType: 'CardProduct', entityId: product.id,
          after: { actorId: actor.id, cardId, productId, stampType: input.stampType, label: label.label, finish: input.finish } },
        tx,
      );
      return { created: true, finishAdded: false, product };
    });
    const versions = await this.versionsFor(cardId);
    const productId = out.product.tcgplayerProductId;
    return {
      status: out.created ? 201 : 200,
      body: {
        created: out.created,
        finishAdded: out.finishAdded,
        stamp: { type: out.product.stampType!, label: out.product.stampLabel, productId, manual: true },
        finishes: orderFinishes(out.product.finishes),
        combos: versions.combos.filter((c) => c.stamp?.productId === productId),
      },
    };
  }

  /** 20 altas manuales por usuario por hora (429 `RATE_LIMITED`): cuenta SU auditoría, así que un reintento sin escritura no gasta cupo. */
  private async assertManualQuota(tx: Prisma.TransactionClient, userId: string): Promise<void> {
    const since = new Date(Date.now() - 3600_000);
    const n = await tx.auditLog.count({ where: { actorUserId: userId, action: { in: [...MANUAL_VERSION_AUDIT_ACTIONS] }, createdAt: { gte: since } } });
    if (n >= MANUAL_VERSION_HOURLY_CAP) {
      throw new BusinessException('RATE_LIMITED', 429, 'Too many manual league versions in the last hour', { limit: MANUAL_VERSION_HOURLY_CAP });
    }
  }

  /**
   * `attach` (§IDS.4): sin la fila `(tcgplayerProductId, cardId)` ⇒ 404; ya colgado ⇒ 409 `STAMPED_PRODUCT_TAKEN`. En UNA
   * transacción crea el `CardProduct stamped` y borra las candidatas de ese producto (con la bitácora); después, best-effort,
   * baja el precio de su grupo. Responde el `GET …/versions` de la carta.
   */
  async attach(tcgplayerProductId: number, cardId: string, actor: { id: string; role: Role }): Promise<CardVersionsResponse> {
    const created = await this.prisma.$transaction(async (tx) => {
      // Serializa dos `attach` del mismo producto (el `@unique` igual lo impediría; así el perdedor ve 409, no 500).
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${IDS_ATTACH_NAMESPACE}::int, ${tcgplayerProductId}::int)`;
      const taken = await tx.cardProduct.findUnique({ where: { tcgplayerProductId }, select: { id: true } });
      if (taken) throw BusinessException.conflict('STAMPED_PRODUCT_TAKEN', 'This league product is already attached to a card');
      const cand = await tx.stampedProductCandidate.findUnique({ where: { tcgplayerProductId_cardId: { tcgplayerProductId, cardId } } });
      if (!cand) throw BusinessException.notFound('NOT_FOUND', 'No candidate for this product and card');
      const cp = await tx.cardProduct.create({
        data: {
          cardId,
          tcgplayerProductId,
          kind: 'stamped',
          name: cand.name,
          finishes: cand.finishes,
          stampType: cand.stampType,
          stampLabel: cand.stampLabel,
          sourceGroupId: cand.groupId,
        },
      });
      await tx.stampedProductCandidate.deleteMany({ where: { tcgplayerProductId } });
      await this.audit?.log(
        {
          actorUserId: actor.id,
          actorRole: actor.role,
          action: 'inventory.stamped_attach',
          entityType: 'CardProduct',
          entityId: cp.id,
          after: { tcgplayerProductId, cardId, stampType: cand.stampType, stampLabel: cand.stampLabel, groupId: cand.groupId },
        },
        tx,
      );
      return cp;
    });
    try {
      const fx = await this.fx.getCurrent();
      await this.stampedIngest.refreshProductPrice(created.sourceGroupId!, tcgplayerProductId, cardId, created.id, { rate: fx.rate, bufferPct: fx.bufferPct });
    } catch (e) {
      this.logger.warn(`attach ${tcgplayerProductId}: precio no bajado ahora (lo trae el siguiente barrido): ${e instanceof Error ? e.message : String(e)}`);
    }
    // §ALTA-LIGA-2: un producto real nuevo en esta carta puede fusionar su versión manual (best-effort, idempotente).
    await this.manualMerge?.mergeForCardSafe(cardId);
    return this.versionsFor(cardId);
  }
}

/** Candado consultivo del `attach` (clave propia; censo `test/lock-keys.census.spec.ts`). */
export const IDS_ATTACH_NAMESPACE = 116_000_116;
