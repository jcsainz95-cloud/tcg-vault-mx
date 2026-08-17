import { Injectable } from '@nestjs/common';
import { Card, Finish, InventoryStatus, MovementReason, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/business.exception';
import { PricingService } from '../pricing/pricing.service';
import { SettingsService } from '../settings/settings.service';
import { SettingKey } from '../settings/settings.constants';
import { computeAportacionCostCents, computeSalePriceForRarity } from '../../common/money';
import {
  BatchCreateInventoryRequest,
  BatchInventoryItemInput,
  BulkPublishRequest,
  CreateItemDto,
  CreateLocationDto,
  MarkItemDto,
  MoveItemDto,
  UpdateItemDto,
} from './dto/inventory.dto';

/** Resultado por línea del alta por lote (API_CONTRACT §DTOs — BatchInventoryLineResult). */
type BatchLineResult =
  | { index: number; ok: true; folios: string[]; inventoryItemIds: string[]; acquisitionCostCents?: number }
  | { index: number; ok: false; error: { code: string; message: string } };

export interface BatchCreateInventoryResponse {
  batchKey: string;
  idempotentReplay: boolean;
  summary: { requested: number; createdItems: number; failedLines: number };
  results: BatchLineResult[];
}

/** Resultado por línea de la publicación por lote (API_CONTRACT §DTOs — BulkPublishLineResult). */
type BulkPublishLineResult =
  | {
      index: number;
      inventoryItemId: string;
      ok: true;
      status: 'listed';
      salePriceCents: number;
      priceSource: 'manual' | 'derived';
    }
  | { index: number; inventoryItemId: string; ok: false; error: { code: string; message: string } };

export interface BulkPublishResponse {
  summary: { requested: number; published: number; failedLines: number };
  results: BulkPublishLineResult[];
}

/**
 * [MONEY · WS-E] Allowlist de status de ORIGEN seguros para publicar a `listed`.
 *
 * SOLO se puede forzar `status → 'listed'` una pieza que HOY esté en un status seguro. El checkout
 * reserva por `status IN ('listed','in_stock')` (orders.service.ts) → si dejáramos re-publicar una
 * pieza `reserved` (orden con PaymentIntent vivo), `in_custody`/`picking`/`shipped`/`delivered` (ya
 * de un cliente), `lost`/`damaged` (sin existencia física real) o `withdrawn`, un segundo checkout la
 * reservaría para OTRO comprador → **double-sell / inventario fantasma** (dos clientes por una pieza).
 *
 * `in_stock` → se publica. `listed` → **no-op idempotente** (ya publicada). Cualquier otro status →
 * `ITEM_NOT_PUBLISHABLE` por-línea (no tumba el resto del lote). El status es del `InventoryItem` en
 * BD (server-side), nunca del DTO del cliente.
 *
 * NOTA (arquitecto): el contrato §M1 (WS-E, bulk-publish) debería especificar EXPLÍCITAMENTE el
 * conjunto de status de origen permitido; hoy solo describe el error `PRICE_PENDING` por-línea.
 */
const PUBLISHABLE_ORIGIN_STATUSES: ReadonlyArray<InventoryStatus> = ['in_stock', 'listed'];

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Alta de item (M1). Folio legible INV-000123 (secuencia). Para aportación en
   * especie: costo = referencia del día × pct (default 70). Si no hay referencia
   * → 422 PRICE_PENDING + cola de precio pendiente (nunca se descarta).
   */
  async createItem(dto: CreateItemDto, actorUserId: string) {
    const r = await this.resolveCreation(dto);

    // v1.1: sellado = precio SIEMPRE manual (MXN). Obligatorio para PUBLICAR: sin
    // listPriceCents el sellado queda "precio pendiente" (no aparece en Compra). Se escala
    // a la cola de precio pendiente para que el dueño lo fije (regla transversal).
    if (r.sealedNeedsEscalate) {
      await this.pricing.escalatePending(
        dto.cardId,
        dto.productType,
        r.gradeKey,
        'inventory',
        undefined,
        r.finish,
      );
    }

    const folio = await this.prisma.nextFolio();
    const item = await this.prisma.inventoryItem.create({
      data: this.buildItemData(dto, r, folio),
    });
    await this.prisma.inventoryMovement.create({
      data: {
        itemId: item.id,
        toLocationId: dto.locationId,
        toStatus: 'in_stock',
        reason: MovementReason.alta,
        actorUserId,
        note: dto.acquisitionType,
      },
    });
    return { id: item.id, folio: item.folio, status: item.status, acquisitionCostCents: r.acquisitionCostCents };
  }

  /**
   * v1.16-master-set — resuelve/valida el alta de UNA línea (carta, shape por tipo, acabado, costo de
   * aportación) SIN escribir el item. Extraído de `createItem` para que el ALTA POR LOTE reuse
   * EXACTAMENTE la misma lógica (SEC-A1: costo de aportación derivado server-side). Lanza
   * BusinessException (NOT_FOUND / VALIDATION_ERROR / FINISH_NOT_AVAILABLE / PRICE_PENDING) sin crear
   * nada; para aportación sin referencia escala el pendiente (igual que antes) y lanza PRICE_PENDING.
   */
  private async resolveCreation(dto: CreateItemDto | BatchInventoryItemInput): Promise<{
    card: Card;
    finish: Finish;
    gradeKey: string;
    acquisitionCostCents: number | null;
    acquisitionPct: number | null;
    sealedNeedsEscalate: boolean;
  }> {
    const card = await this.prisma.card.findUnique({ where: { id: dto.cardId } });
    if (!card) throw BusinessException.notFound('NOT_FOUND', 'Card not found');

    // v1.1: validación por tipo de producto (excluye sellado de la lógica NM/rareza/grade).
    this.validateProductShape(dto);

    // v1.6-finish: el acabado aplica a raw/singles; graded/sealed = normal siempre (ARCHITECTURE §3.7).
    // Para raw se valida contra card.availableFinishes (SEC-A1); fuera de la lista → 422.
    const finish = this.resolveFinish(dto, card.availableFinishes as Finish[]);

    const gradeKey = this.pricing.gradeKeyFor(dto);
    let acquisitionCostCents =
      ('acquisitionCostCents' in dto ? dto.acquisitionCostCents : undefined) ?? null;
    let acquisitionPct = dto.acquisitionPct ?? null;

    if (dto.acquisitionType === 'aportacion_en_especie') {
      const pct = dto.acquisitionPct ?? (await this.settings.getNumber(SettingKey.APORTACION_PCT));
      // v1.6-finish: costo contra la referencia del ACABADO alta.
      const ref = await this.pricing.getReference(dto.cardId, dto.productType, gradeKey, finish);
      if (ref.status !== 'priced' || ref.referenceMxnCents == null) {
        // Tier 0 FIX: propaga el `finish` resuelto a la cola. Antes se omitía y el pendiente
        // quedaba en `normal` aunque el alta fuera holofoil (M-19: la cola es POR acabado).
        await this.pricing.escalatePending(
          dto.cardId,
          dto.productType,
          gradeKey,
          'inventory',
          undefined,
          finish,
        );
        throw BusinessException.validation(
          'PRICE_PENDING',
          'No reference price yet; escalated to pending queue',
        );
      }
      acquisitionPct = pct;
      acquisitionCostCents = computeAportacionCostCents(ref.referenceMxnCents, pct);
    }

    const sealedNeedsEscalate = dto.productType === 'sealed' && dto.listPriceCents == null;
    return { card, finish, gradeKey, acquisitionCostCents, acquisitionPct, sealedNeedsEscalate };
  }

  /** Data de creación de un InventoryItem (compartida por alta single/lote). */
  private buildItemData(
    dto: CreateItemDto | BatchInventoryItemInput,
    r: { finish: Finish; acquisitionCostCents: number | null; acquisitionPct: number | null },
    folio: string,
  ): Prisma.InventoryItemUncheckedCreateInput {
    return {
      folio,
      cardId: dto.cardId,
      productType: dto.productType,
      // raw solo NM (default NM); sellado/graded no llevan rawCondition.
      rawCondition: dto.productType === 'raw' ? (dto.rawCondition ?? 'NM') : null,
      finish: r.finish,
      sealedSubtype: dto.productType === 'sealed' ? (dto.sealedSubtype ?? null) : null,
      gradingCompany: dto.productType === 'graded' ? dto.gradingCompany : null,
      gradeValue: dto.productType === 'graded' ? dto.gradeValue : null,
      // v1.2 (M-12): certNumber solo para graded; null en raw/sealed.
      certNumber: dto.productType === 'graded' ? dto.certNumber : null,
      listPriceCents: dto.listPriceCents ?? null,
      locationId: dto.locationId,
      ownerType: 'platform',
      status: 'in_stock',
      acquisitionType: dto.acquisitionType,
      acquisitionPct: r.acquisitionPct,
      acquisitionCostCents: r.acquisitionCostCents,
      sourceSellRequestItemId:
        'sourceSellRequestItemId' in dto ? dto.sourceSellRequestItemId : undefined,
    };
  }

  /**
   * v1.16-master-set (§4.17b) — ALTA POR LOTE (carrito de captura). N líneas en 1 request con:
   *  - **errores por-línea** (una línea inválida NO tumba las demás; commit parcial → HTTP 200);
   *  - **`qty`** (default 1) atajo que expande a N InventoryItem (N folios) para bulk raw/sellado;
   *    `graded` fuerza 1 (cada slab es único por certNumber; qty>1 → VALIDATION_ERROR);
   *  - folios **consecutivos** por línea vía `PrismaService.nextFolios(qty)` (1 reserva de secuencia);
   *  - **idempotencia + auditoría** por `batchKey` en `InventoryBatch`: un replay devuelve el resultado
   *    guardado (`idempotentReplay:true`) SIN re-crear.
   */
  async batchCreate(
    req: BatchCreateInventoryRequest,
    actorUserId: string,
  ): Promise<BatchCreateInventoryResponse> {
    // Fast-path replay: si el batchKey YA está persistido (committed) con su resultado, repetirlo
    // sin re-crear. Las filas no committeadas de una corrida concurrente en vuelo NO son visibles
    // aquí (READ COMMITTED), así que este check nunca ve un claim a medias.
    const existing = await this.prisma.inventoryBatch.findUnique({ where: { id: req.batchKey } });
    if (existing) return this.replayBatch(req.batchKey, existing);

    // [SEC-N2 / BE-34] Atomicidad + idempotencia. TODO el lote (claim del InventoryBatch + N
    // InventoryItem + movimientos + resultado) corre en UNA transacción:
    //  (a) CONCURRENCIA: el claim `inventoryBatch.create({ id: batchKey })` va PRIMERO dentro de la
    //      tx; su unique constraint (id = batchKey) es la guardia. Dos requests con el mismo batchKey
    //      → uno commitea, el otro choca con P2002 → se trata como replay (NO duplica inventario).
    //  (b) CRASH-SAFETY: un crash a mitad hace rollback del claim Y de los items → sin huérfanos; el
    //      replay re-hace el lote limpio (antes: items creados sin batch → replay los duplicaba).
    try {
      const { summary, results } = await this.prisma.$transaction(async (tx) => {
        // Claim atómico primero (guardia de concurrencia). resultJson placeholder; se finaliza abajo.
        await tx.inventoryBatch.create({
          data: {
            id: req.batchKey,
            actorUserId,
            kind: 'create',
            requested: req.items.length,
            createdItems: 0,
            failedLines: 0,
            resultJson: {} as unknown as Prisma.InputJsonValue,
          },
        });

        const results: BatchLineResult[] = [];
        let createdItems = 0;
        for (let index = 0; index < req.items.length; index++) {
          const line = req.items[index];
          try {
            // graded → cada slab es único (certNumber); qty>1 no tiene sentido → VALIDATION_ERROR.
            const qty = line.qty ?? 1;
            if (line.productType === 'graded' && qty > 1) {
              throw BusinessException.validation(
                'VALIDATION_ERROR',
                'graded items cannot have qty > 1',
              );
            }
            const r = await this.resolveCreation(line);
            if (r.sealedNeedsEscalate) {
              await this.pricing.escalatePending(
                line.cardId,
                line.productType,
                r.gradeKey,
                'inventory',
                undefined,
                r.finish,
              );
            }
            const folios = await this.prisma.nextFolios(qty);
            const inventoryItemIds: string[] = [];
            for (const folio of folios) {
              const item = await tx.inventoryItem.create({
                data: this.buildItemData(line, r, folio),
              });
              await tx.inventoryMovement.create({
                data: {
                  itemId: item.id,
                  toLocationId: line.locationId,
                  toStatus: 'in_stock',
                  reason: MovementReason.alta,
                  actorUserId,
                  note: line.acquisitionType,
                },
              });
              inventoryItemIds.push(item.id);
              createdItems++;
            }
            results.push({
              index,
              ok: true,
              folios,
              inventoryItemIds,
              acquisitionCostCents: r.acquisitionCostCents ?? undefined,
            });
          } catch (e) {
            const err = e as BusinessException;
            results.push({
              index,
              ok: false,
              error: { code: err.code ?? 'VALIDATION_ERROR', message: err.message ?? 'error' },
            });
          }
        }

        const summary = {
          requested: req.items.length,
          createdItems,
          failedLines: results.filter((r) => !r.ok).length,
        };
        // Finaliza el claim con el resultado real (idempotencia + auditoría del lote).
        await tx.inventoryBatch.update({
          where: { id: req.batchKey },
          data: {
            createdItems: summary.createdItems,
            failedLines: summary.failedLines,
            resultJson: { summary, results } as unknown as Prisma.InputJsonValue,
          },
        });
        return { summary, results };
      });
      return { batchKey: req.batchKey, idempotentReplay: false, summary, results };
    } catch (e) {
      // P2002 en el claim = otra corrida ganó la carrera por este batchKey → replay (no duplica).
      if ((e as { code?: string })?.code === 'P2002') {
        const claimed = await this.prisma.inventoryBatch.findUnique({
          where: { id: req.batchKey },
        });
        if (claimed) return this.replayBatch(req.batchKey, claimed);
        // Carrera extrema (la ganadora aún no commitea su claim visible): pide reintento.
        throw BusinessException.conflict('CONFLICT', 'batch is being processed; retry');
      }
      throw e;
    }
  }

  /** Reconstruye la respuesta idempotente desde el InventoryBatch persistido. */
  private replayBatch(
    batchKey: string,
    existing: { resultJson: unknown },
  ): BatchCreateInventoryResponse {
    const stored = existing.resultJson as {
      summary: BatchCreateInventoryResponse['summary'];
      results: BatchLineResult[];
    };
    return {
      batchKey,
      idempotentReplay: true,
      summary: stored.summary,
      results: stored.results,
    };
  }

  /**
   * v1.16-master-set (§4.17b) — PUBLICAR POR LOTE (varias piezas → `listed`). Por línea:
   *  - `listPriceCents` presente → override manual; ausente → precio de venta **derivado** server-side
   *    de las reglas por rareza+acabado (§4.14, SEC-A1) reusando `computeSalePriceForRarity`.
   *  - Una pieza cuyo precio NO se resuelve (`pct` sin market) → `PRICE_PENDING`, NO se publica
   *    (regla "solo se lista lo que tiene precio", §4.9). Sellado sin override → `PRICE_PENDING`.
   *  - **Errores por-línea** (no encontrada, no `platform`, graded sin certNumber, precio pendiente)
   *    no tumban las demás → HTTP 200. Re-publicar una `listed` = no-op idempotente (`ok:true`).
   *  - Pago mínimo de BE-25: iza `SALES_PRICE_RULES`+fallback UNA vez y usa `getReferencesBatch` (1
   *    lote de referencias) — sin N+1 de settings ni de referencias.
   */
  async bulkPublish(req: BulkPublishRequest, actorUserId: string): Promise<BulkPublishResponse> {
    // Idempotencia opcional del lote (si trae batchKey) — replay devuelve lo guardado.
    if (req.batchKey) {
      const existing = await this.prisma.inventoryBatch.findUnique({ where: { id: req.batchKey } });
      if (existing) {
        const stored = existing.resultJson as unknown as BulkPublishResponse;
        return stored;
      }
    }

    const ids = req.items.map((i) => i.inventoryItemId);
    const items = await this.prisma.inventoryItem.findMany({
      where: { id: { in: ids } },
      include: { card: true },
    });
    const byId = new Map(items.map((i) => [i.id, i]));

    // Pago mínimo BE-25: reglas de venta izadas UNA vez + referencias en 1 lote (sin N+1).
    const { rules, fallbackPct } = await this.pricing.loadSalesRules();
    const derivable = items
      .filter((i) => i.listPriceCents == null)
      .map((i) => ({
        cardId: i.cardId,
        productType: i.productType,
        gradeKey: this.pricing.gradeKeyFor(i),
        finish: i.finish,
      }));
    const refs = await this.pricing.getReferencesBatch(derivable);

    const results: BulkPublishLineResult[] = [];
    let published = 0;
    for (let index = 0; index < req.items.length; index++) {
      const line = req.items[index];
      const item = byId.get(line.inventoryItemId);
      try {
        if (!item) throw BusinessException.notFound('NOT_FOUND', 'Inventory item not found');
        if (item.ownerType !== 'platform') {
          throw BusinessException.validation('VALIDATION_ERROR', 'item is not platform inventory');
        }
        // [MONEY · WS-E] Guarda por status de ORIGEN (anti-double-sell). SOLO {in_stock, listed}
        // son seguras: publicar una reserved/in_custody/lost/damaged/... a `listed` la re-abriría a
        // un segundo checkout → dos clientes por una pieza. Ver PUBLISHABLE_ORIGIN_STATUSES.
        if (!PUBLISHABLE_ORIGIN_STATUSES.includes(item.status)) {
          throw BusinessException.validation(
            'ITEM_NOT_PUBLISHABLE',
            `item status '${item.status}' cannot be published`,
            { status: item.status },
          );
        }
        if (
          item.productType === 'graded' &&
          (!item.certNumber || item.certNumber.trim() === '')
        ) {
          throw BusinessException.validation(
            'VALIDATION_ERROR',
            'graded items require certNumber to be published',
          );
        }

        let salePriceCents: number;
        let priceSource: 'manual' | 'derived';
        const manual = line.listPriceCents ?? item.listPriceCents;
        if (manual != null) {
          salePriceCents = manual;
          priceSource = 'manual';
        } else {
          // Derivado server-side (SEC-A1): rareza de Card.rarity, acabado de InventoryItem.finish.
          const gradeKey = this.pricing.gradeKeyFor(item);
          const ref = refs.get(`${item.cardId}|${item.productType}|${gradeKey}|${item.finish}`);
          const refCents =
            ref && ref.status === 'priced' ? (ref.referenceMxnCents ?? null) : null;
          const sale = computeSalePriceForRarity(
            item.card.rarity,
            item.finish,
            refCents,
            rules,
            fallbackPct,
          );
          if (sale.salePriceCents == null) {
            throw BusinessException.validation(
              'PRICE_PENDING',
              'No resolvable sale price (pct without market); not published',
            );
          }
          salePriceCents = sale.salePriceCents;
          priceSource = 'derived';
        }

        // status → listed. Re-publicar una `listed` = no-op idempotente. Persiste el override manual.
        await this.prisma.inventoryItem.update({
          where: { id: item.id },
          data: {
            status: 'listed',
            ...(line.listPriceCents != null ? { listPriceCents: line.listPriceCents } : {}),
          },
        });
        published++;
        results.push({
          index,
          inventoryItemId: line.inventoryItemId,
          ok: true,
          status: 'listed',
          salePriceCents,
          priceSource,
        });
      } catch (e) {
        const err = e as BusinessException;
        results.push({
          index,
          inventoryItemId: line.inventoryItemId,
          ok: false,
          error: { code: err.code ?? 'VALIDATION_ERROR', message: err.message ?? 'error' },
        });
      }
    }

    const summary = {
      requested: req.items.length,
      published,
      failedLines: results.filter((r) => !r.ok).length,
    };
    const response: BulkPublishResponse = { summary, results };
    if (req.batchKey) {
      await this.prisma.inventoryBatch.create({
        data: {
          id: req.batchKey,
          actorUserId,
          kind: 'publish',
          requested: summary.requested,
          createdItems: summary.published,
          failedLines: summary.failedLines,
          resultJson: response as unknown as Prisma.InputJsonValue,
        },
      });
    }
    return response;
  }

  /**
   * v1.6-finish — resuelve/valida el acabado del alta (ARCHITECTURE §3.7):
   *  - graded/sealed → `normal` siempre (el acabado solo aplica a raw/singles).
   *  - raw → el finish del DTO (default normal), validado contra card.availableFinishes (SEC-A1);
   *    fuera de la lista → 422 FINISH_NOT_AVAILABLE.
   */
  private resolveFinish(
    dto: CreateItemDto | BatchInventoryItemInput,
    availableFinishes: Finish[],
  ): Finish {
    if (dto.productType !== 'raw') return 'normal';
    const f = dto.finish ?? 'normal';
    const available = availableFinishes ?? ['normal'];
    if (!available.includes(f)) {
      throw BusinessException.validation(
        'FINISH_NOT_AVAILABLE',
        `Finish '${f}' is not available for this card`,
        { finish: f, availableFinishes: available },
      );
    }
    return f;
  }

  /**
   * v1.1 — coherencia por tipo de producto. El sellado NO lleva condición/grade/rareza;
   * el raw solo NM; el graded exige compañía+grado. Rechaza combinaciones inválidas con
   * 422 VALIDATION_ERROR (API_CONTRACT §M1).
   */
  private validateProductShape(dto: CreateItemDto | BatchInventoryItemInput) {
    if (dto.productType === 'sealed') {
      if (dto.rawCondition || dto.gradingCompany || dto.gradeValue) {
        throw BusinessException.validation(
          'VALIDATION_ERROR',
          'sealed items carry no rawCondition/grade',
        );
      }
    } else if (dto.productType === 'raw') {
      if (dto.rawCondition && dto.rawCondition !== 'NM') {
        throw BusinessException.validation('VALIDATION_ERROR', 'raw condition must be NM');
      }
      if (dto.sealedSubtype || dto.gradingCompany || dto.gradeValue) {
        throw BusinessException.validation(
          'VALIDATION_ERROR',
          'raw items carry no sealedSubtype/grade',
        );
      }
    } else {
      // graded
      if (!dto.gradingCompany || !dto.gradeValue) {
        throw BusinessException.validation(
          'VALIDATION_ERROR',
          'graded items require gradingCompany and gradeValue',
        );
      }
      // v1.2 (M-12): certNumber (nº de certificado PSA/CGC) requerido para publicar una gradeada.
      if (!dto.certNumber || dto.certNumber.trim() === '') {
        throw BusinessException.validation(
          'VALIDATION_ERROR',
          'graded items require certNumber to be published',
        );
      }
      if (dto.rawCondition || dto.sealedSubtype) {
        throw BusinessException.validation(
          'VALIDATION_ERROR',
          'graded items carry no rawCondition/sealedSubtype',
        );
      }
    }
  }

  async listItems(q: {
    status?: string;
    cardId?: string;
    ownerType?: string;
    locationId?: string;
    zone?: string;
    q?: string;
    page: number;
    pageSize: number;
  }) {
    const where: Prisma.InventoryItemWhereInput = {};
    if (q.status) where.status = q.status as never;
    if (q.cardId) where.cardId = q.cardId;
    if (q.ownerType) where.ownerType = q.ownerType as never;
    if (q.locationId) where.locationId = q.locationId;
    if (q.zone) where.location = { zone: q.zone as never };
    if (q.q) where.OR = [{ folio: { contains: q.q, mode: 'insensitive' } }];
    const [data, total] = await Promise.all([
      this.prisma.inventoryItem.findMany({
        where,
        include: { card: true, location: true },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.inventoryItem.count({ where }),
    ]);
    return { data, page: q.page, pageSize: q.pageSize, total };
  }

  async getItem(id: string) {
    const item = await this.prisma.inventoryItem.findUnique({
      where: { id },
      include: {
        card: { include: { set: true } },
        location: true,
        movements: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!item) throw BusinessException.notFound();
    return item;
  }

  async updateItem(id: string, dto: UpdateItemDto) {
    const current = await this.getItem(id);
    // v1.2 (M-12): la invariante "gradeada publicada exige certNumber" también rige en el
    // UPDATE, no solo en el alta. `createItem` valida vía validateProductShape; aquí revalidamos
    // el estado RESULTANTE del PATCH: si la carta resultante es graded y queda `listed`, el
    // certNumber resultante (nuevo si viene en el dto, si no el ya persistido) debe ser no vacío.
    // Sin esto un PATCH podría publicar/mantener publicada una gradeada sin cert → aparecería en
    // Compra sin nº de certificado verificable (API_CONTRACT §M1).
    const resultingStatus = dto.status ?? current.status;
    const resultingCertNumber =
      dto.certNumber !== undefined ? dto.certNumber : current.certNumber;
    if (
      current.productType === 'graded' &&
      resultingStatus === 'listed' &&
      (!resultingCertNumber || resultingCertNumber.trim() === '')
    ) {
      throw BusinessException.validation(
        'VALIDATION_ERROR',
        'graded items require certNumber to be published',
      );
    }
    return this.prisma.inventoryItem.update({ where: { id }, data: dto });
  }

  async moveItem(id: string, dto: MoveItemDto, actorUserId: string) {
    const item = await this.getItem(id);
    await this.prisma.inventoryMovement.create({
      data: {
        itemId: id,
        fromLocationId: item.locationId,
        toLocationId: dto.toLocationId,
        fromStatus: item.status,
        toStatus: item.status,
        reason: MovementReason.move,
        actorUserId,
        note: dto.note,
      },
    });
    return this.prisma.inventoryItem.update({
      where: { id },
      data: { locationId: dto.toLocationId },
    });
  }

  async markItem(id: string, dto: MarkItemDto, actorUserId: string) {
    const item = await this.getItem(id);
    const status: InventoryStatus = dto.mark === 'lost' ? 'lost' : 'damaged';
    await this.prisma.inventoryMovement.create({
      data: {
        itemId: id,
        fromStatus: item.status,
        toStatus: status,
        reason: dto.mark === 'lost' ? MovementReason.lost : MovementReason.damaged,
        actorUserId,
        note: dto.note,
      },
    });
    return this.prisma.inventoryItem.update({ where: { id }, data: { status } });
  }

  // ---------------- Locations ----------------

  async listLocations() {
    const data = await this.prisma.vaultLocation.findMany({ orderBy: { label: 'asc' } });
    return { data };
  }

  async createLocation(dto: CreateLocationDto) {
    const label = `${dto.box}-${dto.row}-${dto.slot}`;
    return this.prisma.vaultLocation.create({ data: { ...dto, label } });
  }
}
