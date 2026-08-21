import { Injectable } from '@nestjs/common';
import { Card, Finish, ProductType, VariantPriceOverride } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/business.exception';
import { MAX_CENTS, quoteAcquisitionForFinish } from '../../common/money';
import { AuditService } from '../audit/audit.service';
import { PricingService } from './pricing.service';
import { VariantPricingDTO, composeVariantPricing } from './variant-pricing';

/**
 * VariantControlsService — v1.28 (P-18/P-22, ARCHITECTURE §4.26a/§4.26b · API_CONTRACT §M2
 * `PUT /admin/pricing/variant-controls/:cardId/:finish`, `super_admin`, AUDITADO).
 *
 * Upsert de los CONTROLES de precio por (carta, variante[, grado]) — la fila `VariantPriceOverride`
 * (M-30). TOCA DINERO en las dos direcciones: `sellOverrideCents` fija el precio publicado del
 * storefront (para piezas sin `listPriceCents` manual) y `buyOverrideCents`/bounty fijan la oferta
 * del cotizador público de buylist. Decisión del humano ratificada: estos valores SÍ pisan lo que
 * ve el cliente (§4.26b).
 *
 * Semántica del PATCH parcial (contrato §M2): campo OMITIDO no se toca; `null` explícito LIMPIA
 * (quitar un override regresa esa cara a su regla; `bounty:null`/`enabled:false` apaga el bounty
 * SIN borrar el contador `bountyAcquiredQty`). Fila con todo vacío (y sin historia de bounty) se
 * BORRA — equivalente observable a "sin fila", deja la tabla como si nunca hubiera existido.
 *
 * NO toca `PriceReference` (el mercado es otra perilla, `POST /admin/pricing/override`) ni
 * resuelve `PendingPriceEntry` (un override de venta/compra no es una referencia).
 */

/** Shape del body (validación MANUAL aquí — null vs omitido importa; códigos 422 del contrato). */
export interface VariantControlsInput {
  productType?: unknown;
  gradeKey?: unknown;
  sellOverrideCents?: unknown;
  buyOverrideCents?: unknown;
  bounty?: unknown;
}

export interface VariantControlsResponse {
  cardId: string;
  productType: ProductType;
  gradeKey: string;
  finish: Finish;
  pricing: VariantPricingDTO;
}

const FINISH_VALUES: readonly Finish[] = Object.values(Finish);

/** Campos auditables de la fila (snapshot estable para before/after de AuditLog). */
function snapshot(row: VariantPriceOverride | null) {
  if (!row) return null;
  return {
    sellOverrideCents: row.sellOverrideCents,
    buyOverrideCents: row.buyOverrideCents,
    bountyEnabled: row.bountyEnabled,
    bountyPriceCents: row.bountyPriceCents,
    bountyTargetQty: row.bountyTargetQty,
    bountyAcquiredQty: row.bountyAcquiredQty,
    bountyCompletedAt: row.bountyCompletedAt ? row.bountyCompletedAt.toISOString() : null,
  };
}

/** 422 VALIDATION_ERROR salvo código propio (§4.26a). */
function invalid(message: string, details?: Record<string, unknown>): BusinessException {
  return BusinessException.validation('VALIDATION_ERROR', message, details);
}

/** Centavos de dinero operativo: entero > 0 y representable en Int32 (BE-27). */
function assertCents(field: string, value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0 || value > MAX_CENTS) {
    throw invalid(`${field} must be a positive integer amount in cents (<= ${MAX_CENTS})`, {
      field,
      value,
    });
  }
  return value;
}

