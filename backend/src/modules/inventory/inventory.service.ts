import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  AcquisitionType,
  AdjustmentReason,
  Card,
  Finish,
  GradingCompany,
  InventoryStatus,
  MovementReason,
  OwnerType,
  OwnershipStatus,
  Prisma,
  ProductType,
  RawCondition,
  SealedCondition,
  SealedSubtype,
  VariantPriceOverride,
  VaultZone,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/business.exception';
import { PriceInfo, PricingService } from '../pricing/pricing.service';
import { buildGradeKey, sealedMarketGradeKey } from '../pricing/pricing.types';
import * as ExcelJS from 'exceljs';
import { SettingsService } from '../settings/settings.service';
import { SettingKey } from '../settings/settings.constants';
// H-1 (§4.36.6): «presente ⇔ > 0» en UN solo predicado compartido — prohibido repetirlo a mano.
import {
  computeAportacionCostCents,
  firstPresentAmount,
  hasManualPrice,
  PriceBasis,
  sealedPriceBasisOf,
} from '../../common/money';
// v2.0 (P-48, §4.36): la CURVA sustituye a las reglas de venta por rareza/acabado en la publicación.
import { PendingReason, PricingCurve } from '../../common/pricing-curve';
import {
  BatchCreateInventoryRequest,
  BatchInventoryItemInput,
  BulkPublishRequest,
  BulkRemoveRequestDto,
  CreateItemDto,
  CreateLocationDto,
  InventoryAdjustmentRequestDto,
  MarkItemDto,
  MoveItemDto,
  PublishAllRequestDto,
  UpdateItemDto,
} from './dto/inventory.dto';
import { toCardDTO } from '../catalog/catalog.service';
import { sanitizeSealedImageUrl } from './sealed-image-host';
import { AuditService } from '../audit/audit.service';

/**
 * v1.36-sealed-alta (M-37, P-35) — proyección de los 4 campos aditivos del alta de SELLADO, ya
 * RESUELTOS y VALIDADOS server-side (mapeo TCGCSV «se fijan juntos» + imagen validada por host).
 * Todo `null` para raw/graded (los campos se ignoran) y para sellado sin mapeo / URL inválida.
 */
interface SealedItemMapping {
  tcgplayerProductId: number | null;
  tcgplayerGroupId: number | null;
  sealedImageUrl: string | null;
  sealedProductName: string | null;
}

/**
 * H-1 (SEC) — descriptor DIFERIDO del override manual de mercado del SELLADO. `resolveCreation`
 * SOLO lo VALIDA y lo devuelve; la escritura (`PriceReference isManualOverride=true` + `AuditLog`)
 * se aplica en el caller DENTRO de la misma transacción del alta y SOLO tras crear la pieza, de modo
 * que un rollback (o una línea fallida antes de crear el item) NUNCA deje un override huérfano.
 */
interface SealedManualOverride {
  cardId: string;
  gradeKey: string;
  priceMxnCents: number;
  tcgplayerProductId: number;
}

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
  | {
      index: number;
      inventoryItemId: string;
      ok: false;
      error: { code: string; message: string };
      // v1.26 (④, §M1): aditivo/opcional. Presente SOLO en la línea que escaló a la cola de
      // pendientes (PRICE_PENDING); es el id de la `PendingPriceEntry` open para deep-link de UI a M2.
      pendingPriceEntryId?: string;
    };

export interface BulkPublishResponse {
  summary: { requested: number; published: number; failedLines: number };
  results: BulkPublishLineResult[];
}

// ===== v1.28 (P-19, §4.26c) — publicar TODO =====

/** Detalle de un fallo de `publish-all` (API_CONTRACT §M1 — capado a 200 líneas). */
export interface PublishAllFailure {
  inventoryItemId: string;
  folio: string;
  error: { code: string; message: string };
  /** Presente SOLO cuando la línea escaló por priceless (④): deep-link a la cola M2. */
  pendingPriceEntryId?: string;
}

export interface PublishAllResponse {
  batchKey?: string;
  idempotentReplay: boolean;
  summary: {
    selected: number;
    published: number;
    /**
     * v2.1.1 (§4.36.5b-bis): CAMBIA DE SIGNIFICADO — de «no la toqué» a «la RE-VERIFIQUÉ y sigue
     * sana». Una pieza `listed` que vuelve a resolver precio cuenta aquí (no-op observable: no se
     * re-cobra y no cambia el precio, que no está persistido).
     */
    alreadyListed: number;
    pendingPrice: number;
    failed: number;
    /**
     * v2.1.1 (§4.36.5b-bis) — SUBCONJUNTO de `pendingPrice`, FUERA de la partición: piezas que
     * estaban `listed` y ya NO resuelven precio (escalaron a la cola y SIGUEN `listed`). Contesta la
     * pregunta del dueño: «de lo que ya estaba a la venta, ¿cuánto quedó roto?». No se puede deducir
     * de `pendingPrice` (mezcla lo que nunca estuvo publicado) ni de `alreadyListed`. El invariante
     * `selected = published + alreadyListed + pendingPrice + failed` NO cambia.
     */
    listedNowPending: number;
  };
  failures: PublishAllFailure[];
}

/** Tamaño del chunk server-side de `publish-all` (§4.26c: sin cap de SELECCIÓN, proceso acotado). */
export const PUBLISH_ALL_CHUNK_SIZE = 100;
/** Cap del DETALLE de fallos en la respuesta (el remanente se opera por la cola M2 `?context=inventory`). */
export const PUBLISH_ALL_FAILURES_CAP = 200;

// ===== v1.51 (fase 8, D10, criterio 125) — la cola «listas para publicar» =====

/**
 * Chunk del barrido de la cola de pendientes de publicación. **Mismo tamaño y misma razón que el de
 * `publish-all`**: memoria acotada y referencias/overrides en lote por chunk, sin N+1 por pieza.
 */
export const PENDING_PUBLISH_CHUNK_SIZE = PUBLISH_ALL_CHUNK_SIZE;

/** Qué le falta a una pieza para estar a la venta (§11 `PendingPublishRowDTO.missing`). */
export type PendingPublishMissing = 'location' | 'price';

/**
 * Llave LÓGICA de dedupe de la cola de precio pendiente — **la misma que usa `escalatePending`**
 * (`cardId|productType|gradeKey|finish|sealedProductId`). Se escribe aquí una vez para que el
 * emparejamiento «pieza ↔ entrada abierta» no se haga con una llave inventada en el sitio: dos
 * llaves distintas para la misma cola producen deep-links que apuntan a la entrada equivocada.
 */
function pendingQueueKey(k: {
  cardId: string;
  productType: ProductType;
  gradeKey: string;
  finish: Finish;
  sealedProductId?: string | null;
}): string {
  return `${k.cardId}|${k.productType}|${k.gradeKey}|${k.finish}|${k.sealedProductId ?? ''}`;
}

/**
 * v1.51 (fase 8) — el estado de publicación de UNA pieza, ya calculado.
 *
 * `missing: []` ⇒ **no le falta nada**: no entra a la cola porque la auto-publicación ya la sacó (o
 * la sacará en el siguiente intento). `pendingPriceEntryId` solo tiene sentido con `'price'`.
 */
export interface PendingPublishState {
  missing: PendingPublishMissing[];
  /** Llave de la cola de M2 con la que se busca la entrada `open`. Solo con `'price'`. */
  pendingQueueKey?: string;
  resolvedSalePriceCents: number | null;
  priceBasis: PriceBasis | null;
}

/**
 * Contexto de precio de publicación izado UNA VEZ por request/chunk (pago mínimo BE-25):
 * reglas de venta + spreads de sellado + referencias y overrides M-30 EN LOTE. Lo comparten
 * `bulkPublish` y `publishAll` — el pipeline por-pieza es IDÉNTICO por contrato (§4.26c).
 */
interface PublishPricingCtx {
  /** v2.0 (P-48, §4.36.2): la CURVA izada UNA vez por request/corrida (BE-25). */
  curve: PricingCurve;
  sealed: { spreadPctBySubtype: Record<string, number>; fallbackPct: number; sourceOn: boolean };
  refs: Map<string, PriceInfo>;
  variantOverrides: Map<string, VariantPriceOverride>;
}

/** Pieza publicable (fila InventoryItem + su carta), como la consumen los pipelines de publish. */
type PublishableItem = Prisma.InventoryItemGetPayload<{ include: { card: true } }>;

/**
 * Resultado de la resolución de precio de publicación de UNA pieza:
 *  - `ok:true` → precio resuelto (manual por pieza o derivado con la precedencia v1.28).
 *  - `ok:false` → PRICE_PENDING: la variante NO tiene precio resoluble; YA se escaló a la cola
 *    (④, idempotente) y la pieza NO debe publicarse (money-safe: jamás se lista sin precio).
 */
type PublishPriceResolution =
  | { ok: true; salePriceCents: number; priceSource: 'manual' | 'derived' }
  | { ok: false; message: string; pendingPriceEntryId?: string };

/**
 * v1.51 (fase 8, §4.39m.1) — **LA MISMA DECISIÓN DE PRECIO, SIN ESCRIBIR NADA.**
 *
 * `derivePublishSalePrice` responde *«¿tiene esta pieza un precio de venta resoluble, y cuál?»*.
 * `resolvePublishSalePrice` es **esto MISMO más el efecto**: escalar a la cola de precio pendiente
 * cuando no resuelve, y cerrarla cuando sí (salida simétrica §4.36.5c).
 *
 * ### Por qué hacía falta partirlo, y por qué NO es una segunda copia de la precedencia
 * La cola `GET /admin/inventory/pending-publish` necesita **exactamente esta pregunta** por fila. Si
 * llamara a `resolvePublishSalePrice`, **un GET escribiría**: abriría y cerraría `PendingPriceEntry`
 * por el mero hecho de que alguien mire la pantalla — una lectura con efectos, y encima sobre la cola
 * de otro módulo. Y reimplementar la precedencia en la cola daría **dos verdades sobre el mismo
 * dinero**: la cola diría «le falta precio» y el publish diría que no, o al revés.
 * **Un cuerpo, dos lectores:** aquí vive la precedencia; el efecto vive **una capa más arriba**.
 */
interface PendingVariantKey {
  cardId: string;
  productType: ProductType;
  gradeKey: string;
  finish: Finish;
  sealedProductId?: string | null;
}
type PublishPriceDerivation =
  | {
      ok: true;
      salePriceCents: number;
      priceSource: 'manual' | 'derived';
      /**
       * §11 `PendingPublishRowDTO.priceBasis` — **QUÉ determinó el monto**, con el MISMO enum que
       * usan ficha, catálogo y compra. La cola lo enseña para que el operador vea de dónde salió el
       * precio de una pieza que solo espera ubicación, sin abrir otra pantalla.
       */
      priceBasis: PriceBasis;
      /**
       * ⚠️ Viaja **también en el éxito**, y a propósito: el cierre simétrico de la cola (§4.36.5c)
       * tiene que usar **la MISMA clave** que habría usado la escalada. Recalcularla en el
       * llamador sería reabrir la puerta a que entrada y salida no coincidan — que es exactamente
       * el defecto que `settlePendingForVariant` vino a cerrar. `null` en la rama de precio
       * MANUAL, donde no hay variante que consultar.
       */
      pendingKey: PendingVariantKey | null;
    }
  | {
      ok: false;
      message: string;
      /** Clave de la variante con la que se escala/consulta la cola de precio pendiente. */
      pendingKey: PendingVariantKey;
      /** `null` para sellado (su escalada no lleva razón de curva). */
      pendingReason: PendingReason | null;
    };

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

/**
 * [v1.20 §4.20e] Allowlist de status AJUSTABLES por levantamiento físico. Solo una pieza de
 * PLATAFORMA que hoy esté `in_stock`/`listed` admite `perdida | danada | error_captura`; una
 * `reserved` (orden con PaymentIntent vivo), `in_custody`/`picking`/`shipped`/`delivered`
 * (bóveda/envío de cliente) o ya terminal (`lost|damaged|withdrawn`) se resuelve por su flujo
 * dueño (M3/M4/`mark` + reposición) — NUNCA por ajuste → 422 ITEM_NOT_ADJUSTABLE.
 */
const ADJUSTABLE_ORIGIN_STATUSES: ReadonlyArray<InventoryStatus> = ['in_stock', 'listed'];

/**
 * Respuesta del ajuste (API_CONTRACT §DTOs — InventoryAdjustmentResponse, v1.20.1):
 *  - `adjustmentIds` (plural) SUSTITUYE al singular `adjustmentId`: con `encontrada` y qty>1 hay
 *    UNA fila InventoryAdjustment por pieza (M-24) y se devuelven TODAS, alineadas 1:1 con
 *    `inventoryItemIds`/`folios` (longitud 1 en los otros motivos).
 *  - `idempotentReplay`: true SOLO cuando un `batchKey` ya procesado repite la respuesta guardada;
 *    false en todo procesamiento nuevo (y siempre false sin batchKey / motivos ≠ encontrada).
 */
export interface InventoryAdjustmentResponse {
  adjustmentIds: string[];
  reason: AdjustmentReason;
  inventoryItemIds: string[];
  folios: string[];
  fromStatus: InventoryStatus | null;
  toStatus: InventoryStatus;
  idempotentReplay: boolean;
}

/**
 * P-29 — respuesta de la baja rápida por cantidad (POST /admin/inventory/items/bulk-remove).
 * `removed === requested` SIEMPRE en el camino feliz (la operación es atómica: o baja las N o
 * lanza 422 INSUFFICIENT_STOCK sin bajar ninguna). Los arrays van alineados 1:1 (una fila
 * InventoryAdjustment + un InventoryMovement por pieza dada de baja).
 *
 * v1.35 — `batchKey?` (presente SOLO si vino en el request) + `idempotentReplay`: `true` SOLO cuando
 * un `batchKey` ya procesado repite la respuesta guardada (mismo `200`, sin re-bajar); `false` en todo
 * procesamiento nuevo (y siempre `false` sin `batchKey`). Paridad total con `InventoryAdjustmentResponse`.
 */
export interface BulkRemoveResponse {
  batchKey?: string;
  idempotentReplay: boolean;
  removed: number;
  requested: number;
  reason: AdjustmentReason;
  toStatus: InventoryStatus;
  inventoryItemIds: string[];
  folios: string[];
  adjustmentIds: string[];
}

/**
 * P-31 — columnas del export de inventario a .xlsx (una fila por PIEZA/folio). El orden fija el
 * layout de la hoja. `key` mapea a la fila que arma `buildExportRows`.
 */
export const INVENTORY_EXPORT_COLUMNS: ReadonlyArray<{ header: string; key: string; width: number }> = [
  { header: 'Folio', key: 'folio', width: 14 },
  { header: 'Carta', key: 'card', width: 28 },
  { header: 'Set', key: 'set', width: 26 },
  { header: 'Número', key: 'number', width: 10 },
  { header: 'Rareza', key: 'rarity', width: 18 },
  { header: 'Tipo', key: 'productType', width: 10 },
  { header: 'Acabado', key: 'finish', width: 20 },
  { header: 'Condición', key: 'condition', width: 20 },
  { header: 'Certificado', key: 'certNumber', width: 16 },
  { header: 'Cantidad', key: 'quantity', width: 10 },
  { header: 'Estado', key: 'status', width: 12 },
  { header: 'Ubicación', key: 'location', width: 18 },
  { header: 'Origen', key: 'origin', width: 20 },
  { header: 'Costo MXN', key: 'costMxn', width: 12 },
  { header: 'Precio mercado MXN', key: 'marketMxn', width: 18 },
  { header: 'Precio compra MXN', key: 'buyMxn', width: 18 },
  { header: 'Precio venta MXN', key: 'sellMxn', width: 18 },
];

