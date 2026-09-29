import { Injectable } from '@nestjs/common';
import { Card, Finish, ProductType, VariantPriceOverride } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/business.exception';
import { MAX_CENTS, quoteAcquisitionFromCurve } from '../../common/money';
import { isBountyEffective } from '../../common/pricing-curve';
import { AuditService } from '../audit/audit.service';
import { PricingService } from './pricing.service';
import { VariantPricingDTO, composeVariantPricing, resolveMarketReference } from './variant-pricing';

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

/**
 * v1.51.2 · **D35 — el objetivo por defecto de un bounty nuevo: DOS.**
 *
 * No es un número técnico: es la **política que fijó el dueño** (*«hasta tener 2 en inventario»*,
 * `PROJECT.md` §P / contrato §M2). Contesta **una sola** entrada —la **omisión** sobre una fila que
 * no tenía objetivo—; **jamás** un `null` explícito, que es una respuesta distinta (`422
 * BOUNTY_TARGET_REQUIRED`). *Un default es para «no lo dije», no para «dije que ninguno».*
 *
 * ⚠️ **Tiene un gemelo en SQL y no se pueden importar entre sí:** el backfill de M-46
 * (`prisma/migrations/20260901120000_m46_buylist_acquisition_cycle/migration.sql`, bloque 9) rellena
 * con **2** los bounties vivos sin meta. Si esta política cambia, **los dos sitios cambian**: el de
 * aquí para las filas nuevas y —solo si el dueño quiere reescribir historia— una migración nueva.
 * Una migración ya aplicada **no se edita** (rompe su checksum).
 */