@Injectable()
export class VariantControlsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly audit: AuditService,
  ) {}

  /**
   * PUT /admin/pricing/variant-controls/:cardId/:finish — upsert parcial + respuesta RESUELTA
   * (mismo `VariantPricingDTO` que lee el binder, estado tras el write).
   */
  async update(
    cardIdParam: string,
    finishParam: string,
    input: VariantControlsInput,
    actorUserId: string,
  ): Promise<VariantControlsResponse> {
    // ---- Identidad de la variante (SEC-A1: todo validado server-side contra la carta real) ----
    if (!FINISH_VALUES.includes(finishParam as Finish)) {
      throw invalid(`invalid finish '${finishParam}'`, { field: 'finish', allowed: FINISH_VALUES });
    }
    const finish = finishParam as Finish;

    const productTypeRaw = input.productType ?? 'raw';
    if (productTypeRaw !== 'raw' && productTypeRaw !== 'graded') {
      // Incluye `sealed` (su cadena de precio H-1 NO usa esta tabla, §4.26g) y cualquier basura.
      throw invalid(`productType must be 'raw' or 'graded'`, { field: 'productType', value: productTypeRaw });
    }
    const productType = productTypeRaw as ProductType;

    const card = await this.prisma.card.findUnique({ where: { id: cardIdParam } });
    if (!card) throw BusinessException.notFound('NOT_FOUND', 'Card not found');

    const gradeKey = this.resolveGradeKey(card, productType, finish, input.gradeKey);

    // ---- Fila vigente (para el merge parcial y el before de auditoría) ----
    const existing = await this.prisma.variantPriceOverride.findUnique({
      where: { cardId_productType_gradeKey_finish: { cardId: card.id, productType, gradeKey, finish } },
    });

    // ---- Merge campo a campo (omitido = no tocar; null = limpiar; valor = validar y fijar) ----
    const next = {
      sellOverrideCents: this.mergeCents('sellOverrideCents', input, existing?.sellOverrideCents ?? null),
      buyOverrideCents: this.mergeCents('buyOverrideCents', input, existing?.buyOverrideCents ?? null),
      bountyEnabled: existing?.bountyEnabled ?? false,
      bountyPriceCents: existing?.bountyPriceCents ?? null,
      bountyTargetQty: existing?.bountyTargetQty ?? null,
      bountyAcquiredQty: existing?.bountyAcquiredQty ?? 0,
      bountyCompletedAt: existing?.bountyCompletedAt ?? null,
    };
    await this.mergeBounty(next, input, card, productType, finish);

    // ---- Persistencia: upsert / delete-si-vacía / no-op (todo bajo la clave única M-30) ----
    const empty =
      next.sellOverrideCents == null &&
      next.buyOverrideCents == null &&
      !next.bountyEnabled &&
      next.bountyPriceCents == null &&
      next.bountyTargetQty == null &&
      next.bountyAcquiredQty === 0 &&
      next.bountyCompletedAt == null;

    let row: VariantPriceOverride | null;
    if (empty) {
      // Fila con todo vacío ⇒ se borra (equivalente observable a "sin fila", contrato §M2). Si el
      // bounty dejó historia (contador/completedAt) la fila NO califica como vacía y se conserva.
      if (existing) {
        await this.prisma.variantPriceOverride.delete({ where: { id: existing.id } });
      }
      row = null;
    } else {
      row = await this.prisma.variantPriceOverride.upsert({
        where: {
          cardId_productType_gradeKey_finish: { cardId: card.id, productType, gradeKey, finish },
        },
        create: { cardId: card.id, productType, gradeKey, finish, ...next, updatedBy: actorUserId },
        update: { ...next, updatedBy: actorUserId },
      });
    }

    // ---- Auditoría (before/after; contrato: action=pricing.variant_controls) ----
    await this.audit.log({
      actorUserId,
      action: 'pricing.variant_controls',
      entityType: 'VariantPriceOverride',
      entityId: row?.id ?? existing?.id,
      before: { cardId: card.id, productType, gradeKey, finish, controls: snapshot(existing) },
      after: { cardId: card.id, productType, gradeKey, finish, controls: snapshot(row) },
    });

    // ---- Estado RESUELTO tras el write (mismo DTO que lee el binder, §DTOs) ----
    const pricing = await this.resolvePricing(card, productType, gradeKey, finish, row);
    return { cardId: card.id, productType, gradeKey, finish, pricing };
  }

  /**
   * gradeKey canónico de `buildGradeKey` por productType (§4.26a):
   *  - raw    → `raw:NM` (único valor: el marketplace opera raw SOLO en NM, §3.5) + el `:finish`
   *             debe pertenecer a `Card.availableFinishes` (SEC-A1 → 422 FINISH_NOT_AVAILABLE).
   *  - graded → `graded:<company>:<grade>` (obligatorio, forma validada) y `finish` = `normal`
   *             (el acabado no aplica; paridad con PriceReference).
   */
  private resolveGradeKey(
    card: Card,
    productType: ProductType,
    finish: Finish,
    gradeKeyInput: unknown,
  ): string {
    if (gradeKeyInput !== undefined && typeof gradeKeyInput !== 'string') {
      throw invalid('gradeKey must be a string', { field: 'gradeKey' });
    }
    if (productType === 'raw') {
      const gradeKey = (gradeKeyInput as string | undefined) ?? 'raw:NM';
      if (gradeKey !== 'raw:NM') {
        throw invalid(`gradeKey for raw must be 'raw:NM'`, { field: 'gradeKey', value: gradeKey });
      }
      const available = ((card.availableFinishes ?? []) as Finish[]);
      const whitelist = available.length > 0 ? available : (['normal'] as Finish[]);
      if (!whitelist.includes(finish)) {
        throw BusinessException.validation(
          'FINISH_NOT_AVAILABLE',
          `Finish '${finish}' is not available for this card`,
          { finish, availableFinishes: whitelist },
        );
      }
      return gradeKey;
    }
    // graded
    if (finish !== 'normal') {
      throw invalid(`finish must be 'normal' for productType=graded`, { field: 'finish', value: finish });
    }
    const gradeKey = gradeKeyInput as string | undefined;
    if (!gradeKey || !/^graded:[^:]+:[^:]+$/.test(gradeKey)) {
      throw invalid(`gradeKey for graded must have the form 'graded:<company>:<grade>'`, {
        field: 'gradeKey',
        value: gradeKey ?? null,
      });
    }
    return gradeKey;
  }

  /** Merge de un campo de centavos: omitido = conserva; null = limpia; número = valida > 0 Int. */
  private mergeCents(
    field: 'sellOverrideCents' | 'buyOverrideCents',
    input: VariantControlsInput,
    current: number | null,
  ): number | null {
    if (!(field in input) || input[field] === undefined) return current;
    const value = input[field];
    if (value === null) return null;
    return assertCents(field, value);
  }

  /**
   * Merge + validaciones del bloque `bounty` (P-22; aquí solo persistencia + invariantes de
   * captura — la vitrina pública y el conteo al pagar son de la fase P-22):
   *  - omitido → no tocar; `null` → APAGA (enabled=false) sin borrar el contador;
   *  - objeto → solo `productType=raw` (la vitrina pública es de sueltas, §4.26a);
   *    `enabled:true` exige precio efectivo > 0 (BOUNTY_PRICE_REQUIRED) y ≥ sugerido de compra por
   *    regla del momento cuando el sugerido resuelve (BOUNTY_BELOW_RULE; pending ⇒ se acepta);
   *    `targetQty` ≥ 1, `null` = sin objetivo (no se auto-apaga).
   *  - Al (re)ENCENDER se limpia `bountyCompletedAt` (un bounty re-armado ya no está "completado";
   *    el contador `bountyAcquiredQty` SÍ se conserva — doctrina "apagar no borra el contador").
   */
  private async mergeBounty(
    next: {
      bountyEnabled: boolean;
      bountyPriceCents: number | null;
      bountyTargetQty: number | null;
      bountyAcquiredQty: number;
      bountyCompletedAt: Date | null;
    },
    input: VariantControlsInput,
    card: Card,
    productType: ProductType,
    finish: Finish,
  ): Promise<void> {
    if (!('bounty' in input) || input.bounty === undefined) return;
    const bounty = input.bounty;
    if (bounty === null) {
      next.bountyEnabled = false; // apaga sin borrar contador/precio/objetivo (equivale a enabled:false)
      return;
    }
    if (typeof bounty !== 'object' || Array.isArray(bounty)) {
      throw invalid('bounty must be an object or null', { field: 'bounty' });
    }
    if (productType !== 'raw') {
      // Un bounty graded sería invisible en la vitrina pública (incoherente); sell/buy en graded SÍ aplican.
      throw invalid('bounty is only supported for productType=raw', { field: 'bounty', productType });
    }
    const b = bounty as { enabled?: unknown; priceCents?: unknown; targetQty?: unknown };
    if (typeof b.enabled !== 'boolean') {
      throw invalid('bounty.enabled must be a boolean', { field: 'bounty.enabled' });
    }
    if (b.priceCents !== undefined) {
      next.bountyPriceCents = assertCents('bounty.priceCents', b.priceCents);
    }
    if (b.targetQty !== undefined) {
      if (b.targetQty === null) {
        next.bountyTargetQty = null; // sin objetivo: solo contador, nunca auto-off
      } else if (typeof b.targetQty !== 'number' || !Number.isInteger(b.targetQty) || b.targetQty < 1) {
        throw invalid('bounty.targetQty must be an integer >= 1 or null', {
          field: 'bounty.targetQty',
          value: b.targetQty,
        });
      } else {
        next.bountyTargetQty = b.targetQty;
      }
    }

    if (!b.enabled) {
      next.bountyEnabled = false;
      return;
    }

    // enabled:true — precio SIEMPRE explícito (> 0), jamás calculado.
    if (next.bountyPriceCents == null || next.bountyPriceCents <= 0) {
      throw BusinessException.validation(
        'BOUNTY_PRICE_REQUIRED',
        'bounty.priceCents (> 0) is required when enabling a bounty',
      );
    }
    // Gate contra la regla del momento: si el sugerido de compra RESUELVE y el bounty queda por
    // debajo, no es bounty (BOUNTY_BELOW_RULE). Sugerido pending ⇒ se acepta (precio explícito:
    // es exactamente el caso donde más se necesita).
    const { rules, fallbackPct } = await this.pricing.loadBuylistRules();
    const ref = await this.pricing.getReference(card.id, productType, 'raw:NM', finish);
    const referenceMxnCents =
      ref.status === 'priced' && ref.referenceMxnCents != null ? ref.referenceMxnCents : null;
    const suggested = quoteAcquisitionForFinish(card.rarity, finish, referenceMxnCents, rules, fallbackPct);
    if (suggested.quotedPriceCents != null && next.bountyPriceCents < suggested.quotedPriceCents) {
      throw BusinessException.validation(
        'BOUNTY_BELOW_RULE',
        'bounty.priceCents must be >= the suggested buylist price for this variant',
        { suggestedCents: suggested.quotedPriceCents, priceCents: next.bountyPriceCents },
      );
    }
    if (!next.bountyEnabled) next.bountyCompletedAt = null; // re-armado: ya no está "completado"
    next.bountyEnabled = true;
  }

  /** Estado resuelto de la consola tras el write (reglas + referencia + fila nueva → DTO). */
  private async resolvePricing(
    card: Card,
    productType: ProductType,
    gradeKey: string,
    finish: Finish,
    row: VariantPriceOverride | null,
  ): Promise<VariantPricingDTO> {
    const buy = await this.pricing.loadBuylistRules();
    const sell = await this.pricing.loadSalesRules();
    const ref = await this.pricing.getReference(card.id, productType, gradeKey, finish);
    const referenceMxnCents =
      ref.status === 'priced' && ref.referenceMxnCents != null ? ref.referenceMxnCents : null;
    return composeVariantPricing(card.rarity, finish, referenceMxnCents, { buy, sell }, row);
  }
}