/**
 * v2.1.9 (S49-R4) — **lista blanca de `InventoryItem` para las respuestas de BACK-OFFICE (M1).**
 *
 * `updateItem`, `moveItem`, `markItem` y `createLocation` devolvían la entidad Prisma cruda. Hoy
 * `InventoryItem` no guarda ni PII ni secretos, así que esta lista **no cambia nada visible**: fija
 * la forma ACTUAL para que la próxima columna del schema no se auto-publique. Es la misma doctrina
 * que `toAdminSellRequestDTO` (buylist) y `toAdminShipmentRow` (envíos).
 *
 * Es explícitamente una lista de columnas de **back-office**: costo (`acquisitionCostCents`),
 * procedencia (`acquisitionType`, `sourceSellRequestItemId`) y ubicación (`locationId`) NO viajan a
 * superficies de cliente — para eso están `HoldingDTO` (§3) y `ListingDTO` (§DTOs), que se
 * construyen aparte y NO deben "unificarse" con esta.
 */
function toAdminInventoryItemRow(i: {
  id: string;
  folio: string;
  cardId: string;
  productType: ProductType;
  rawCondition: RawCondition | null;
  sealedSubtype: SealedSubtype | null;
  sealedCondition: SealedCondition | null;
  gradingCompany: GradingCompany | null;
  gradeValue: string | null;
  certNumber: string | null;
  locationId: string | null;
  ownerType: OwnerType;
  ownerUserId: string | null;
  ownershipStatus: OwnershipStatus | null;
  status: InventoryStatus;
  finish: Finish;
  listPriceCents: number | null;
  acquisitionType: AcquisitionType;
  acquisitionCostCents: number | null;
  acquisitionPct: number | null;
  sourceSellRequestItemId: string | null;
  tcgplayerProductId: number | null;
  tcgplayerGroupId: number | null;
  sealedImageUrl: string | null;
  sealedProductName: string | null;
  sealedProductId: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: i.id,
    folio: i.folio,
    cardId: i.cardId,
    productType: i.productType,
    rawCondition: i.rawCondition,
    sealedSubtype: i.sealedSubtype,
    sealedCondition: i.sealedCondition,
    gradingCompany: i.gradingCompany,
    gradeValue: i.gradeValue,
    certNumber: i.certNumber,
    locationId: i.locationId,
    ownerType: i.ownerType,
    ownerUserId: i.ownerUserId,
    ownershipStatus: i.ownershipStatus,
    status: i.status,
    finish: i.finish,
    listPriceCents: i.listPriceCents,
    acquisitionType: i.acquisitionType,
    acquisitionCostCents: i.acquisitionCostCents,
    acquisitionPct: i.acquisitionPct,
    sourceSellRequestItemId: i.sourceSellRequestItemId,
    tcgplayerProductId: i.tcgplayerProductId,
    tcgplayerGroupId: i.tcgplayerGroupId,
    sealedImageUrl: i.sealedImageUrl,
    sealedProductName: i.sealedProductName,
    sealedProductId: i.sealedProductId,
    createdAt: i.createdAt,
    updatedAt: i.updatedAt,
  };
}

