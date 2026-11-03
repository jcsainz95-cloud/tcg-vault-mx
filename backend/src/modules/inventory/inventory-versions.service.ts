import { Injectable, Logger, Optional } from '@nestjs/common';
import { CardLanguage, Finish, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/business.exception';
import { orderFinishes } from '../../common/card-order';
import { FinishLabel, finishLabelOf, StampDTO, stampDtoOf, StampRef } from '../../common/card-version';
import { AuditService } from '../audit/audit.service';
import { FxService } from '../pricing/fx.service';
import { isPricePending, SaleDecisionService, SaleItem } from '../pricing/sale-decision.service';
import { StampedIngestService } from '../pricing/stamped-ingest.service';
import { SettingsService } from '../settings/settings.service';

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
}

export interface CardVersionsResponse {
  combos: VersionComboDTO[];
  candidates: { tcgplayerProductId: number; name: string; stamp: StampDTO; finishes: Finish[] }[];
}

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
      item: {
        id: `preview:${language}:${stamp?.productId ?? 'base'}:${finish}`,
        folio: 'PREVIEW',
        cardId,
        card,
        productType: 'raw',
        rawCondition: 'NM',
        finish,
        language,
        cardProductId: stamp?.productId ?? null,
        listPriceCents: null,
        sealedProduct: null,
        ownerType: 'platform',
        status: 'in_stock',
        gradingCompany: null,
        gradeValue: null,
        tcgplayerProductId: null,
      } as unknown as SaleItem,
    });
    for (const f of orderFinishes(card.availableFinishes)) for (const l of LANGUAGES) hypos.push(mk(f, l, null));
    for (const s of stamps) for (const f of orderFinishes(s.finishes)) for (const l of LANGUAGES) hypos.push(mk(f, l, s));
    const dials = await this.settings.getIvaDials();
    const batch = hypos.length > 0 ? await this.decider.loadBatch(hypos.map((h) => h.item)) : null;
    const combos: VersionComboDTO[] = [];
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
        stamp: h.stamp ? stampDtoOf(h.stamp) : null,
        previewPriceCents,
        unavailableReason,
        baseReferenceMxnCents,
        appliedMarketPct,
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
    };
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
    return this.versionsFor(cardId);
  }
}

/** Candado consultivo del `attach` (clave propia; censo `test/lock-keys.census.spec.ts`). */
export const IDS_ATTACH_NAMESPACE = 116_000_116;