const BOUNTY_DEFAULT_TARGET_QTY = 2;

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
    // v2.2 (Q2, §M2-B.9): el sello que distingue `despublicada` de `apagada`. Viaja en el before/after
    // de auditoría para que la pre-imagen del borrado/despublicado se pueda reconstruir.
    bountyUnpublishedAt: row.bountyUnpublishedAt ? row.bountyUnpublishedAt.toISOString() : null,
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
      // v2.2 (Q2, §M2-B.9): omitido conserva; re-publicar (enabled:true) lo LIMPIA en `mergeBounty`.
      bountyUnpublishedAt: existing?.bountyUnpublishedAt ?? null,
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
      next.bountyCompletedAt == null &&
      // v2.2 (Q2): una fila DESPUBLICADA nunca es «vacía» (siempre trae historia); el guard es
      // explícito para que el sello no pueda quedar huérfano en una fila que se borra por lo demás.
      next.bountyUnpublishedAt == null;

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
   * DELETE /admin/pricing/variant-controls/:cardId/:finish/bounty — **ELIMINAR un bounty** (Q2, v2.2,
   * `super_admin`, AUDITADO). Contrato §M2-B.9 / ARCHITECTURE §4.36.6b.
   *
   * **El SERVIDOR ramifica por historia de compra, no el cliente** (el cliente pide *eliminar*, el
   * servidor elige *borrar* o *despublicar*):
   *  - **Rama A · BORRAR** (`bountyAcquiredQty===0 ∧ bountyCompletedAt==null`, nunca se compró nada):
   *    limpia TODOS los campos de bounty; si la fila queda sin `sellOverrideCents`/`buyOverrideCents`
   *    se **borra físicamente** (reusa la lógica de fila-vacía del `update`). AuditLog `bounty.deleted`.
   *  - **Rama B · DESPUBLICAR** (`acquiredQty>0 ∨ completedAt!=null`, ya se compró algo): **conserva**
   *    `priceCents`/`targetQty`/`acquiredQty`/`completedAt`, pone `enabled=false` +
   *    `bountyUnpublishedAt=now()` (estado derivado `despublicada`). AuditLog `bounty.unpublished`.
   *
   * ⛔ Acotado al sub-recurso `bounty`: **NO toca** `sellOverrideCents`/`buyOverrideCents` (mutación
   * B-20). **NO toca `InventoryItem` ni el P/L** — el costo vive una sola vez en inventario
   * (INV-BOUNTY-COST, §M2-B.10 / mutación B-21): la tx escribe SOLO `VariantPriceOverride` + `AuditLog`.
   * Idempotente en la rama B (una fila ya `despublicada` ⇒ no-op, `200`).
   */
  async deleteBounty(
    cardIdParam: string,
    finishParam: string,
    actorUserId: string,
  ): Promise<VariantControlsResponse> {
    // ---- Identidad (bounty es raw-only; `resolveGradeKey` valida FINISH_NOT_AVAILABLE + raw:NM) ----
    if (!FINISH_VALUES.includes(finishParam as Finish)) {
      throw invalid(`invalid finish '${finishParam}'`, { field: 'finish', allowed: FINISH_VALUES });
    }
    const finish = finishParam as Finish;
    const productType: ProductType = 'raw';

    const card = await this.prisma.card.findUnique({ where: { id: cardIdParam } });
    if (!card) throw BusinessException.notFound('NOT_FOUND', 'Card not found');

    const gradeKey = this.resolveGradeKey(card, productType, finish, undefined);

    const existing = await this.prisma.variantPriceOverride.findUnique({
      where: { cardId_productType_gradeKey_finish: { cardId: card.id, productType, gradeKey, finish } },
    });

    // ---- ¿Hay bounty EN ALCANCE? (§M2-B.0: historia de bounty) ----
    const inScope =
      existing != null &&
      (existing.bountyEnabled ||
        existing.bountyPriceCents != null ||
        existing.bountyCompletedAt != null ||
        existing.bountyAcquiredQty > 0 ||
        existing.bountyUnpublishedAt != null);
    if (!existing || !inScope) {
      throw BusinessException.notFound('BOUNTY_NOT_FOUND', 'This variant has no bounty to delete');
    }

    // ---- Idempotencia de la rama B: una fila YA despublicada ⇒ no-op, sigue `despublicada` ----
    if (existing.bountyUnpublishedAt != null) {
      const pricing = await this.resolvePricing(card, productType, gradeKey, finish, existing);
      return { cardId: card.id, productType, gradeKey, finish, pricing };
    }

    const hasHistory = existing.bountyAcquiredQty > 0 || existing.bountyCompletedAt != null;
    const hasOtherOverrides = existing.sellOverrideCents != null || existing.buyOverrideCents != null;

    // ---- La escritura + su auditoría, en UNA transacción (aislamiento INV-BOUNTY-COST) ----
    let row: VariantPriceOverride | null = null;
    await this.prisma.$transaction(async (tx) => {
      if (!hasHistory) {
        // Rama A · BORRAR: limpia todos los campos de bounty. Si no quedan overrides, borra la fila.
        if (hasOtherOverrides) {
          row = await tx.variantPriceOverride.update({
            where: { id: existing.id },
            data: {
              bountyEnabled: false,
              bountyPriceCents: null,
              bountyTargetQty: null,
              bountyAcquiredQty: 0,
              bountyCompletedAt: null,
              bountyUnpublishedAt: null,
              updatedBy: actorUserId,
            },
          });
        } else {
          await tx.variantPriceOverride.delete({ where: { id: existing.id } });
          row = null;
        }
        await this.audit.log(
          {
            actorUserId,
            action: 'bounty.deleted',
            entityType: 'VariantPriceOverride',
            entityId: existing.id,
            before: { cardId: card.id, productType, gradeKey, finish, controls: snapshot(existing) },
            after: { cardId: card.id, productType, gradeKey, finish, controls: snapshot(row) },
          },
          tx,
        );
      } else {
        // Rama B · DESPUBLICAR: conserva el registro/historia; apaga + sella `bountyUnpublishedAt`.
        row = await tx.variantPriceOverride.update({
          where: { id: existing.id },
          data: { bountyEnabled: false, bountyUnpublishedAt: new Date(), updatedBy: actorUserId },
        });
        await this.audit.log(
          {
            actorUserId,
            action: 'bounty.unpublished',
            entityType: 'VariantPriceOverride',
            entityId: existing.id,
            before: { cardId: card.id, productType, gradeKey, finish, controls: snapshot(existing) },
            after: { cardId: card.id, productType, gradeKey, finish, controls: snapshot(row) },
          },
          tx,
        );
      }
    });

    // ---- Estado RESUELTO tras el borrado/despublicado (mismo DTO que lee el binder) ----
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
   *  - Al (re)ENCENDER se limpia `bountyCompletedAt` (un bounty re-armado ya no está "completado";
   *    el contador `bountyAcquiredQty` SÍ se conserva — doctrina "apagar no borra el contador").
   *
   * ### ⚠️ v1.54 · B-2 — **EL OBJETIVO DE UN BOUNTY VIVO ES OBLIGATORIO** (D32 + D35, contrato §M2)
   * Faltaba entero: `targetQty: null` se escribía tal cual y el bounty quedaba **vivo y sin techo**
   * —la mesa de decisión jamás pintaba «no comprar», acumulara las copias que acumulara—, que es
   * exactamente el agujero que D32 cerró. El backfill de M-46 limpió el **histórico**; esto cierra la
   * **puerta**. La tabla del contrato, entera:
   *
   * | `targetQty` con `enabled:true` | Resultado |
   * |---|---|
   * | **omitido**, fila SIN objetivo previo | **2** (`BOUNTY_DEFAULT_TARGET_QTY`) |
   * | **omitido**, fila CON objetivo previo | se conserva (*omitido no se toca*) |
   * | entero **≥ 1** | ese valor |
   * | **`null` explícito** | **422 `BOUNTY_TARGET_REQUIRED`** |
   * | `0`, negativo o no entero | **422 `BOUNTY_TARGET_REQUIRED`** |
   *
   * **La forma del código sigue a la del contrato, no al revés:** el error dispara *«exactamente
   * cuando la petición dejaría un bounty vivo sin objetivo válido»*, así que **se evalúa sobre el
   * ESTADO RESULTANTE** (`next`) y **después** de conocer `enabled`, igual que su hermano
   * `BOUNTY_PRICE_REQUIRED`. Por eso la aplicación del valor (forma) y la exigencia de que exista
   * (regla) están separadas: con `enabled:false` un `null` **sigue limpiando** —no hay bounty vivo
   * que proteger— y solo el valor **imposible** (`0`, negativo, no entero) queda como error de forma.
   */
  private async mergeBounty(
    next: {
      bountyEnabled: boolean;
      bountyPriceCents: number | null;
      bountyTargetQty: number | null;
      bountyAcquiredQty: number;
      bountyCompletedAt: Date | null;
      bountyUnpublishedAt: Date | null;
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
    // (1) FORMA — se aplica lo que trae la petición. Todavía NO se juzga si basta: eso depende de
    //     `enabled`, que se lee abajo. `null` LIMPIA (regla del endpoint) y un valor IMPOSIBLE no se
    //     escribe nunca; se recuerda para que la rama de `enabled` le ponga el código que le toca.
    let targetMalformed = false;
    if (b.targetQty !== undefined) {
      if (b.targetQty === null) {
        next.bountyTargetQty = null;
      } else if (typeof b.targetQty !== 'number' || !Number.isInteger(b.targetQty) || b.targetQty < 1) {
        targetMalformed = true;
      } else {
        next.bountyTargetQty = b.targetQty;
      }
    }

    if (!b.enabled) {
      // Apagado: no hay bounty vivo cuyo techo proteger ⇒ `BOUNTY_TARGET_REQUIRED` NO aplica (su
      // condición es literalmente «bounty vivo sin objetivo»). Un valor imposible sigue siendo un
      // error de FORMA: `0` no es una meta, ni siquiera para un bounty apagado.
      if (targetMalformed) {
        throw invalid('bounty.targetQty must be an integer >= 1 or null', {
          field: 'bounty.targetQty',
          value: b.targetQty,
        });
      }
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
    // (2) REGLA — enabled:true ⇒ objetivo OBLIGATORIO (D32/D35). El default de D35 **solo** contesta
    //     la omisión, y solo cuando no hay nada que conservar: *«no lo dije»* tiene respuesta de
    //     producto, *«dije que ninguno»* no — convertir un `null` explícito en un `2` respondería una
    //     pregunta distinta de la que hizo el cliente de la API, y en la única dirección que reabre
    //     el agujero.
    if (b.targetQty === undefined && next.bountyTargetQty == null) {
      next.bountyTargetQty = BOUNTY_DEFAULT_TARGET_QTY;
    }
    // El predicado es sobre el ESTADO RESULTANTE, no sobre el input: así cubre de una vez el `null`
    // explícito, el valor imposible y —fail-safe— una fila LEGACY con un objetivo inválido que se
    // re-enciende sin mandar `targetQty`. *Se prohíbe el estado, no la forma de llegar a él.*
    if (targetMalformed || next.bountyTargetQty == null || next.bountyTargetQty < 1) {
      throw BusinessException.validation(
        'BOUNTY_TARGET_REQUIRED',
        'bounty.targetQty (integer >= 1) is required when enabling a bounty',
        { field: 'bounty.targetQty', ...(b.targetQty !== undefined ? { value: b.targetQty } : {}) },
      );
    }
    // v2.2 (Q1, §M2-B.8 / §4.36.6) — GATE «CREAR/EDITAR» del bounty contra el PISO EFECTIVO
    // `min(curva, mercado)`. Se llama a la MISMA `isBountyEffective` que la cotización, la vitrina y el
    // estado de la consola: el `422 BOUNTY_BELOW_RULE` dispara IFF `isBountyEffective(...) === false`,
    // así la coherencia alta↔runtime es POR CONSTRUCCIÓN (⛔ prohibido re-derivar el gate con `<`/`<=`
    // a mano — es la mutación B-16). En el tramo normal (`curva < mercado`) sigue exigiendo `> curva`
    // (empate-con-curva rechazado); en el borde (`curva ≥ mercado`) basta IGUALAR el mercado
    // (empate-con-mercado aceptado), que es lo único que impide forzar un precio > mercado. Curva
    // `pending` (⇒ mercado null) ⇒ se ACEPTA: el bounty es precio explícito y es donde más se necesita.
    const curve = await this.pricing.loadPricingCurve();
    const ref = await this.pricing.getReference(card.id, productType, 'raw:NM', finish);
    // v1.62.2: MISMO estrechamiento money-safe que emite `market` (`resolveMarketReference`), para que
    // el gate del alta y la respuesta resuelta no puedan mirar dos mercados distintos.
    const referenceMxnCents = resolveMarketReference(ref).referenceMxnCents;
    // Una sola llamada devuelve `curveQuoteCents` Y `marketMxnCents` (§4.36.6): los dos que el gate y
    // su `details` necesitan, del mismo cuerpo que corre en runtime.
    const acq = quoteAcquisitionFromCurve(referenceMxnCents, curve);
    if (!isBountyEffective(next.bountyPriceCents, acq.curveQuoteCents, acq.marketMxnCents)) {
      throw BusinessException.validation(
        'BOUNTY_BELOW_RULE',
        'bounty.priceCents must beat the effective floor min(curve, market) for this variant',
        { curveQuoteCents: acq.curveQuoteCents, marketMxnCents: acq.marketMxnCents, priceCents: next.bountyPriceCents },
      );
    }
    if (!next.bountyEnabled) next.bountyCompletedAt = null; // re-armado: ya no está "completado"
    next.bountyEnabled = true;
    // v2.2 (Q2, §M2-B.9): (re)publicar LIMPIA el sello de despublicación (vuelve a la vitrina y al
    // tablero). ⚠️ NO reinicia `bountyAcquiredQty`/`bountyCompletedAt` — no se borra historia de dinero.
    next.bountyUnpublishedAt = null;
  }

  /** Estado resuelto de la consola tras el write (reglas + referencia + fila nueva → DTO). */
  private async resolvePricing(
    card: Card,
    productType: ProductType,
    gradeKey: string,
    finish: Finish,
    row: VariantPriceOverride | null,
  ): Promise<VariantPricingDTO> {
    // v2.0 (P-48, §4.36.2): UN solo lector de la curva para los dos ejes.
    const curve = await this.pricing.loadPricingCurve();
    const ref = await this.pricing.getReference(card.id, productType, gradeKey, finish);
    // v1.62.2 (B-14(d)): la `PriceInfo` entera al composer — el mismo cuerpo, y por tanto el mismo
    // `market`, que devuelven el binder y la consola para esta variante.
    return composeVariantPricing(ref, curve, row, card.rarityCanonical ?? card.rarity);
  }
}