/** v2.1.9 (S49-R4) — lista blanca de `VaultLocation` (M1 · ubicaciones CAJA/FILA/SLOT). */
function toVaultLocationDTO(l: {
  id: string;
  zone: VaultZone;
  box: string;
  row: string;
  slot: string;
  label: string;
  isActive: boolean;
  createdAt: Date;
}) {
  return {
    id: l.id,
    zone: l.zone,
    box: l.box,
    row: l.row,
    slot: l.slot,
    label: l.label,
    isActive: l.isActive,
    createdAt: l.createdAt,
  };
}

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly settings: SettingsService,
    // v1.39 (P-38, §4.34d): auditoría del precio manual del sellado (`inventory.sealed_manual_market`).
    // @Optional() — el módulo lo provee (AuditModule es @Global); los tests unitarios que construyen
    // el servicio con 3 args lo dejan `undefined` (el precio manual se ejercita sin auditor en unit).
    @Optional() private readonly audit?: AuditService,
  ) {}

  /**
   * Alta de item (M1). Folio legible INV-000123 (secuencia). Para aportación en
   * especie: costo = referencia del día × pct (default 70). Si no hay referencia
   * → 422 PRICE_PENDING + cola de precio pendiente (nunca se descarta).
   */
  async createItem(dto: CreateItemDto, actorUserId: string) {
    const r = await this.resolveCreation(dto, actorUserId);

    // v1.1: sellado = precio SIEMPRE manual (MXN). Obligatorio para PUBLICAR: sin
    // listPriceCents el sellado queda "precio pendiente" (no aparece en Compra). Se escala
    // a la cola de precio pendiente para que el dueño lo fije (regla transversal).
    // FIX (fix/variant-composition-regression): la escalación del ALTA debe usar la MISMA clave de
    // MERCADO que el PUBLISH (`sealed:tcg:<productId>` + `sealedProductId`), NO el legacy `'sealed'`.
    // Antes el alta escalaba con `r.gradeKey='sealed'` y sin `sealedProductId`, mientras el publish
    // escala con `sealed:tcg:<productId>` + `sealedProductId` → DOS `PendingPriceEntry` open para la
    // MISMA pieza (dos filas «FIJAR PRECIO» en M2). El resolver del sellado consume `sealed:tcg:<id>`
    // (no el legacy), así que fijar precio sobre la fila legacy escribía una `PriceReference` que el
    // resolver IGNORA → la pieza seguía impublicable. Unificando la clave, alta y publish DEDUPEAN en
    // UNA sola entrada por `(item / sealedProductId / clave de mercado)`. Sellado legacy sin mapping
    // (sin `tcgplayerProductId`) mantiene el comportamiento seguro: cae a `'sealed'`, sin duplicar.
    if (r.sealedNeedsEscalate) {
      const pendingGradeKey =
        r.sealedMapping.tcgplayerProductId != null
          ? sealedMarketGradeKey(r.sealedMapping.tcgplayerProductId)
          : r.gradeKey;
      await this.pricing.escalatePending(
        r.card.id,
        dto.productType,
        pendingGradeKey,
        'inventory',
        undefined,
        'normal',
        null,
        r.sealedProductId,
      );
    }

    const folio = await this.prisma.nextFolio();
    // H-1 (SEC): alta + override manual en UNA transacción. El override del sellado (si aplica) se
    // persiste AQUÍ, tras crear la pieza y dentro de la misma tx → sin override sin pieza, ni pieza
    // sin su override; un fallo revierte AMBOS (no queda `PriceReference isManualOverride` huérfano).
    const item = await this.prisma.$transaction(async (tx) => {
      const created = await tx.inventoryItem.create({
        data: this.buildItemData(dto, r, folio),
      });
      await tx.inventoryMovement.create({
        data: {
          itemId: created.id,
          toLocationId: dto.locationId,
          toStatus: 'in_stock',
          reason: MovementReason.alta,
          actorUserId,
          note: dto.acquisitionType,
        },
      });
      if (r.sealedManualOverride) {
        await this.applySealedManualOverride(r.sealedManualOverride, actorUserId, tx);
      }
      return created;
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
  private async resolveCreation(
    dtoIn: CreateItemDto | BatchInventoryItemInput,
    actorUserId?: string,
  ): Promise<{
    card: Card;
    finish: Finish;
    gradeKey: string;
    acquisitionCostCents: number | null;
    acquisitionPct: number | null;
    sealedNeedsEscalate: boolean;
    sealedMapping: SealedItemMapping;
    sealedProductId: string | null;
    // v1.39: subtipo RESUELTO (derivado del SealedProduct cuando se usa sealedProductId; si no, el del
    // DTO). buildItemData recibe la línea ORIGINAL, así que la identidad derivada viaja por aquí.
    sealedSubtype: SealedSubtype | null;
    // H-1 (SEC): override manual de mercado VALIDADO pero NO escrito (se difiere al caller, dentro de
    // la tx del alta, tras crear la pieza). null cuando no aplica override.
    sealedManualOverride: SealedManualOverride | null;
  }> {
    // v1.39-sealed-product-module (M-39, P-38, §4.34d): si la línea trae `sealedProductId` (solo sealed),
    // el backend DERIVA server-side la identidad (cardId ancla del set + mapeo + imagen/nombre/subtipo)
    // DESDE el `SealedProduct` persistido — el cliente NO manda identidad ni montos. La pieza nace con
    // identidad CORRECTA («ETB …», no la Tropius). Inexistente/inactivo → 422 SEALED_PRODUCT_NOT_FOUND.
    const { dto, sealedProductId } = await this.deriveFromSealedProduct(dtoIn);

    // v1.39: `cardId` es OPCIONAL en el DTO (se deriva con `sealedProductId`). Requerido para
    // raw/graded y sealed sin `sealedProductId`; ausente donde se requiere → 422 VALIDATION_ERROR.
    if (!dto.cardId) {
      throw BusinessException.validation('VALIDATION_ERROR', 'cardId is required');
    }
    const card = await this.prisma.card.findUnique({ where: { id: dto.cardId } });
    if (!card) throw BusinessException.notFound('NOT_FOUND', 'Card not found');

    // v1.1: validación por tipo de producto (excluye sellado de la lógica NM/rareza/grade).
    this.validateProductShape(dto);

    // v1.36-sealed-alta (M-37, P-35): los 4 campos aditivos (mapeo TCGCSV + imagen/nombre de API) se
    // resuelven aquí (validación «se fijan juntos» + sanitización de la URL contra el host allowlist).
    // Se IGNORAN en raw/graded. Con mapeo presente (o derivado del SealedProduct), la pieza NACE MAPEADA.
    const sealedMapping = this.resolveSealedMapping(dto);

    // v1.6-finish: el acabado aplica a raw/singles; graded/sealed = normal siempre (ARCHITECTURE §3.7).
    // Para raw se valida contra card.availableFinishes (SEC-A1); fuera de la lista → 422.
    const finish = this.resolveFinish(dto, card.availableFinishes as Finish[]);

    const gradeKey = this.pricing.gradeKeyFor(dto);
    let acquisitionCostCents =
      ('acquisitionCostCents' in dto ? dto.acquisitionCostCents : undefined) ?? null;
    let acquisitionPct = dto.acquisitionPct ?? null;

    // v1.39 (§4.34d): mercado del SELLADO al alta (money-safe) — resuelto SIEMPRE para sellado (no solo
    // en aportación) para aplicar las salidas honestas del fallback manual: resuelto → override manual
    // PROHIBIDO (422 MANUAL_MARKET_NOT_ALLOWED); null + `manualMarketMxnCents>0` → override AUDITADO;
    // null sin override → mercado null (la aportación caerá a PRICE_PENDING, jamás 0).
    // Solo se resuelve cuando hace falta: aportación (valúa el costo) o `manualMarketMxnCents` presente
    // (valida/persiste el override). Un sellado no-aportación sin override no toca el mercado al alta
    // (preserva el comportamiento previo: sin query extra).
    // H-2 (SEC): el override manual de mercado (`manualMarketMxnCents`) SOLO se acepta cuando la
    // identidad viene de un `sealedProductId` VALIDADO (SealedProduct activo, resuelto arriba por
    // `deriveFromSealedProduct`). Sin `sealedProductId` —incluido el path legacy con el
    // `tcgplayerProductId`+`tcgplayerGroupId` que envía el cliente— se rechaza: jamás se ancla un
    // override de dinero a un productId ARBITRARIO del cliente saltándose SEALED_PRODUCT_NOT_FOUND/SEC-A1.
    if (dto.manualMarketMxnCents != null && sealedProductId == null) {
      throw BusinessException.validation(
        'MANUAL_MARKET_NOT_ALLOWED',
        'manualMarketMxnCents requires a validated sealedProductId',
      );
    }

    let sealedMarketCents: number | null = null;
    let sealedPendingGradeKey = gradeKey;
    // H-1 (SEC): el override manual NO se persiste aquí. `resolveSealedMarketForAlta` VALIDA y devuelve
    // un descriptor; la escritura se DIFIERE al caller, dentro de la misma tx del alta y tras crear la pieza.
    let sealedManualOverride: SealedManualOverride | null = null;
    if (
      dto.productType === 'sealed' &&
      (dto.acquisitionType === 'aportacion_en_especie' || dto.manualMarketMxnCents != null)
    ) {
      const m = await this.resolveSealedMarketForAlta(
        dto,
        sealedMapping.tcgplayerProductId,
        dto.manualMarketMxnCents,
      );
      sealedMarketCents = m.marketCents;
      sealedPendingGradeKey = m.pendingGradeKey;
      sealedManualOverride = m.manualOverride;
    }

    if (dto.acquisitionType === 'aportacion_en_especie') {
      const pct = dto.acquisitionPct ?? (await this.settings.getNumber(SettingKey.APORTACION_PCT));
      let referenceCents: number | null;
      let pendingGradeKey = gradeKey;
      if (dto.productType === 'sealed') {
        // v1.39 (§4.34d): valúa por el mercado resuelto arriba (live-cache H-1 o el override manual
        // money-safe recién persistido). Sin mercado ni override ⇒ null ⇒ PRICE_PENDING (nunca 0).
        referenceCents = sealedMarketCents;
        pendingGradeKey = sealedPendingGradeKey;
      } else {
        // v1.6-finish: costo contra la referencia del ACABADO alta.
        const ref = await this.pricing.getReference(dto.cardId, dto.productType, gradeKey, finish);
        referenceCents =
          ref.status === 'priced' && ref.referenceMxnCents != null ? ref.referenceMxnCents : null;
      }
      if (referenceCents == null) {
        // Tier 0 FIX: propaga el `finish` resuelto a la cola. Antes se omitía y el pendiente
        // quedaba en `normal` aunque el alta fuera holofoil (M-19: la cola es POR acabado).
        // v1.42 (BLOQ-2b): propaga `sealedProductId` para que ETB y blíster no colapsen en la cola.
        await this.pricing.escalatePending(
          dto.cardId,
          dto.productType,
          pendingGradeKey,
          'inventory',
          undefined,
          finish,
          null,
          sealedProductId,
        );
        throw BusinessException.validation(
          'PRICE_PENDING',
          'No reference price yet; escalated to pending queue',
        );
      }
      acquisitionPct = pct;
      acquisitionCostCents = computeAportacionCostCents(referenceCents, pct);
    }

    const sealedNeedsEscalate = dto.productType === 'sealed' && dto.listPriceCents == null;
    return {
      card,
      finish,
      gradeKey,
      acquisitionCostCents,
      acquisitionPct,
      sealedNeedsEscalate,
      sealedMapping,
      sealedProductId,
      sealedSubtype: dto.productType === 'sealed' ? (dto.sealedSubtype ?? null) : null,
      sealedManualOverride,
    };
  }

  /**
   * v1.39-sealed-product-module (M-39, P-38, §4.34d) — DERIVA la identidad del sellado desde el
   * `SealedProduct` persistido cuando la línea trae `sealedProductId` (solo `productType='sealed'`).
   * Devuelve una línea NORMALIZADA (cardId ancla del set + mapeo + imagen/nombre/subtipo del producto)
   * y el `sealedProductId` a congelar en la pieza (FK). Sin `sealedProductId` (o no sellado) devuelve la
   * línea tal cual (transición P-35). `SealedProduct` inexistente/inactivo → 422 SEALED_PRODUCT_NOT_FOUND.
   * El cliente NO manda identidad ni montos: todo se deriva server-side (SEC-A1).
   */
  private async deriveFromSealedProduct(
    dto: CreateItemDto | BatchInventoryItemInput,
  ): Promise<{ dto: CreateItemDto | BatchInventoryItemInput; sealedProductId: string | null }> {
    if (dto.productType !== 'sealed' || !dto.sealedProductId) {
      return { dto, sealedProductId: null };
    }
    const sp = await this.prisma.sealedProduct.findUnique({ where: { id: dto.sealedProductId } });
    if (!sp || !sp.active) {
      throw BusinessException.validation(
        'SEALED_PRODUCT_NOT_FOUND',
        'sealedProductId does not exist or is inactive',
      );
    }
    const anchorCardId = await this.resolveAnchorCardId(sp.setId);
    if (!anchorCardId) {
      throw BusinessException.validation('VALIDATION_ERROR', 'set has no anchor card for sealed product');
    }
    // Los 4 campos M-37 sueltos se IGNORAN (mandan los derivados): se sobreescriben desde el SealedProduct.
    const normalized = {
      ...dto,
      cardId: anchorCardId,
      sealedSubtype: sp.subtype,
      tcgplayerProductId: sp.tcgplayerProductId,
      tcgplayerGroupId: sp.tcgplayerGroupId,
      sealedImageUrl: sp.imageUrl ?? undefined,
      sealedProductName: sp.name,
    } as CreateItemDto | BatchInventoryItemInput;
    return { dto: normalized, sealedProductId: sp.id };
  }

  /** Ancla representativa del set = menor (numberPrefix, numberSort). El sellado se ancla a ella SOLO
   * para satisfacer InventoryItem.cardId (NOT NULL); deja de ser identidad (§4.34a). */
  private async resolveAnchorCardId(setId: string): Promise<string | null> {
    const anchor = await this.prisma.card.findFirst({
      where: { setId },
      orderBy: [{ numberPrefix: 'asc' }, { numberSort: 'asc' }],
      select: { id: true },
    });
    return anchor?.id ?? null;
  }

  /**
   * v1.39 (§4.34d) — mercado del SELLADO al alta + fallback MANUAL money-safe. Devuelve el mercado
   * resuelto (o el override manual recién persistido) y la clave de pendiente. Precedencia money-safe:
   *  1. Mercado resuelto (H-1: `sealed:tcg:<productId>` gateado por el dial `sealedPriceSource`).
   *  2. Con `manualMarketMxnCents`: SOLO si el mercado resuelto es null → override AUDITADO (`>0`;
   *     persistido como `PriceReference isManualOverride=true`). Mercado YA resuelto → 422
   *     MANUAL_MARKET_NOT_ALLOWED (jamás pisa un mercado vivo). `≤0` → 422 VALIDATION_ERROR.
   *  3. Sin override y sin mercado → null (el caller escala PRICE_PENDING; JAMÁS 0).
   * Nota money-safe: el mercado autoritativo es la caché H-1 `PriceReference` (poblada por sync +
   * `sealed-price-ingest`); NO se hace fetch HTTP dentro de la transacción de alta (anti pool-starvation).
   */
  private async resolveSealedMarketForAlta(
    dto: { cardId?: string; sealedSubtype?: string | null },
    productId: number | null,
    manualMarketMxnCents: number | undefined,
  ): Promise<{
    marketCents: number | null;
    pendingGradeKey: string;
    // H-1 (SEC): descriptor del override VALIDADO pero NO escrito (lo persiste el caller en la tx del alta).
    manualOverride: SealedManualOverride | null;
  }> {
    // Sin mapeo (sellado legacy sin productId): no hay clave de mercado. El override manual no aplica
    // (no hay a qué anclarlo). Se conserva la inferencia por hermanos ya mapeados (comportamiento P-35).
    // Nota H-2: con `sealedProductId` requerido para el override (gate en `resolveCreation`), este
    // camino solo recibe `manualMarketMxnCents` si un SealedProduct activo NO tiene `tcgplayerProductId`.
    if (productId == null) {
      if (manualMarketMxnCents != null) {
        throw BusinessException.validation(
          'MANUAL_MARKET_NOT_ALLOWED',
          'manualMarketMxnCents requires a mapped sealed product (use sealedProductId)',
        );
      }
      const legacy = await this.resolveSealedAportacionMarket(
        { cardId: dto.cardId!, sealedSubtype: dto.sealedSubtype },
        null,
      );
      return {
        marketCents: legacy.marketCents,
        pendingGradeKey: legacy.pendingGradeKey,
        manualOverride: null,
      };
    }

    const marketGradeKey = sealedMarketGradeKey(productId);
    const { sourceOn } = await this.pricing.loadSealedSpreads();
    const ref = await this.pricing.getReference(dto.cardId!, 'sealed', marketGradeKey, 'normal');
    const resolved = this.pricing.gateSealedMarketCents(ref, sourceOn);

    if (manualMarketMxnCents != null) {
      // 422 MANUAL_MARKET_NOT_ALLOWED SOLO por «mercado ya resuelto» (NO por rol — vault_operator+ v1.39.1).
      if (resolved != null) {
        throw BusinessException.validation(
          'MANUAL_MARKET_NOT_ALLOWED',
          'market already resolved; manual override only fills a price gap',
        );
      }
      if (!(manualMarketMxnCents > 0)) {
        throw BusinessException.validation(
          'VALIDATION_ERROR',
          'manualMarketMxnCents must be > 0',
        );
      }
      // H-1 (SEC): override money-safe VALIDADO. NO se escribe aquí — se devuelve el descriptor para que
      // el caller lo persista (PriceReference isManualOverride=true + AuditLog) DENTRO de la tx del alta,
      // tras crear la pieza. El valor se usa de inmediato para valuar la aportación (no requiere el write).
      return {
        marketCents: manualMarketMxnCents,
        pendingGradeKey: marketGradeKey,
        manualOverride: {
          cardId: dto.cardId!,
          gradeKey: marketGradeKey,
          priceMxnCents: manualMarketMxnCents,
          tcgplayerProductId: productId,
        },
      };
    }

    return { marketCents: resolved, pendingGradeKey: marketGradeKey, manualOverride: null };
  }

  /**
   * H-1 (SEC) — persiste el override manual de mercado del SELLADO DENTRO de la tx del alta, tras
   * confirmar que la pieza se creó. Atomicidad total: un rollback de la tx revierte también el
   * override, y una línea que falla antes de este punto nunca lo escribe → jamás queda un
   * `PriceReference isManualOverride` huérfano sin pieza. Money-safe: el descriptor ya se validó
   * (mercado null, `>0`) en `resolveSealedMarketForAlta`; aquí solo se escribe + audita, en la tx.
   */
  private async applySealedManualOverride(
    ov: SealedManualOverride,
    actorUserId: string | undefined,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    await this.pricing.manualOverride(ov.cardId, 'sealed', ov.gradeKey, ov.priceMxnCents, 'normal', tx);
    if (this.audit) {
      await this.audit.log(
        {
          actorUserId,
          action: 'inventory.sealed_manual_market',
          entityType: 'SealedProduct',
          entityId: String(ov.tcgplayerProductId),
          after: {
            cardId: ov.cardId,
            tcgplayerProductId: ov.tcgplayerProductId,
            manualMarketMxnCents: ov.priceMxnCents,
            isManualOverride: true,
          },
        },
        tx,
      );
    }
  }

  /**
   * v1.36-sealed-alta (M-37, P-35, §4.32c) — resuelve los 4 campos aditivos del alta de SELLADO.
   * Se IGNORAN por completo en raw/graded (devuelve todo `null`). Reglas normativas:
   *  - `tcgplayerProductId`+`tcgplayerGroupId` se fijan JUNTOS: uno sin el otro → 422 VALIDATION_ERROR
   *    (por-línea en el lote). Ambos presentes ⇒ la pieza NACE MAPEADA (pobla las columnas M-23).
   *  - `sealedImageUrl` se VALIDA server-side contra el host allowlist de imágenes TCGplayer/TCGCSV
   *    (anti stored-XSS / URL arbitraria); inválido/omitido ⇒ `null` (el display cae a la `Card` ancla).
   *  - `sealedProductName` se persiste tal cual (texto); vacío/omitido ⇒ `null`.
   * Money-safe: estos campos son display/identidad; jamás fijan precio.
   */
  private resolveSealedMapping(dto: CreateItemDto | BatchInventoryItemInput): SealedItemMapping {
    if (dto.productType !== 'sealed') {
      return {
        tcgplayerProductId: null,
        tcgplayerGroupId: null,
        sealedImageUrl: null,
        sealedProductName: null,
      };
    }
    const productId = dto.tcgplayerProductId ?? null;
    const groupId = dto.tcgplayerGroupId ?? null;
    // Se fijan JUNTOS (la pieza «nace mapeada» solo con AMBOS): XOR ⇒ 422 VALIDATION_ERROR.
    if ((productId == null) !== (groupId == null)) {
      throw BusinessException.validation(
        'VALIDATION_ERROR',
        'tcgplayerProductId and tcgplayerGroupId must be provided together for sealed items',
      );
    }
    const name = dto.sealedProductName?.trim();
    return {
      tcgplayerProductId: productId,
      tcgplayerGroupId: groupId,
      sealedImageUrl: sanitizeSealedImageUrl(dto.sealedImageUrl),
      sealedProductName: name != null && name !== '' ? name : null,
    };
  }

  /**
   * v1.28 (P-19/P-25, fix normativo §4.26g) — mercado del SELLADO para valuar una APORTACIÓN.
   * El item que nace aún NO tiene mapeo M-23 (la curación es posterior, por el endpoint M2), así
   * que el `tcgplayerProductId` del GRUPO se infiere de sus HERMANOS: piezas selladas ya mapeadas
   * con el MISMO `(cardId, sealedSubtype)` — la MISMA identidad que usa `applyToSiblings` del
   * mapeo (sealed-mapping.service). Money-safe:
   *  - exactamente UN productId mapeado en el grupo → se valúa con SU `sealedMarketRef`, gateado
   *    por el dial `sealedPriceSource` (H-1 §4.23: dial off ⇒ mercado INERTE ⇒ sin valuación);
   *  - CERO hermanos mapeados o ≥2 productIds distintos (ambigüedad: no se adivina con dinero) →
   *    sin mercado ⇒ el caller escala PRICE_PENDING con el gradeKey estructural legacy `'sealed'`.
   * NO escribe el mapeo en la pieza nueva (la curación sigue siendo exclusiva del endpoint M2).
   */
  private async resolveSealedAportacionMarket(
    dto: {
      cardId: string;
      sealedSubtype?: string | null;
    },
    // v1.36 (P-35, §4.32c): productId con el que la pieza NACE MAPEADA (del listado que sirvió el
    // server). Presente ⇒ se valúa por ESE productId DIRECTO (sin inferir de hermanos). Ausente ⇒
    // se conserva la inferencia por hermanos ya mapeados (comportamiento previo, v1.28 §4.26g).
    bornMappedProductId?: number | null,
  ): Promise<{ marketCents: number | null; pendingGradeKey: string }> {
    const structuralGradeKey = 'sealed';
    let productId: number;
    if (bornMappedProductId != null) {
      productId = bornMappedProductId;
    } else {
      const mappedSiblings = await this.prisma.inventoryItem.findMany({
        where: {
          productType: 'sealed',
          cardId: dto.cardId,
          sealedSubtype: (dto.sealedSubtype ?? null) as never,
          tcgplayerProductId: { not: null },
        },
        select: { tcgplayerProductId: true },
        distinct: ['tcgplayerProductId'],
      });
      const productIds = [...new Set(mappedSiblings.map((s) => s.tcgplayerProductId as number))];
      if (productIds.length !== 1) {
        return { marketCents: null, pendingGradeKey: structuralGradeKey };
      }
      productId = productIds[0];
    }
    const marketGradeKey = sealedMarketGradeKey(productId);
    const { sourceOn } = await this.pricing.loadSealedSpreads();
    const ref = await this.pricing.getReference(dto.cardId, 'sealed', marketGradeKey, 'normal');
    // Gate H-1 único (dial + fila priced). Mapeado pero sin mercado/dial off ⇒ el pendiente se
    // escala con la clave de MERCADO (paridad con bulk-publish ④).
    return {
      marketCents: this.pricing.gateSealedMarketCents(ref, sourceOn),
      pendingGradeKey: marketGradeKey,
    };
  }

  /** Data de creación de un InventoryItem (compartida por alta single/lote). */
  private buildItemData(
    dto: CreateItemDto | BatchInventoryItemInput,
    r: {
      // v1.39: `card` = ancla RESUELTA (derivada del SealedProduct cuando se usó sealedProductId). El
      // `dto` de aquí es la línea ORIGINAL (su cardId puede venir vacío), así que la identidad del
      // sellado sale de `r`, no del DTO del cliente (SEC-A1).
      card: Card;
      finish: Finish;
      acquisitionCostCents: number | null;
      acquisitionPct: number | null;
      // v1.36 (P-35): mapeo TCGCSV + imagen/nombre de API ya resueltos/validados (null en raw/graded).
      sealedMapping: SealedItemMapping;
      // v1.39: subtipo resuelto + FK de identidad al SealedProduct (null en raw/graded / sellado legacy).
      sealedSubtype: SealedSubtype | null;
      sealedProductId: string | null;
    },
    folio: string,
  ): Prisma.InventoryItemUncheckedCreateInput {
    return {
      folio,
      cardId: r.card.id,
      productType: dto.productType,
      // raw solo NM (default NM); sellado/graded no llevan rawCondition.
      rawCondition: dto.productType === 'raw' ? (dto.rawCondition ?? 'NM') : null,
      finish: r.finish,
      sealedSubtype: dto.productType === 'sealed' ? r.sealedSubtype : null,
      // v1.23-sealed-sales (M-28): condición del sellado (default mint); null en raw/graded.
      sealedCondition: dto.productType === 'sealed' ? (dto.sealedCondition ?? 'mint') : null,
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
      // v1.36-sealed-alta (M-37, P-35): la pieza NACE MAPEADA (columnas M-23 ya existentes) + imagen/
      // nombre de API (deltas M-37). `resolveSealedMapping` ya devolvió null para raw/graded (se
      // ignoran) y para sellado sin mapeo/URL inválida. Display-only, money-safe.
      tcgplayerProductId: r.sealedMapping.tcgplayerProductId,
      tcgplayerGroupId: r.sealedMapping.tcgplayerGroupId,
      sealedImageUrl: r.sealedMapping.sealedImageUrl,
      sealedProductName: r.sealedMapping.sealedProductName,
      // v1.39-sealed-product-module (M-39, P-38): FK de IDENTIDAD al SealedProduct (null si no se usó
      // sealedProductId). Las columnas M-23/M-37 de arriba quedan como SNAPSHOT congelado al alta.
      sealedProductId: r.sealedProductId,
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
            const r = await this.resolveCreation(line, actorUserId);
            if (r.sealedNeedsEscalate) {
              // v1.42 (BLOQ-2b): `sealedProductId` a la clave de la cola (ETB y blíster no colapsan).
              await this.pricing.escalatePending(
                r.card.id,
                line.productType,
                r.gradeKey,
                'inventory',
                undefined,
                r.finish,
                null,
                r.sealedProductId,
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
            // H-1 (SEC): el override manual del sellado se persiste AQUÍ, DENTRO de la tx del lote y
            // SOLO tras crear la(s) pieza(s) de la línea. Si la línea falla antes (p. ej. la creación
            // del item lanza), este punto no se alcanza y el override nunca se escribe; si el
            // `$transaction` completo hace rollback, el override se revierte con todo el lote. Atómico:
            // jamás queda un `PriceReference isManualOverride` huérfano de una línea `ok:false`.
            if (r.sealedManualOverride) {
              await this.applySealedManualOverride(r.sealedManualOverride, actorUserId, tx);
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
   *    de la curva de precios (v2.0, §4.36.1, SEC-A1) vía el SEAM ÚNICO `pricing.decideSalePrice` —
   *    sin rareza ni acabado como parámetro de monto (criterio 84); la rareza solo alimenta el
   *    veredicto del guardarraíl, que el propio seam devuelve junto al precio.
   *  - Una pieza cuyo precio NO se resuelve (sin `PriceReference`) o cuyo guardarraíl premium-en-el-
   *    piso dispara → `PRICE_PENDING`, NO se publica (regla "solo se lista lo que tiene precio",
   *    §4.9). Sellado sin override → `PRICE_PENDING`.
   *  - **Errores por-línea** (no encontrada, no `platform`, graded sin certNumber, precio pendiente)
   *    no tumban las demás → HTTP 200. Re-publicar una `listed` = no-op idempotente (`ok:true`).
   *  - Pago mínimo de BE-25: iza la curva (`PricingService.loadPricingCurve()`) UNA vez y usa
   *    `getReferencesBatch` (1 lote de referencias) — sin N+1 de settings ni de referencias.
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

    // v1.26 (P-7 ⑤, §4.24e): REPRECIO FRESCO on-demand ANTES de resolver el precio. Solo para las
    // líneas RAW cuyo precio se DERIVARÍA (sin override de línea ni de item) — así el fetch fresco no
    // gasta cuota en piezas con precio manual. Funciona sobre inventario UNPUBLISHED (`in_stock`): el
    // status de origen no cambia aquí; solo se refresca la `PriceReference` que leerá `getReferencesBatch`.
    // MONEY-SAFE: un fallo/agotamiento de cuota del reprecio NO tumba la publicación — se cae a la
    // referencia ALMACENADA (o, si sigue sin precio, al gate ④ que ESCALA a pendiente y NO publica).
    if (req.repriceFresh) {
      const freshPairs = req.items
        .map((line) => ({ line, item: byId.get(line.inventoryItemId) }))
        .filter(
          // H-1 (E5-bis): `<= 0` es AUSENTE en los dos niveles (línea y pieza), así que esa pieza SÍ
          // va a derivar precio y por tanto SÍ necesita el reprecio fresco.
          ({ line, item }) =>
            item != null &&
            item.productType === 'raw' &&
            !hasManualPrice(line) &&
            !hasManualPrice(item),
        )
        .map(({ item }) => item!);
      const freshCardIds = [...new Set(freshPairs.map((i) => i.cardId))];
      const freshFinishes = [...new Set(freshPairs.map((i) => i.finish))];
      if (freshCardIds.length > 0) {
        try {
          await this.pricing.refreshCardPrices(freshCardIds, freshFinishes);
        } catch (e) {
          // Nunca inventa ni pone 0: el fallo degrada a la ref almacenada/pending (gate ④).
          this.logger.warn(`repriceFresh falló (se usa ref almacenada): ${(e as Error).message}`);
        }
      }
    }

    // Pago mínimo BE-25: reglas de venta + spreads izados UNA vez; referencias y overrides M-30 en
    // lote (sin N+1). El pipeline por-pieza vive en los helpers compartidos con `publishAll`
    // (§4.26c: pipeline IDÉNTICO — un solo cuerpo, prohibido duplicarlo).
    const ctx = await this.loadPublishPricingCtx(items);

    const results: BulkPublishLineResult[] = [];
    let published = 0;
    for (let index = 0; index < req.items.length; index++) {
      const line = req.items[index];
      const item = byId.get(line.inventoryItemId);
      // v1.26 (④): id de la entrada pendiente si esta línea escala por priceless (deep-link a M2).
      let pendingPriceEntryId: string | undefined;
      try {
        if (!item) throw BusinessException.notFound('NOT_FOUND', 'Inventory item not found');
        this.assertPublishableGuards(item);

        const resolved = await this.resolvePublishSalePrice(item, line.listPriceCents ?? null, ctx);
        if (!resolved.ok) {
          pendingPriceEntryId = resolved.pendingPriceEntryId;
          throw BusinessException.validation('PRICE_PENDING', resolved.message);
        }

        await this.claimListed(item, line.listPriceCents);
        published++;
        results.push({
          index,
          inventoryItemId: line.inventoryItemId,
          ok: true,
          status: 'listed',
          salePriceCents: resolved.salePriceCents,
          priceSource: resolved.priceSource,
        });
      } catch (e) {
        const err = e as BusinessException;
        results.push({
          index,
          inventoryItemId: line.inventoryItemId,
          ok: false,
          error: { code: err.code ?? 'VALIDATION_ERROR', message: err.message ?? 'error' },
          // v1.26 (④): solo presente cuando la línea escaló por priceless (PRICE_PENDING).
          ...(pendingPriceEntryId ? { pendingPriceEntryId } : {}),
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

  // ============ v1.28 (P-19, §4.26c) — pipeline de publicación COMPARTIDO + publish-all ============

  /**
   * Iza el contexto de precio de publicación (pago mínimo BE-25): reglas de venta + spreads del
   * sellado + referencias y overrides M-30 EN LOTE para las piezas que DERIVAN precio. Para el
   * SELLADO derivable la clave del lote es la de MERCADO (`sealed:tcg:<productId>`, finish normal);
   * un sellado no mapeado no aporta clave (sin market → solo override). Los overrides M-30 solo
   * aplican a raw/graded (el sellado conserva su cadena H-1, §4.26b).
   */
  private async loadPublishPricingCtx(
    items: PublishableItem[],
    base?: Pick<PublishPricingCtx, 'curve' | 'sealed'>,
  ): Promise<PublishPricingCtx> {
    const curve = base?.curve ?? (await this.pricing.loadPricingCurve());
    const sealed = base?.sealed ?? (await this.pricing.loadSealedSpreads());
    const derivable = items
      // H-1 (E5-bis): `<= 0` es AUSENTE ⇒ la pieza deriva precio y necesita su referencia en el lote.
      .filter((i) => !hasManualPrice(i))
      .flatMap((i): { cardId: string; productType: ProductType; gradeKey: string; finish: Finish }[] => {
        if (i.productType === 'sealed') {
          const gk = this.pricing.sealedMarketGradeKeyForItem(i);
          return gk ? [{ cardId: i.cardId, productType: 'sealed', gradeKey: gk, finish: 'normal' }] : [];
        }
        return [{ cardId: i.cardId, productType: i.productType, gradeKey: this.pricing.gradeKeyFor(i), finish: i.finish }];
      });
    const refs = await this.pricing.getReferencesBatch(derivable);
    const variantOverrides = await this.pricing.getVariantOverridesBatch(
      derivable.filter((d) => d.productType !== 'sealed'),
    );
    return { curve, sealed, refs, variantOverrides };
  }

  /**
   * Guards por-pieza compartidos por `bulkPublish` y `publishAll` (pipeline IDÉNTICO §4.26c):
   *  - solo inventario de PLATAFORMA;
   *  - [MONEY · WS-E] status de ORIGEN ∈ {in_stock, listed} (anti-double-sell: publicar una
   *    reserved/in_custody/lost/... la re-abriría a un segundo checkout);
   *  - gradeada exige `certNumber` para publicarse (v1.2/M-12).
   */
  private assertPublishableGuards(item: PublishableItem): void {
    if (item.ownerType !== 'platform') {
      throw BusinessException.validation('VALIDATION_ERROR', 'item is not platform inventory');
    }
    if (!PUBLISHABLE_ORIGIN_STATUSES.includes(item.status)) {
      throw BusinessException.validation(
        'ITEM_NOT_PUBLISHABLE',
        `item status '${item.status}' cannot be published`,
        { status: item.status },
      );
    }
    if (item.productType === 'graded' && (!item.certNumber || item.certNumber.trim() === '')) {
      throw BusinessException.validation(
        'VALIDATION_ERROR',
        'graded items require certNumber to be published',
      );
    }
  }

  /**
   * Precio de publicación de UNA pieza — precedencia NORMATIVA v1.28 (§4.26b/§4.26c):
   * `listPriceCents (línea o pieza) > [sealed: H-1 override/mercado×spread | raw/graded:
   * sellOverride M-30 > regla por rareza+acabado] > PRICE_PENDING`.
   * Priceless ⇒ ESCALA a la cola (④ v1.26, `context='inventory'`, dedupe idempotente) y devuelve
   * `ok:false` (la pieza NO se publica; money-safe, jamás se lista sin precio). SEC-A1: todo sale
   * de BD/settings, nada del DTO del cliente (el `lineListPrice` es el override manual del admin).
   */
  private async resolvePublishSalePrice(
    item: PublishableItem,
    lineListPriceCents: number | null,
    ctx: PublishPricingCtx,
  ): Promise<PublishPriceResolution> {
    // v1.51 (fase 8) — LA DECISIÓN sale del cuerpo compartido; aquí solo vive **el efecto**.
    const derived = this.derivePublishSalePrice(item, lineListPriceCents, ctx);
    if (derived.ok) {
      // §4.36.5c — SALIDA SIMÉTRICA: el MISMO seam que escala CIERRA. Si el barrido ya escribió una
      // `PriceReference` real y el precio volvió a resolver, la entrada `open` de esta clave se
      // cierra SOLA aquí, sin intervención manual.
      // ⚠️ **El alcance del cierre NO se ensancha en este refactor**: solo raw/graded con precio
      // DERIVADO, igual que antes. Un precio manual no dice nada sobre el mercado de la variante
      // (cerrar por él apagaría un aviso que sigue siendo cierto), y el sellado nunca cerró aquí.
      if (derived.pendingKey != null && derived.priceSource === 'derived') {
        await this.pricing.settlePendingForVariant(null, derived.pendingKey, 'inventory');
      }
      return { ok: true, salePriceCents: derived.salePriceCents, priceSource: derived.priceSource };
    }
    const k = derived.pendingKey;
    const pendingPriceEntryId =
      k.productType === 'sealed'
        ? // v1.42 (BLOQ-2b): `sealedProductId` de la pieza a la clave de la cola (ETB y blíster no colapsan).
          await this.pricing.escalatePending(
            k.cardId,
            'sealed',
            k.gradeKey,
            'inventory',
            undefined,
            'normal',
            null,
            k.sealedProductId ?? null,
          )
        : // ④ + §4.36.5c: escala con el gradeKey server-side + acabado del item (la cola es POR
          // acabado, M-19) y con la RAZÓN, que es lo que hace triable la cola en M2.
          await this.pricing.settlePendingForVariant(
            derived.pendingReason ?? 'no_market',
            { cardId: k.cardId, productType: k.productType, gradeKey: k.gradeKey, finish: k.finish },
            'inventory',
          );
    return { ok: false, message: derived.message, pendingPriceEntryId };
  }

  /**
   * v1.51 (fase 8, §4.39m.1) — **la precedencia de precio de publicación, SIN efectos.** Ver el
   * docblock de `PublishPriceDerivation`: esto lo leen la cola `pending-publish` (que **no puede
   * escribir**) y `resolvePublishSalePrice` (que **añade** la escalada/cierre de la cola de M2).
   *
   * Precedencia NORMATIVA v1.28 (§4.26b/§4.26c): `listPriceCents (línea o pieza) > [sealed: H-1
   * override/mercado×spread | raw/graded: sellOverride M-30 > curva] > PRICE_PENDING`.
   * SEC-A1: todo sale de BD/settings, nada del DTO del cliente (el `lineListPrice` es el override
   * manual del admin). **Sin dato de mercado el PISO NO GANA** (decisión LOCKED §4.36.0).
   */
  private derivePublishSalePrice(
    item: PublishableItem,
    lineListPriceCents: number | null,
    ctx: PublishPricingCtx,
  ): PublishPriceDerivation {
    // H-1 (E5-bis): precedencia línea → pieza con «presente ⇔ > 0». Con `??` un `0` en la LÍNEA
    // cortocircuitaba y enmascaraba el override de la pieza; con `firstPresentAmount` cae al
    // siguiente peldaño, que es lo que dice §4.36.6.
    const manual = firstPresentAmount(lineListPriceCents, item.listPriceCents);
    if (manual != null) {
      // Un `listPriceCents` por pieza/línea es el override manual de M1 (§4.36.6).
      return { ok: true, salePriceCents: manual, priceSource: 'manual', priceBasis: 'override', pendingKey: null };
    }
    if (item.productType === 'sealed') {
      // v1.23-sealed-sales (§4.23d): el sellado deriva por override/mercado×spread (resolver ÚNICO
      // H-1, mismo cuerpo que catálogo/Compra/grid). Sin override>0 y sin mercado → PRICE_PENDING.
      const gk = this.pricing.sealedMarketGradeKeyForItem(item);
      const ref = gk ? ctx.refs.get(`${item.cardId}|sealed|${gk}|normal`) : undefined;
      const sale = this.pricing.resolveSealedSalePrice(item, ref, ctx.sealed);
      if (sale.salePriceCents == null) {
        // ④: escala con el gradeKey de MERCADO; sellado no mapeado cae al gradeKey estructural.
        return {
          ok: false,
          message: 'No resolvable sale price for sealed (no override and no market); not published',
          pendingKey: {
            cardId: item.cardId,
            productType: 'sealed',
            gradeKey: gk ?? this.pricing.gradeKeyFor(item),
            finish: 'normal',
            sealedProductId: item.sealedProductId,
          },
          pendingReason: null,
        };
      }
      // `pendingKey: null` ⇒ el sellado NO cierra la cola por esta vía (conducta preexistente).
      return {
        ok: true,
        salePriceCents: sale.salePriceCents,
        priceSource: 'derived',
        priceBasis: sealedPriceBasisOf(sale),
        pendingKey: null,
      };
    }
    // raw/graded — v2.0 (P-48, §4.36.1): derivado server-side (SEC-A1) por la CURVA sobre el VALOR DE
    // MERCADO del acabado de ESTA pieza. Ya no depende de la rareza ni del acabado (criterio 84); el
    // sellOverride de la variante (M-30) pisa la curva (misma precedencia que storefront/checkout).
    // SIN dato de mercado ⇒ PRICE_PENDING y escala a la cola: el PISO NO gana (decisión LOCKED).
    const gradeKey = this.pricing.gradeKeyFor(item);
    const key = `${item.cardId}|${item.productType}|${gradeKey}|${item.finish}`;
    const ref = ctx.refs.get(key);
    const refCents = ref && ref.status === 'priced' ? (ref.referenceMxnCents ?? null) : null;
    // v2.0 (P-48, §4.36.5b) — SEAM ÚNICO del eje de venta (versión síncrona: la curva ya viene izada
    // por el lote, BE-25). Monto + veredicto en UNA llamada: `no_market` (sin dato ⇒ el piso NO gana) o
    // `premium_at_floor` (guardarraíl: una chase en el piso solo puede significar dato de mercado malo).
    // NO dispara con override ni bounty.
    const sale = this.pricing.decideSalePrice({
      referenceMxnCents: refCents,
      // SOLO para el veredicto (criterio 84): no entra al monto.
      rarityCanonical: item.card.rarityCanonical ?? item.card.rarity,
      controls: ctx.variantOverrides.get(key) ?? null,
      curve: ctx.curve,
    });
    const pendingReason = sale.pendingReason;
    if (pendingReason != null || sale.priceCents == null) {
      return {
        ok: false,
        message:
          pendingReason === 'premium_at_floor'
            ? 'Premium rarity resolved to the floor (bad market data); not published — escalated to the pending queue'
            : 'No resolvable sale price (no market reference); not published',
        pendingKey: {
          cardId: item.cardId,
          productType: item.productType,
          gradeKey,
          finish: item.finish,
        },
        pendingReason,
      };
    }
    return {
      ok: true,
      salePriceCents: sale.priceCents,
      priceSource: 'derived',
      priceBasis: sale.basis,
      pendingKey: { cardId: item.cardId, productType: item.productType, gradeKey, finish: item.finish },
    };
  }

  /**
   * ⚠️ v1.51 (fase 8, D10, criterio 125 · ARCHITECTURE §4.39m.1/m.2) — **QUÉ LE FALTA A ESTA PIEZA
   * PARA ESTAR A LA VENTA.** Cuerpo ÚNICO de la pregunta, leído por la cola
   * (`GET /admin/inventory/pending-publish`) y por los disparadores de auto-publicación.
   *
   * > *«Comprar bien y dejar la carta en una caja sin precio es comprar mal.»*
   *
   * **NO ESCRIBE NADA** (usa `derivePublishSalePrice`, no `resolvePublishSalePrice`): la cola es un
   * `GET` y un `GET` que abre y cierra entradas de la cola de precio pendiente **por el hecho de que
   * alguien mire la pantalla** sería un efecto invisible sobre dinero.
   *
   * El `pendingPriceEntryId` sale de la cola de M2 **si ya existe** una entrada `open` para esa
   * variante — se pasa ya resuelto (`openPendingByKey`), en lote, porque una consulta por fila sería
   * N+1 sobre una cola que puede tener cientos.
   */
  private pendingPublishStateOf(item: PublishableItem, ctx: PublishPricingCtx): PendingPublishState {
    const missing: PendingPublishMissing[] = [];
    // ⚠️ La ubicación va PRIMERA porque es la que el operador puede arreglar sin depender de nadie:
    // es un dato de captura, no un dato de mercado.
    if (item.locationId == null) missing.push('location');
    const derived = this.derivePublishSalePrice(item, null, ctx);
    if (derived.ok) {
      return {
        missing,
        resolvedSalePriceCents: derived.salePriceCents,
        priceBasis: derived.priceBasis,
      };
    }
    missing.push('price');
    return {
      missing,
      // La llave viaja para que el deep-link se empareje con la entrada REAL de la cola de M2, sin
      // recalcular la derivación ni inventar una llave en el sitio.
      pendingQueueKey: pendingQueueKey(derived.pendingKey),
      resolvedSalePriceCents: null,
      // `pending` NO es «no sé»: es el veredicto explícito de que la variante no tiene precio
      // publicable. El storefront ya lo trata así (§N.5) y la cola dice lo mismo, no otra cosa.
      priceBasis: 'pending',
    };
  }

  /**
   * ⚠️ v1.51 (fase 8, D10, criterio 125) — **`GET /admin/inventory/pending-publish`: LA COLA DE
   * «LISTAS PARA PUBLICAR».**
   *
   * El defecto que cierra, y es el que preguntó el humano (*«cómo la subimos a inventario, porque ahí
   * ya tenemos para publicar»*): una pieza recién convertida nace `in_stock` **sin ubicación y sin
   * precio**, y hasta ahora **nada la empujaba a la venta ni la señalaba**. Peor: **sin dato de
   * mercado quedaba invisible por partida doble** —ni a la venta, ni en la cola de precio pendiente,
   * porque esa escalada solo ocurría **cuando alguien intentaba publicarla**—. *Una carta comprada y
   * pagada podía quedarse quieta para siempre sin que nada lo señalara.*
   *
   * Predicado (§4.39m.1): `ownerType='platform' ∧ status='in_stock' ∧ (locationId IS NULL ∨ precio NO
   * resoluble)`.
   *
   * ### ⚠️ Por qué esto barre y no pagina en SQL, dicho sin adornos
   * *«Precio no resoluble»* **no es expresable en SQL**: depende de la curva vigente, de las
   * referencias de mercado y de los overrides de variante. Las opciones eran barrer o **reimplementar
   * la precedencia de precios en una consulta** — que es la copia que este proyecto lleva quince
   * revisiones borrando, y encima sobre dinero. Se barre el superconjunto **que SÍ es SQL**
   * (`platform ∧ in_stock`, el mismo que ya barre `publish-all`) **por chunks**, con referencias y
   * overrides en lote por chunk, y se filtra en memoria. **Solo se retienen las filas pendientes**,
   * que en un sistema sano son pocas: lo que crece es el escaneo, no la memoria.
   * ⚠️ **Y `total` es el conteo REAL de la cola, no el del superconjunto**: una cola que dijera «200»
   * cuando hay 900 sería peor que no tener cola. Señalado al arquitecto como punto de escala.
   *
   * `missing` dice **QUÉ le falta**; con `'price'` viaja el `pendingPriceEntryId` para el deep-link a
   * la cola de M2. **La pieza sin ubicación sale SEÑALADA, no bloqueada** (m.3): la conversión no
   * exige ubicación a propósito — *bloquearla atoraría el pago al vendedor, y el pago no puede
   * depender de que ya sepamos en qué caja va la carta*.
   */
  async pendingPublish(q: {
    missing?: PendingPublishMissing;
    acquisitionType?: AcquisitionType;
    setId?: string;
    page: number;
    pageSize: number;
  }) {
    const where: Prisma.InventoryItemWhereInput = {
      ownerType: 'platform',
      status: 'in_stock',
      ...(q.acquisitionType ? { acquisitionType: q.acquisitionType } : {}),
      ...(q.setId ? { card: { setId: q.setId } } : {}),
      // Cuando se filtra por `missing=location` el predicado SÍ es SQL: se empuja a la BD para no
      // barrer de más. `missing=price` no puede empujarse — ver el bloque de arriba.
      ...(q.missing === 'location' ? { locationId: null } : {}),
    };
    const selectedIds = (
      await this.prisma.inventoryItem.findMany({
        where,
        select: { id: true },
        // Orden ESTABLE y determinista: la paginación de una cola que se trabaja no puede reordenar
        // filas entre página y página. `createdAt` primero (lo más viejo pesa más) y `id` desempata.
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      })
    ).map((r) => r.id);

    const curve = await this.pricing.loadPricingCurve();
    const sealed = await this.pricing.loadSealedSpreads();
    // Del barrido solo sobreviven **id + estado**: es lo que mantiene la memoria acotada aunque el
    // superconjunto sea grande. Las filas completas se leen después, y SOLO las de la página.
    const pending: { id: string; state: PendingPublishState }[] = [];
    for (let i = 0; i < selectedIds.length; i += PENDING_PUBLISH_CHUNK_SIZE) {
      const chunkIds = selectedIds.slice(i, i + PENDING_PUBLISH_CHUNK_SIZE);
      const items = await this.prisma.inventoryItem.findMany({
        where: { id: { in: chunkIds } },
        include: { card: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      const ctx = await this.loadPublishPricingCtx(items, { curve, sealed });
      for (const item of items) {
        const state = this.pendingPublishStateOf(item, ctx);
        // `missing: []` ⇒ NO entra: no le falta nada, así que la auto-publicación la sacará (o ya la
        // sacó). Una cola que listara piezas sin pendiente enseñaría a ignorarla.
        if (state.missing.length === 0) continue;
        if (q.missing && !state.missing.includes(q.missing)) continue;
        pending.push({ id: item.id, state });
      }
    }

    const total = pending.length;
    const slice = pending.slice((q.page - 1) * q.pageSize, q.page * q.pageSize);
    const byId = new Map(slice.map((r) => [r.id, r.state]));
    const rows = await this.prisma.inventoryItem.findMany({
      where: { id: { in: slice.map((r) => r.id) } },
      // `set` SOLO aquí: `toCardDTO` lo necesita y el barrido no. Traerlo en el barrido sería pagar
      // el join por todo el inventario para pintar una página.
      include: { card: { include: { set: true } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    // El `pendingPriceEntryId` se resuelve SOLO para la página devuelta: es un deep-link de UI, y
    // consultarlo para toda la cola sería trabajo que nadie va a mirar.
    const openPendingByKey = await this.openPendingEntriesFor(rows);
    const pricedByCard = await this.pricing.getPricedRawFinishesBatch(rows.map((r) => r.cardId));
    const data = rows.map((item) => {
      const state = byId.get(item.id) as PendingPublishState;
      const entryId = state.pendingQueueKey
        ? (openPendingByKey.get(state.pendingQueueKey) ?? null)
        : null;
      return {
        inventoryItemId: item.id,
        folio: item.folio,
        card: toCardDTO(item.card, pricedByCard.get(item.cardId)),
        productType: item.productType,
        finish: item.finish,
        cardProductId: item.cardProductId,
        locationId: item.locationId,
        listPriceCents: item.listPriceCents,
        resolvedSalePriceCents: state.resolvedSalePriceCents,
        priceBasis: state.priceBasis,
        pendingPriceEntryId: entryId,
        missing: state.missing,
        acquisitionType: item.acquisitionType,
        sourceSellRequestItemId: item.sourceSellRequestItemId,
        createdAt: item.createdAt,
      };
    });
    return { data, page: q.page, pageSize: q.pageSize, total };
  }

  /**
   * Entradas `open` de la cola de precio pendiente para las variantes de estas piezas, EN LOTE
   * (`Map<pendingQueueKey, entryId>`). Es una LECTURA: no escala nada — quien escala es el intento
   * de publicación, y ésa es justamente la diferencia que la fase 8 vino a marcar.
   */
  private async openPendingEntriesFor(items: PublishableItem[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (items.length === 0) return map;
    const rows = await this.prisma.pendingPriceEntry.findMany({
      where: { status: 'open', cardId: { in: [...new Set(items.map((i) => i.cardId))] } },
      select: {
        id: true,
        cardId: true,
        productType: true,
        gradeKey: true,
        finish: true,
        sealedProductId: true,
      },
      orderBy: { createdAt: 'asc' },
    });
    for (const r of rows) {
      const k = pendingQueueKey({
        cardId: r.cardId,
        productType: r.productType,
        gradeKey: r.gradeKey,
        finish: r.finish,
        sealedProductId: r.sealedProductId,
      });
      // La MÁS ANTIGUA gana (orden asc): el deep-link lleva a la entrada que lleva más esperando.
      if (!map.has(k)) map.set(k, r.id);
    }
    return map;
  }

  /**
   * Transición ATÓMICA a `listed` ([BE-45], compartida): el paso es CONDICIONAL al allowlist en el
   * MISMO UPDATE (updateMany + count). Cierra el TOCTOU: si entre lectura y escritura la pieza salió
   * de {in_stock, listed} (p. ej. un checkout la reservó), count=0 → ITEM_NOT_PUBLISHABLE y NO se
   * re-abre a un segundo comprador (anti double-sell). Persiste el override manual POR LÍNEA si vino.
   */
  private async claimListed(item: PublishableItem, lineListPriceCents?: number): Promise<void> {
    const claimed = await this.prisma.inventoryItem.updateMany({
      where: {
        id: item.id,
        ownerType: 'platform',
        status: { in: [...PUBLISHABLE_ORIGIN_STATUSES] },
      },
      data: {
        status: 'listed',
        ...(lineListPriceCents != null ? { listPriceCents: lineListPriceCents } : {}),
      },
    });
    if (claimed.count !== 1) {
      throw BusinessException.validation(
        'ITEM_NOT_PUBLISHABLE',
        'item can no longer be published (concurrent status transition)',
        { status: item.status },
      );
    }
  }

  /**
   * v1.28 (P-19, §4.26c) — POST /admin/inventory/publish-all: publicar TODO el inventario (o un
   * filtro) de golpe. Selección SERVER-SIDE (`ownerType=platform` + `status ∈ {in_stock, listed}` ±
   * `setId`/`productType`), SIN cap de selección (proceso por chunks); pipeline por-pieza IDÉNTICO a
   * `bulk-publish` (helpers compartidos): precio server-side SEC-A1 con la precedencia v1.28,
   * PRICE_PENDING escala (④) y NO publica. **Tolerante por-ítem: el lote JAMÁS revienta completo.**
   * Idempotencia por `batchKey` (`InventoryBatch kind='publish_all'`; replay ⇒ resultado guardado +
   * `idempotentReplay:true`). La auditoría (`inventory.publish_all`) la escribe el controller.
   *
   * v2.1.1 (§4.36.5b-bis) — este endpoint ES el paso 2 del CUT-OVER de la curva (§4.36.9c): como el
   * precio de venta se resuelve EN LECTURA y no está persistido, «repriciar el catálogo» = RE-RESOLVER,
   * y esto es lo que lo hace. Por eso la selección incluye lo ya `listed` y su rama RE-RESUELVE:
   * - vuelve a resolver ⇒ sigue `listed`, cuenta en `alreadyListed` (que ahora significa
   *   «re-verificada y sana», no «no la toqué»);
   * - no resuelve ⇒ escala a la cola con su `reason`, cuenta en `pendingPrice` Y en el subcontador
   *   `listedNowPending`, y **NO cambia de status**.
   */
  async publishAll(req: PublishAllRequestDto, actorUserId: string): Promise<PublishAllResponse> {
    // Replay idempotente por batchKey. Un batchKey ya usado por OTRO tipo de lote no se "replay-ea"
    // con un shape ajeno: 409 (la key identifica UN lote concreto).
    if (req.batchKey) {
      const existing = await this.prisma.inventoryBatch.findUnique({ where: { id: req.batchKey } });
      if (existing) {
        if (existing.kind !== 'publish_all') {
          throw BusinessException.conflict(
            'CONFLICT',
            'batchKey already used by a different batch kind',
            { kind: existing.kind },
          );
        }
        const stored = existing.resultJson as unknown as PublishAllResponse;
        return { ...stored, idempotentReplay: true };
      }
    }
    // Filtros inválidos → 400 VALIDATION_ERROR (contrato §M1). `productType` ya lo valida el DTO.
    if (req.setId) {
      const set = await this.prisma.cardSet.findUnique({
        where: { id: req.setId },
        select: { id: true },
      });
      if (!set) {
        throw BusinessException.badRequest('VALIDATION_ERROR', 'setId does not match any CardSet', {
          setId: req.setId,
        });
      }
    }

    // Selección server-side: SNAPSHOT de ids (solo ids — sin cap).
    //
    // ⚠️ NO SUSTITUIR POR UN RE-QUERY DEL PREDICADO (§4.36.5b-bis, nota de implementación). Iterar
    // por snapshot es lo que GARANTIZA TERMINACIÓN, y con `listed` dentro de la allowlist pasa de
    // conveniente a IMPRESCINDIBLE: una pieza que escala SIGUE `listed` (decisión 3: escalar no le
    // cambia el status), así que seguiría casando el predicado y un re-query en bucle no terminaría
    // nunca. Lo mismo valía antes para la `in_stock` que queda PRICE_PENDING.
    //
    // v2.1.1 (§4.36.5b-bis): la selección se ensancha a `{in_stock, listed}` — la MISMA allowlist
    // `PUBLISHABLE_ORIGIN_STATUSES` que `bulkPublish` usa desde v1.16.1. No ensucia la semántica del
    // endpoint, la CORRIGE: el contrato ya declaraba su pipeline «IDÉNTICO a bulk-publish» y no lo
    // era. Sin esto, una pieza publicada cuyo mercado se degrada después dejaba de venderse en
    // SILENCIO y no entraba a la cola — lo contrario de §N.5 — y el paso 2 del cut-over (§4.36.9c)
    // daba un falso negativo justo sobre las piezas del reporte del dueño, que están `listed`.
    const selectedIds = (
      await this.prisma.inventoryItem.findMany({
        where: {
          ownerType: 'platform',
          status: { in: [...PUBLISHABLE_ORIGIN_STATUSES] },
          ...(req.productType ? { productType: req.productType } : {}),
          ...(req.setId ? { card: { setId: req.setId } } : {}),
        },
        select: { id: true },
        orderBy: { id: 'asc' },
      })
    ).map((r) => r.id);

    // Curva/spreads izados UNA vez por corrida; referencias/overrides en lote POR CHUNK
    // (memoria acotada; sigue sin N+1 por pieza).
    const curve = await this.pricing.loadPricingCurve();
    const sealed = await this.pricing.loadSealedSpreads();

    const summary = {
      selected: selectedIds.length,
      published: 0,
      alreadyListed: 0,
      pendingPrice: 0,
      failed: 0,
      listedNowPending: 0,
    };
    const failures: PublishAllFailure[] = [];
    const pushFailure = (f: PublishAllFailure) => {
      // Detalle CAPADO a 200 (contrato §M1): el remanente se opera por la cola M2 `?context=inventory`.
      if (failures.length < PUBLISH_ALL_FAILURES_CAP) failures.push(f);
    };

    for (let i = 0; i < selectedIds.length; i += PUBLISH_ALL_CHUNK_SIZE) {
      const chunkIds = selectedIds.slice(i, i + PUBLISH_ALL_CHUNK_SIZE);
      const items = await this.prisma.inventoryItem.findMany({
        where: { id: { in: chunkIds } },
        include: { card: true },
      });
      const ctx = await this.loadPublishPricingCtx(items, { curve, sealed });
      for (const item of items) {
        try {
          // v2.1.1 (§4.36.5b-bis) — la rama `listed` YA NO ES CORTO-CIRCUITO: se RE-RESUELVE.
          // Corto-circuitarla dejaba el punto ciego intacto y encima lo DISFRAZABA — cada pieza
          // degradada se contaba como `alreadyListed`, que se lee como «ésta ya estaba bien».
          // Seleccionar `listed` sin esto sería peor que no seleccionarla.
          const wasListed = item.status === 'listed';
          this.assertPublishableGuards(item);
          const resolved = await this.resolvePublishSalePrice(item, null, ctx);
          if (!resolved.ok) {
            // Ya escaló a la cola con su `reason` dentro de `resolvePublishSalePrice`. Si estaba
            // publicada, NO se le cambia el status: sigue `listed` (§4.36.5b-bis decisión 3). No hay
            // exposición que cerrar —la resolución EN LECTURA ya la sacó de Compra y de `stockCount`
            // (§4.9a)— y un flip `listed → in_stock` competiría con un checkout en vuelo que la
            // tenga reservada. La SEÑAL es la entrada en la cola, no el status.
            summary.pendingPrice++;
            if (wasListed) summary.listedNowPending++;
            pushFailure({
              inventoryItemId: item.id,
              folio: item.folio,
              error: { code: 'PRICE_PENDING', message: resolved.message },
              ...(resolved.pendingPriceEntryId
                ? { pendingPriceEntryId: resolved.pendingPriceEntryId }
                : {}),
            });
            continue;
          }
          if (wasListed) {
            // Re-verificada y SANA: no-op observable. No se re-cobra y no cambia el precio (que no
            // está persistido, §4.26b), así que ni siquiera se toca la fila.
            summary.alreadyListed++;
            continue;
          }
          await this.claimListed(item);
          summary.published++;
        } catch (e) {
          // Tolerante por-ítem: NINGÚN fallo individual tumba el lote.
          const err = e as BusinessException;
          summary.failed++;
          pushFailure({
            inventoryItemId: item.id,
            folio: item.folio,
            error: { code: err.code ?? 'VALIDATION_ERROR', message: err.message ?? 'error' },
          });
        }
      }
    }

    const response: PublishAllResponse = {
      ...(req.batchKey ? { batchKey: req.batchKey } : {}),
      idempotentReplay: false,
      summary,
      failures,
    };
    if (req.batchKey) {
      try {
        await this.prisma.inventoryBatch.create({
          data: {
            id: req.batchKey,
            actorUserId,
            kind: 'publish_all',
            requested: summary.selected,
            createdItems: summary.published,
            failedLines: summary.pendingPrice + summary.failed,
            resultJson: response as unknown as Prisma.InputJsonValue,
          },
        });
      } catch (e) {
        // P2002 = otra corrida ganó la carrera por este batchKey → devuelve SU resultado (replay).
        // Piece-safe aunque ambas corrieran: la guardia atómica de `claimListed` impide doble publish.
        if ((e as { code?: string })?.code === 'P2002') {
          const claimed = await this.prisma.inventoryBatch.findUnique({
            where: { id: req.batchKey },
          });
          if (claimed && claimed.kind === 'publish_all') {
            const stored = claimed.resultJson as unknown as PublishAllResponse;
            return { ...stored, idempotentReplay: true };
          }
        }
        throw e;
      }
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
      if (dto.sealedSubtype || dto.sealedCondition || dto.gradingCompany || dto.gradeValue) {
        throw BusinessException.validation(
          'VALIDATION_ERROR',
          'raw items carry no sealedSubtype/sealedCondition/grade',
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
      if (dto.rawCondition || dto.sealedSubtype || dto.sealedCondition) {
        throw BusinessException.validation(
          'VALIDATION_ERROR',
          'graded items carry no rawCondition/sealedSubtype/sealedCondition',
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
    // v1.28 (P-17, §4.26d): filtros ADITIVOS del drill-down por casilla (validados contra sus
    // enums por el controller → 400 VALIDATION_ERROR; omitidos = comportamiento actual). Con
    // `cardId+finish` sirven las copias físicas de una variante del Master Set; con
    // `cardId+productType=sealed|graded`, los drill-downs de las pestañas Sellado (P-25) y
    // Gradeadas (P-20). Solo REDUCEN el conjunto ya autorizado por rol.
    finish?: Finish;
    productType?: ProductType;
    page: number;
    pageSize: number;
  }) {
    const where: Prisma.InventoryItemWhereInput = {};
    if (q.status) where.status = q.status as never;
    if (q.cardId) where.cardId = q.cardId;
    if (q.ownerType) where.ownerType = q.ownerType as never;
    if (q.locationId) where.locationId = q.locationId;
    if (q.zone) where.location = { zone: q.zone as never };
    if (q.finish) where.finish = q.finish;
    if (q.productType) where.productType = q.productType;
    if (q.q) where.OR = [{ folio: { contains: q.q, mode: 'insensitive' } }];
    const [rows, total] = await Promise.all([
      this.prisma.inventoryItem.findMany({
        where,
        include: { card: true, location: true },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.inventoryItem.count({ where }),
    ]);
    const data = await this.attachSealedMarketRefs(rows);
    return { data, page: q.page, pageSize: q.pageSize, total };
  }

  /**
   * v1.19-sealed-tcgcsv (API_CONTRACT §M1, READ-ONLY) — adjunta `sealedMarketRef: PriceInfo`
   * a los items SELLADOS del listado: la referencia de mercado TCGCSV del producto mapeado
   * (`getReference(cardId, 'sealed', sealed:tcg:<productId>, 'normal')`, la más reciente).
   * `null` si el item no está mapeado o aún no hay ingest. Resuelta POR LOTE vía
   * `getReferencesBatch` (BE-25) — sin N+1. Es INFORMATIVA (sugerencia junto a
   * `listPriceCents`); no cambia publicación, valuación ni venta (§4.19a).
   */
  private async attachSealedMarketRefs<
    T extends { id: string; cardId: string; productType: string; tcgplayerProductId: number | null },
  >(rows: T[]): Promise<(T & { sealedMarketRef?: PriceInfo | null })[]> {
    const mapped = rows.filter(
      (r) => r.productType === 'sealed' && r.tcgplayerProductId != null,
    );
    const refs = await this.pricing.getReferencesBatch(
      mapped.map((r) => ({
        cardId: r.cardId,
        productType: 'sealed' as const,
        gradeKey: sealedMarketGradeKey(r.tcgplayerProductId as number),
        finish: 'normal' as const,
      })),
    );
    return rows.map((r) => {
      if (r.productType !== 'sealed') return r;
      const ref =
        r.tcgplayerProductId != null
          ? refs.get(
              `${r.cardId}|sealed|${sealedMarketGradeKey(r.tcgplayerProductId)}|normal`,
            )
          : undefined;
      // Contrato §M1: null si no mapeado o sin ingest (pending NO se expone como PriceInfo).
      return { ...r, sealedMarketRef: ref && ref.status === 'priced' ? ref : null };
    });
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
    const relations = { card: item.card, location: item.location, movements: item.movements };
    // v1.19-sealed-tcgcsv (§M1): el detalle de un sellado expone la referencia TCGCSV
    // (read-only). Misma regla que el listado: null sin mapeo o sin ingest.
    if (item.productType === 'sealed') {
      let ref: PriceInfo | null = null;
      if (item.tcgplayerProductId != null) {
        const found = await this.pricing.getReference(
          item.cardId,
          'sealed',
          sealedMarketGradeKey(item.tcgplayerProductId),
          'normal',
        );
        ref = found.status === 'priced' ? found : null;
      }
      return { ...toAdminInventoryItemRow(item), ...relations, sealedMarketRef: ref };
    }
    // S49-R4: la cabecera pasa por la lista blanca; las relaciones del `include` se adjuntan aparte
    // (`card`, `location`, `movements` son la vista de detalle de M1, no columnas de la fila).
    return { ...toAdminInventoryItemRow(item), ...relations };
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
    // ⚠️ v1.51 (fase 8, ARCHITECTURE §4.39m.4 · desviación INV-P1) — **SE CIERRA EL BYPASS DE
    // PUBLICACIÓN.** Hasta aquí este `PATCH` era un `update` plano: validaba el `certNumber` de una
    // gradeada **y nada más**. **No** corría `assertPublishableGuards`, **no** resolvía precio y
    // **no** hacía el `claimListed` atómico. Consecuencia exacta: aceptaba marcar `listed` una pieza
    // **sin precio resoluble** ⇒ el storefront **la descartaba en silencio** y **no entraba a ninguna
    // cola** — invisible para el comprador y para el operador **a la vez**. La contradicción exacta
    // de la fase 8 (*«ninguna pieza adquirida se queda invisible»*), y además un camino que se
    // saltaba la guarda **anti-double-sell** que los dos caminos de lote sí corren.
    //
    // **Norma:** cuando el PATCH **RESULTA** en `listed` y el estado previo **no** era `listed`, corre
    // el **pipeline completo**, con los MISMOS códigos que el lote (`422 ITEM_NOT_PUBLISHABLE`,
    // `422 PRICE_PENDING` con su `pendingPriceEntryId`).
    //
    // ⚠️ **`listPriceCents` NO se toca**: es el override manual por pieza de M1 y **precede a este
    // ciclo**. D10 prohíbe capturar precio de venta *dentro del ciclo de buylist* (por eso
    // `convert-to-inventory` no lo acepta); no retira una perilla de M1 que ya existía. Aquí ALIMENTA
    // la resolución, como el override por línea del `bulk-publish`.
    const publishing = resultingStatus === 'listed' && current.status !== 'listed';
    if (!publishing) {
      // S49-R4: proyectado (antes devolvía la entidad `InventoryItem` cruda).
      return toAdminInventoryItemRow(
        await this.prisma.inventoryItem.update({ where: { id }, data: dto }),
      );
    }
    // ⚠️ Las guardas corren sobre el estado **RESULTANTE**, en memoria y ANTES de escribir nada: una
    // gradeada que gana su `certNumber` en ESTE mismo PATCH debe poder publicarse, y una que falle
    // **no debe dejar a medias** el resto de los campos.
    const { status: _status, ...fields } = dto;
    // ⚠️ La fila CRUDA (con su `card`), no la proyección de `getItem`: el pipeline de publicación
    // trabaja sobre columnas del modelo, y la proyección de M1 es una lista blanca de presentación.
    const raw = await this.prisma.inventoryItem.findUnique({
      where: { id },
      include: { card: true },
    });
    if (!raw) throw BusinessException.notFound();
    const resulting: PublishableItem = { ...raw, ...fields };
    this.assertPublishableGuards(resulting);
    const ctx = await this.loadPublishPricingCtx([resulting]);
    const resolved = await this.resolvePublishSalePrice(resulting, dto.listPriceCents ?? null, ctx);
    if (!resolved.ok) {
      // El `PRICE_PENDING` **no es un rechazo seco**: `resolvePublishSalePrice` YA escaló a la cola
      // de M2, así que la pieza **queda visible** donde se trabaja. *Es un pendiente visible, no una
      // carta perdida.*
      throw BusinessException.validation('PRICE_PENDING', resolved.message, {
        ...(resolved.pendingPriceEntryId ? { pendingPriceEntryId: resolved.pendingPriceEntryId } : {}),
      });
    }
    // Los campos no-status primero; el `listed` lo pone `claimListed` con su guarda atómica.
    if (Object.keys(fields).length > 0) {
      await this.prisma.inventoryItem.update({ where: { id }, data: fields });
    }
    await this.claimListed(resulting, dto.listPriceCents);
    return toAdminInventoryItemRow({ ...resulting, status: 'listed' });
  }

  /**
   * ⚠️ v1.51 (fase 8, §4.39m.2, criterio 125) — **AUTO-PUBLICACIÓN: «ubicación + precio ⇒ publicada»,
   * SIN BOTÓN.** *La pieza sale sola de la cola en cuanto no le falta nada — sin depender de que
   * alguien se acuerde de apretar un botón.*
   *
   * Corre el **pipeline COMPLETO** (`assertPublishableGuards` + `resolvePublishSalePrice` +
   * `claimListed`), el mismo de los caminos de lote: **no hay una segunda forma de publicar**.
   *
   * ### ⚠️ Best-effort, y aquí sí es lo correcto — la distinción importa
   * *«Las escrituras no degradan»* (v1.51.14) gobierna **lo que se compromete**. Aquí el hecho que se
   * compromete —mover la pieza a su caja— **ya está escrito**; esto es un intento **oportunista**
   * encima, y su fallo más común (**no hay precio de mercado**) es **el caso normal**, no una avería:
   * es exactamente lo que la Regla de Compra ordena (§A). Si tumbara el `move`, el operador **no
   * podría ni guardar la ubicación** de una carta sin precio.
   * ⚠️ **Y el fallo NO es silencioso**, que es lo que lo hace aceptable: `resolvePublishSalePrice`
   * **escala a la cola de precio pendiente** y la pieza **sigue en `pending-publish`**. *Se degrada
   * el intento, nunca la visibilidad.*
   */
  private async tryAutoPublish(itemId: string, trigger: string): Promise<PendingPublishState | null> {
    const item = await this.prisma.inventoryItem.findUnique({
      where: { id: itemId },
      include: { card: true },
    });
    if (!item) return null;
    const ctx = await this.loadPublishPricingCtx([item]);
    // El estado se calcula ANTES del intento y con el cuerpo de solo lectura: es lo que se devuelve
    // al llamador (`pendingPublish` del contrato) y lo que decide si hay algo que intentar.
    const state = this.pendingPublishStateOf(item, ctx);
    if (item.locationId == null) {
      // Sin ubicación no se publica **y no se escala nada**: el hueco es de captura, no de mercado.
      // Escalar aquí ensuciaría la cola de M2 con piezas cuyo precio sí resuelve.
      return state;
    }
    try {
      this.assertPublishableGuards(item);
      const resolved = await this.resolvePublishSalePrice(item, null, ctx);
      if (!resolved.ok) {
        // Ya escaló a la cola de M2 dentro de `resolvePublishSalePrice`: la pieza queda VISIBLE.
        return {
          ...state,
          missing: state.missing.includes('price') ? state.missing : [...state.missing, 'price'],
          resolvedSalePriceCents: null,
          priceBasis: 'pending',
        };
      }
      await this.claimListed(item);
      this.logger.log(`auto-publish (${trigger}): ${item.folio} publicada`);
      return { ...state, missing: [] };
    } catch (e) {
      // `ITEM_NOT_PUBLISHABLE` por carrera (un checkout la reservó entre medias) y cualquier otro
      // fallo: se registra y **no se propaga**. El hecho que disparó el intento ya está escrito.
      this.logger.warn(
        `auto-publish (${trigger}) skipped for ${item.folio}: ${e instanceof Error ? e.message : String(e)}`,
      );
      return state;
    }
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
    const moved = await this.prisma.inventoryItem.update({
      where: { id },
      data: { locationId: dto.toLocationId },
    });
    // ⚠️ v1.51 (fase 8, §4.39m.2) — **DISPARADOR (b): al fijar/mover ubicación.** Éste es el momento
    // en que a una pieza convertida deja de faltarle lo único que le faltaba. Va DESPUÉS del update
    // (la ubicación es el hecho; publicar es la consecuencia) y es best-effort — ver `tryAutoPublish`.
    await this.tryAutoPublish(id, 'move');
    // S49-R4: proyectado. Se relee para que el `status` refleje una publicación que acaba de ocurrir.
    return toAdminInventoryItemRow(
      (await this.prisma.inventoryItem.findUnique({ where: { id } })) ?? moved,
    );
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
    // S49-R4: proyectado.
    return toAdminInventoryItemRow(await this.prisma.inventoryItem.update({ where: { id }, data: { status } }));
  }

  // ---------------- v1.20 §4.20e — Ajuste por levantamiento físico ----------------

  /**
   * POST /admin/inventory/adjustments — ajuste de inventario por LEVANTAMIENTO FÍSICO desde la
   * celda del binder M1 (scope plataforma). Motivo OBLIGATORIO (`AdjustmentReason`):
   *  - `encontrada` → CREA pieza(s) reusando la lógica de alta (`resolveCreation`/`buildItemData`;
   *    `acquisitionType` default `aportacion_en_especie`, con su `PRICE_PENDING` normal; `qty`
   *    default 1, graded fuerza 1). Nacen `in_stock`, ownerType=platform.
   *  - `perdida | danada` → `status → lost | damaged` (habilita reposición/merma M7/tope M10).
   *  - `error_captura` → `status → withdrawn` (la pieza NUNCA existió físicamente; NO cuenta como
   *    pérdida/reposición — el motivo real queda tipado en `InventoryAdjustment.reason`).
   * Registro TRIPLE por pieza: fila `InventoryAdjustment` (M-24) + `InventoryMovement` con
   * `reason=adjustment` (en la MISMA transacción); el `AuditLog action=inventory.adjustment` lo
   * escribe el controller (patrón del resto de M1). NO existe venta directa desde el binder: el
   * ajuste jamás pone `reserved`/crea órdenes; toda salida de venta pasa por checkout/M3.
   */
  async adjust(
    dto: InventoryAdjustmentRequestDto,
    actorUserId: string,
  ): Promise<InventoryAdjustmentResponse> {
    // v1.20.1 — `batchKey` SOLO es válido con `encontrada` (contrato §M1): los otros motivos
    // operan un id concreto y su replay cae en 422 ITEM_NOT_ADJUSTABLE (idempotencia natural).
    if (dto.batchKey != null && dto.reason !== 'encontrada') {
      throw BusinessException.badRequest(
        'VALIDATION_ERROR',
        "`batchKey` is only valid with reason 'encontrada'",
      );
    }
    if (dto.reason === 'encontrada') return this.adjustFound(dto, actorUserId);
    return this.adjustExisting(dto, actorUserId);
  }

  /**
   * `encontrada`: alta de pieza(s) nueva(s) con la MISMA resolución del alta normal/lote.
   *
   * v1.20.1 — idempotencia opcional por `batchKey` con el MISMO mecanismo `InventoryBatch` (M-21)
   * que `batchCreate` (sin migración nueva; cierra BE-47, el doble submit del drawer ya no duplica):
   *  - fast-path: batchKey ya persistido → respuesta ORIGINAL guardada + `idempotentReplay: true`
   *    (el controller responde 200 en el replay aunque la primera vez fuera 201).
   *  - claim `inventoryBatch.create({ id: batchKey })` PRIMERO dentro de la $transaction: la unique
   *    constraint es la guardia de concurrencia (P2002 → replay del ganador, no duplica piezas) y
   *    un crash a mitad hace rollback de claim + piezas (sin huérfanos).
   */
  private async adjustFound(
    dto: InventoryAdjustmentRequestDto,
    actorUserId: string,
  ): Promise<InventoryAdjustmentResponse> {
    if (!dto.item) {
      throw BusinessException.badRequest(
        'VALIDATION_ERROR',
        "reason 'encontrada' requires `item`",
      );
    }
    if (dto.batchKey) {
      const existing = await this.prisma.inventoryBatch.findUnique({
        where: { id: dto.batchKey },
      });
      if (existing) return this.replayAdjustment(existing);
    }
    // Excepción documentada (API_CONTRACT §DTOs): acquisitionType default aportacion_en_especie.
    const line: BatchInventoryItemInput = {
      ...dto.item,
      acquisitionType: dto.item.acquisitionType ?? 'aportacion_en_especie',
    };
    const qty = line.qty ?? 1;
    if (line.productType === 'graded' && qty > 1) {
      throw BusinessException.validation('VALIDATION_ERROR', 'graded items cannot have qty > 1');
    }
    // Misma validación del alta (NOT_FOUND / VALIDATION_ERROR / FINISH_NOT_AVAILABLE /
    // PRICE_PENDING con escalado del pendiente — paridad con el alta normal). Si falla, NO se
    // claimea el batchKey → un reintento con la misma key vuelve a intentar limpio.
    const r = await this.resolveCreation(line);
    if (r.sealedNeedsEscalate) {
      // v1.42 (BLOQ-2b): `sealedProductId` a la clave de la cola (ETB y blíster no colapsan).
      await this.pricing.escalatePending(
        r.card.id,
        line.productType,
        r.gradeKey,
        'inventory',
        undefined,
        r.finish,
        null,
        r.sealedProductId,
      );
    }
    const folios = await this.prisma.nextFolios(qty);
    try {
      const response = await this.prisma.$transaction(async (tx) => {
        // v1.20.1 — claim atómico del batchKey PRIMERO (guardia de concurrencia, patrón batchCreate).
        if (dto.batchKey) {
          await tx.inventoryBatch.create({
            data: {
              id: dto.batchKey,
              actorUserId,
              kind: 'adjust',
              requested: qty,
              createdItems: 0,
              failedLines: 0,
              resultJson: {} as unknown as Prisma.InputJsonValue,
            },
          });
        }
        const inventoryItemIds: string[] = [];
        const adjustmentIds: string[] = [];
        for (const folio of folios) {
          const item = await tx.inventoryItem.create({ data: this.buildItemData(line, r, folio) });
          await tx.inventoryMovement.create({
            data: {
              itemId: item.id,
              toLocationId: line.locationId,
              toStatus: 'in_stock',
              reason: MovementReason.adjustment,
              actorUserId,
              note: dto.note ?? 'encontrada',
            },
          });
          // M-24: UNA fila InventoryAdjustment POR PIEZA creada (qty>1 → una por pieza).
          const adj = await tx.inventoryAdjustment.create({
            data: {
              inventoryItemId: item.id,
              reason: 'encontrada',
              fromStatus: null,
              toStatus: 'in_stock',
              actorUserId,
              note: dto.note ?? null,
            },
          });
          adjustmentIds.push(adj.id);
          inventoryItemIds.push(item.id);
        }
        const out: InventoryAdjustmentResponse = {
          adjustmentIds,
          reason: 'encontrada',
          inventoryItemIds,
          folios,
          fromStatus: null,
          toStatus: 'in_stock',
          idempotentReplay: false,
        };
        // Finaliza el claim con la respuesta ORIGINAL (fuente del replay idempotente).
        if (dto.batchKey) {
          await tx.inventoryBatch.update({
            where: { id: dto.batchKey },
            data: {
              createdItems: inventoryItemIds.length,
              resultJson: out as unknown as Prisma.InputJsonValue,
            },
          });
        }
        return out;
      });
      return response;
    } catch (e) {
      // P2002 en el claim = otra corrida ganó la carrera por este batchKey → replay (no duplica).
      if (dto.batchKey && (e as { code?: string })?.code === 'P2002') {
        const claimed = await this.prisma.inventoryBatch.findUnique({
          where: { id: dto.batchKey },
        });
        if (claimed) return this.replayAdjustment(claimed);
        // Carrera extrema (la ganadora aún no commitea su claim visible): pide reintento.
        throw BusinessException.conflict('CONFLICT', 'adjustment is being processed; retry');
      }
      throw e;
    }
  }

  /** Reconstruye la respuesta idempotente del ajuste desde el InventoryBatch persistido. */
  private replayAdjustment(existing: { resultJson: unknown }): InventoryAdjustmentResponse {
    const stored = existing.resultJson as InventoryAdjustmentResponse;
    return { ...stored, idempotentReplay: true };
  }

  /** `perdida | danada | error_captura`: transición de UNA pieza existente; `note` OBLIGATORIA. */
  private async adjustExisting(
    dto: InventoryAdjustmentRequestDto,
    actorUserId: string,
  ): Promise<InventoryAdjustmentResponse> {
    if (!dto.inventoryItemId) {
      throw BusinessException.badRequest(
        'VALIDATION_ERROR',
        `reason '${dto.reason}' requires inventoryItemId`,
      );
    }
    if (!dto.note || dto.note.trim() === '') {
      throw BusinessException.badRequest(
        'VALIDATION_ERROR',
        `reason '${dto.reason}' requires a note`,
      );
    }
    const item = await this.prisma.inventoryItem.findUnique({
      where: { id: dto.inventoryItemId },
    });
    if (!item) throw BusinessException.notFound('NOT_FOUND', 'Inventory item not found');
    // Guardarraíl §4.20e: SOLO piezas de plataforma en {in_stock, listed} son ajustables.
    if (item.ownerType !== 'platform' || !ADJUSTABLE_ORIGIN_STATUSES.includes(item.status)) {
      throw BusinessException.validation(
        'ITEM_NOT_ADJUSTABLE',
        `item (ownerType '${item.ownerType}', status '${item.status}') cannot be adjusted`,
        { ownerType: item.ownerType, status: item.status },
      );
    }
    // perdida → lost · danada → damaged · error_captura → withdrawn (sin semántica de pérdida;
    // se reusa `withdrawn` — la distinción vive en InventoryAdjustment.reason, §4.20e).
    const toStatus: InventoryStatus =
      dto.reason === 'perdida' ? 'lost' : dto.reason === 'danada' ? 'damaged' : 'withdrawn';
    const adjustmentId = await this.prisma.$transaction(async (tx) => {
      // [BE-45] Guardia ATÓMICA de status: la transición es CONDICIONAL al allowlist en el MISMO
      // UPDATE (updateMany + count), no un update incondicional tras el check en memoria de arriba
      // (que queda como pre-validación de mensajes amables). Cierra la ventana TOCTOU: si entre la
      // lectura y esta escritura la pieza salió de {in_stock, listed} (p. ej. un checkout la puso
      // `reserved`), count=0 → 422 y rollback (no se pisa la reserva con lost/damaged/withdrawn).
      const claimed = await tx.inventoryItem.updateMany({
        where: {
          id: item.id,
          ownerType: 'platform',
          status: { in: [...ADJUSTABLE_ORIGIN_STATUSES] },
        },
        data: { status: toStatus },
      });
      if (claimed.count !== 1) {
        throw BusinessException.validation(
          'ITEM_NOT_ADJUSTABLE',
          'item is no longer adjustable (concurrent status transition)',
          { status: item.status },
        );
      }
      await tx.inventoryMovement.create({
        data: {
          itemId: item.id,
          fromStatus: item.status,
          toStatus,
          reason: MovementReason.adjustment,
          actorUserId,
          note: dto.note,
        },
      });
      const adj = await tx.inventoryAdjustment.create({
        data: {
          inventoryItemId: item.id,
          reason: dto.reason as AdjustmentReason,
          fromStatus: item.status,
          toStatus,
          actorUserId,
          note: dto.note,
        },
      });
      return adj.id;
    });
    return {
      adjustmentIds: [adjustmentId],
      reason: dto.reason as AdjustmentReason,
      inventoryItemIds: [item.id],
      folios: [item.folio],
      fromStatus: item.status,
      toStatus,
      idempotentReplay: false,
    };
  }

  // ---------------- P-29 §baja rápida — baja por CANTIDAD ----------------

  /**
   * P-29 — baja rápida de `quantity` piezas de un (cardId, finish[, condición]) de un golpe.
   *
   * Selección server-side de las piezas MÁS APROPIADAS: solo `ownerType=platform` en
   * `{in_stock, listed}` (mismo guardarraíl que el ajuste por-pieza `adjustExisting`), priorizando
   * `in_stock` antes que `listed` (baja primero lo NO publicado → menos disrupción del storefront) y,
   * dentro de cada status, la MÁS ANTIGUA (FIFO por `createdAt`). Reusa el mapeo de motivos del
   * ajuste (`perdida→lost | danada→damaged | error_captura→withdrawn`).
   *
   * Money-safe: NO toca precios (ni `listPriceCents` ni referencias) ni crea/reversa órdenes; solo
   * transiciona el `status` y registra el rastro TRIPLE por pieza (InventoryMovement reason=adjustment
   * + InventoryAdjustment M-24; el AuditLog lo escribe el controller). Nunca escribe `reserved`/`listed`
   * → no vende ni publica.
   *
   * Atómico: si hay MENOS piezas ajustables que `quantity` → 422 INSUFFICIENT_STOCK y NO se baja
   * ninguna («no bajar más de las que hay»). La guardia atómica de status (updateMany condicionado +
   * count, patrón BE-45) cierra la ventana TOCTOU: una carrera que saque una pieza del allowlist entre
   * la lectura y la escritura da 422 y rollback (no se pisa una reserva de checkout con lost/damaged).
   *
   * v1.35 — idempotencia opcional por `batchKey` (H1), MISMO mecanismo `InventoryBatch` (M-21) que
   * `adjustFound`/`publish-all`, con `kind='bulk_remove'`:
   *  - fast-path: `batchKey` ya persistido → respuesta ORIGINAL guardada + `idempotentReplay: true`
   *    (mismo `200`), SIN transicionar status ni escribir un segundo lote de ajustes/movimientos.
   *  - claim `inventoryBatch.create({ id: batchKey })` PRIMERO dentro de la `$transaction`: la unique
   *    constraint es la guardia de concurrencia (P2002 → replay del ganador, no re-baja) y un fallo
   *    posterior (INSUFFICIENT_STOCK / TOCTOU) hace rollback del claim → un reintento limpio vuelve a
   *    intentar (no se «quema» el batchKey por un fallo transitorio).
   *
   * IMPORTANTE (corrección del comentario previo, H1): la ATOMICIDAD por sí sola NO cubre el doble
   * submit ni el reintento tras un timeout ambiguo — solo garantiza la consistencia DENTRO de una
   * ejecución (o baja las N o ninguna). Lo que evita el «encogimiento fantasma» de un reintento (bajar
   * OTRAS N piezas) es la idempotencia por `batchKey`; el estado de carga del front es best-effort y no
   * es una garantía del backend. Sin `batchKey` cada llamada es un procesamiento nuevo.
   */
  async bulkRemove(dto: BulkRemoveRequestDto, actorUserId: string): Promise<BulkRemoveResponse> {
    if (!dto.note || dto.note.trim() === '') {
      throw BusinessException.badRequest('VALIDATION_ERROR', 'bulk-remove requires a note');
    }
    const quantity = dto.quantity;
    const reason = dto.reason as AdjustmentReason;
    const toStatus: InventoryStatus =
      dto.reason === 'perdida' ? 'lost' : dto.reason === 'danada' ? 'damaged' : 'withdrawn';

    // Fast-path replay: si el batchKey YA está persistido (committed) con su resultado, se repite la
    // respuesta original SIN re-bajar (mismo criterio que adjustFound; cierra el «encogimiento fantasma»).
    if (dto.batchKey) {
      const existing = await this.prisma.inventoryBatch.findUnique({
        where: { id: dto.batchKey },
      });
      if (existing) return this.replayBulkRemove(existing);
    }

    const where: Prisma.InventoryItemWhereInput = {
      cardId: dto.cardId,
      finish: dto.finish,
      ownerType: 'platform',
      status: { in: [...ADJUSTABLE_ORIGIN_STATUSES] },
    };
    if (dto.productType) where.productType = dto.productType;
    if (dto.rawCondition) where.rawCondition = dto.rawCondition;
    if (dto.sealedCondition) where.sealedCondition = dto.sealedCondition;

    try {
      return await this.prisma.$transaction(async (tx) => {
        // v1.35 — claim atómico del batchKey PRIMERO (guardia de concurrencia, patrón adjustFound). Un
        // fallo posterior (INSUFFICIENT_STOCK / TOCTOU) hace rollback de este claim junto con todo lo
        // demás → un reintento con la misma key vuelve a intentar limpio.
        if (dto.batchKey) {
          await tx.inventoryBatch.create({
            data: {
              id: dto.batchKey,
              actorUserId,
              kind: 'bulk_remove',
              requested: quantity,
              createdItems: 0,
              failedLines: 0,
              resultJson: {} as unknown as Prisma.InputJsonValue,
            },
          });
        }
        // `take: quantity` con orden in_stock→listed / FIFO: si devuelve < quantity, es que NO hay más
        // ajustables (el take es un tope superior) → available === candidates.length. No hace falta un
        // count aparte.
        const candidates = await tx.inventoryItem.findMany({
          where,
          orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
          take: quantity,
          select: { id: true, folio: true, status: true },
        });
        if (candidates.length < quantity) {
          throw BusinessException.validation(
            'INSUFFICIENT_STOCK',
            `only ${candidates.length} adjustable piece(s) available for (card ${dto.cardId}, finish ${dto.finish}); requested ${quantity}`,
            { available: candidates.length, requested: quantity },
          );
        }
        const ids = candidates.map((c) => c.id);
        // Guardia ATÓMICA (BE-45): transiciona SOLO las piezas que siguen siendo ajustables. Un count
        // menor = alguna salió del allowlist en la carrera → 422 + rollback (no baja parcial silenciosa).
        const claimed = await tx.inventoryItem.updateMany({
          where: {
            id: { in: ids },
            ownerType: 'platform',
            status: { in: [...ADJUSTABLE_ORIGIN_STATUSES] },
          },
          data: { status: toStatus },
        });
        if (claimed.count !== ids.length) {
          throw BusinessException.validation(
            'ITEM_NOT_ADJUSTABLE',
            'some pieces are no longer adjustable (concurrent status transition); retry',
            { claimed: claimed.count, requested: quantity },
          );
        }
        const inventoryItemIds: string[] = [];
        const folios: string[] = [];
        const adjustmentIds: string[] = [];
        for (const c of candidates) {
          await tx.inventoryMovement.create({
            data: {
              itemId: c.id,
              fromStatus: c.status,
              toStatus,
              reason: MovementReason.adjustment,
              actorUserId,
              note: dto.note,
            },
          });
          const adj = await tx.inventoryAdjustment.create({
            data: {
              inventoryItemId: c.id,
              reason,
              fromStatus: c.status,
              toStatus,
              actorUserId,
              note: dto.note,
            },
          });
          inventoryItemIds.push(c.id);
          folios.push(c.folio);
          adjustmentIds.push(adj.id);
        }
        const out: BulkRemoveResponse = {
          ...(dto.batchKey ? { batchKey: dto.batchKey } : {}),
          idempotentReplay: false,
          removed: ids.length,
          requested: quantity,
          reason,
          toStatus,
          inventoryItemIds,
          folios,
          adjustmentIds,
        };
        // Finaliza el claim con la respuesta ORIGINAL (fuente del replay idempotente).
        if (dto.batchKey) {
          await tx.inventoryBatch.update({
            where: { id: dto.batchKey },
            data: {
              createdItems: inventoryItemIds.length,
              resultJson: out as unknown as Prisma.InputJsonValue,
            },
          });
        }
        return out;
      });
    } catch (e) {
      // P2002 en el claim = otra corrida ganó la carrera por este batchKey → replay (no re-baja).
      if (dto.batchKey && (e as { code?: string })?.code === 'P2002') {
        const winner = await this.prisma.inventoryBatch.findUnique({
          where: { id: dto.batchKey },
        });
        if (winner) return this.replayBulkRemove(winner);
        // Carrera extrema (la ganadora aún no commitea su claim visible): pide reintento.
        throw BusinessException.conflict('CONFLICT', 'bulk-remove is being processed; retry');
      }
      throw e;
    }
  }

  /** Reconstruye la respuesta idempotente de la baja rápida desde el InventoryBatch persistido. */
  private replayBulkRemove(existing: { resultJson: unknown }): BulkRemoveResponse {
    const stored = existing.resultJson as BulkRemoveResponse;
    return { ...stored, idempotentReplay: true };
  }

  // ---------------- P-31 §export — inventario a .xlsx ----------------

  /**
   * P-31 — genera un .xlsx del inventario de PLATAFORMA (una fila por PIEZA/folio; el modelo es
   * folio-por-pieza, así el operador ve cada copia con su ubicación/costo/cert). Filtros OPCIONALES:
   * `setId` (id LOCAL del CardSet) y `productType`. Devuelve un Buffer que el controller manda con
   * cabeceras de descarga.
   *
   * Money-safe: exporta el DATO TAL CUAL, sin inventar ni recalcular. Sin precio → celda VACÍA (nunca
   * 0). Definición de las columnas de dinero (todo STORED, sin derivar):
   *  - «Precio mercado» = `PriceReference` de la variante del item (mercado del día, MXN al FX vivo).
   *  - «Precio compra»  = override de COMPRA manual (`VariantPriceOverride.buyOverrideCents`, M-30);
   *     NO recomputa la regla del cotizador por rareza (eso sería inventar). Vacío si no hay override.
   *  - «Precio venta»   = precio manual POR PIEZA (`listPriceCents`) ó, en su defecto, el override de
   *     VENTA de la variante (`sellOverrideCents`). NO deriva mercado×markup. Vacío si ninguno.
   */
  async exportInventoryXlsx(filters: {
    setId?: string;
    productType?: ProductType;
  }): Promise<Buffer> {
    const where: Prisma.InventoryItemWhereInput = { ownerType: 'platform' };
    if (filters.productType) where.productType = filters.productType;
    if (filters.setId) {
      // H7 (deuda saldada, v1.36): validar el filtro `setId` — un id inexistente devolvía un export
      // VACÍO en silencio (UX inconsistente con publishAll/bulk-ops, que responden 400). Ahora un
      // `setId` desconocido → 400 VALIDATION_ERROR (paridad de validación de filtros).
      const set = await this.prisma.cardSet.findUnique({
        where: { id: filters.setId },
        select: { id: true },
      });
      if (!set) {
        throw BusinessException.badRequest('VALIDATION_ERROR', `unknown setId '${filters.setId}'`, {
          setId: filters.setId,
        });
      }
      where.card = { setId: filters.setId };
    }

    const items = await this.prisma.inventoryItem.findMany({
      where,
      include: { card: { include: { set: true } }, location: true },
      orderBy: [{ card: { setId: 'asc' } }, { folio: 'asc' }],
    });

    // Referencias de mercado EN LOTE (sin N+1) — misma llave que getReferencesBatch.
    const refKeyOf = (i: {
      cardId: string;
      productType: ProductType;
      finish: Finish;
      gradeKey: string;
    }) => `${i.cardId}|${i.productType}|${i.gradeKey}|${i.finish}`;
    const refReqs = items.map((it) => ({
      cardId: it.cardId,
      productType: it.productType,
      finish: it.finish,
      gradeKey: this.exportGradeKey(it),
    }));
    const refs = refReqs.length
      ? await this.pricing.getReferencesBatch(refReqs)
      : new Map<string, PriceInfo>();

    // Overrides M-30 (compra/venta) EN LOTE por (cardId, productType, gradeKey, finish).
    const cardIds = [...new Set(items.map((it) => it.cardId))];
    const overrides = cardIds.length
      ? await this.prisma.variantPriceOverride.findMany({ where: { cardId: { in: cardIds } } })
      : [];
    const ovByKey = new Map<string, VariantPriceOverride>();
    for (const o of overrides) {
      ovByKey.set(`${o.cardId}|${o.productType}|${o.gradeKey}|${o.finish}`, o);
    }

    const workbook = new ExcelJS.Workbook();
    // H8 (deuda saldada, v1.36): marca VIGENTE del proyecto (PROJECT.md «Nombre comercial / marca:
    // TCG Vault MX»); reemplaza la marca obsoleta 'TCG HUNT' en la metadata del .xlsx.
    workbook.creator = 'TCG Vault MX';
    workbook.created = new Date();
    const sheet = workbook.addWorksheet('Inventario');
    sheet.columns = INVENTORY_EXPORT_COLUMNS.map((c) => ({
      header: c.header,
      key: c.key,
      width: c.width,
    }));
    sheet.getRow(1).font = { bold: true };

    for (let idx = 0; idx < items.length; idx++) {
      const it = items[idx];
      const market = refs.get(refKeyOf(refReqs[idx]));
      const ov = ovByKey.get(`${it.cardId}|${it.productType}|${this.exportGradeKey(it)}|${it.finish}`);
      const marketCents =
        market && market.status === 'priced' ? market.referenceMxnCents ?? null : null;
      const buyCents = ov?.buyOverrideCents ?? null;
      // H-1 (E5-bis): con `??`, un `listPriceCents = 0` ENMASCARABA el `sellOverrideCents` de la
      // variante y el reporte enseñaba $0 donde el sistema cobra el override. Misma precedencia, con
      // «presente ⇔ > 0».
      const sellCents = firstPresentAmount(it.listPriceCents, ov?.sellOverrideCents);
      sheet.addRow({
        folio: it.folio,
        card: it.card?.name ?? '',
        set: it.card?.set?.name ?? '',
        number: it.card?.number ?? '',
        rarity: it.card?.rarity ?? '',
        productType: it.productType,
        finish: it.finish,
        condition: this.exportCondition(it),
        certNumber: it.certNumber ?? '',
        quantity: 1,
        status: it.status,
        location: it.location?.label ?? '',
        origin: it.acquisitionType,
        costMxn: this.centsToMxn(it.acquisitionCostCents),
        marketMxn: this.centsToMxn(marketCents),
        buyMxn: this.centsToMxn(buyCents),
        sellMxn: this.centsToMxn(sellCents),
      });
    }

    // exceljs devuelve un ArrayBuffer-like; normalizamos a Buffer para res.send.
    const out = await workbook.xlsx.writeBuffer();
    return Buffer.from(out as ArrayBuffer);
  }

  /** gradeKey del item para casar `PriceReference`/`VariantPriceOverride` (sellado → clave de mercado). */
  private exportGradeKey(it: {
    productType: ProductType;
    rawCondition: string | null;
    gradingCompany: string | null;
    gradeValue: string | null;
    tcgplayerProductId: number | null;
  }): string {
    if (it.productType === 'sealed' && it.tcgplayerProductId != null) {
      return sealedMarketGradeKey(it.tcgplayerProductId);
    }
    return buildGradeKey(it);
  }

  /** Condición legible por tipo: raw→rawCondition, sealed→sealedCondition, graded→empresa+grado. */
  private exportCondition(it: {
    productType: ProductType;
    rawCondition: string | null;
    sealedCondition: string | null;
    gradingCompany: string | null;
    gradeValue: string | null;
  }): string {
    if (it.productType === 'raw') return it.rawCondition ?? '';
    if (it.productType === 'sealed') return it.sealedCondition ?? '';
    if (it.productType === 'graded') {
      return [it.gradingCompany, it.gradeValue].filter(Boolean).join(' ');
    }
    return '';
  }

  /** Cents → número MXN (2 decimales) o `null` para celda VACÍA (money-safe: sin precio ≠ 0). */
  private centsToMxn(cents: number | null | undefined): number | null {
    if (cents == null) return null;
    return Math.round(cents) / 100;
  }

  // ---------------- Locations ----------------

  async listLocations() {
    const rows = await this.prisma.vaultLocation.findMany({ orderBy: { label: 'asc' } });
    return { data: rows.map(toVaultLocationDTO) }; // S49-R4
  }

  async createLocation(dto: CreateLocationDto) {
    const label = `${dto.box}-${dto.row}-${dto.slot}`;
    // S49-R4: proyectado.
    return toVaultLocationDTO(await this.prisma.vaultLocation.create({ data: { ...dto, label } }));
  }
}
