import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  AcquisitionType,
  Finish,
  GradingCompany,
  ProductType,
  RawCondition,
  SealedCondition,
  SealedSubtype,
} from '@prisma/client';

/**
 * SEC-N3 (BE-34/WS-E) — tope de `qty` del alta por lote. `nextFolios` expande a
 * `generate_series(1, qty)`; sin tope, un `vault_operator` podría mandar un `qty` gigante y
 * hacer DoS de BD. 500 piezas por línea es holgado para bulk raw/sellado real.
 */
export const MAX_BATCH_QTY = 500;

/**
 * SEC-N3 (B-3/WS-E) — tope sano de dinero manual (`listPriceCents`) en centavos MXN. El dinero
 * vive en Int 32-bit (< 2^31 = 2_147_483_647); 100_000_000¢ = MX$1,000,000 por pieza deja mucho
 * margen para el slab más caro y evita overflow/valores absurdos manipulados desde el DTO.
 */
export const MAX_LIST_PRICE_CENTS = 100_000_000;

/**
 * H-1 en la ESCRITURA (v2.1.4, §4.36.6 / E5-bis) — «cinturón y tirantes».
 *
 * Todo `listPriceCents` aceptado por un write es **entero `> 0`** (`@Min(1)`): así el estado
 * prohibido **no se puede crear**. `null`/ausente sigue siendo válido y significa «sin override».
 *
 * La lectura NO se relaja por eso: los seis seams tratan `<= 0` como AUSENTE de todos modos
 * (`hasManualPrice`), porque las filas que preceden a esta validación ya están en la base. Una sola
 * de las dos puntas no basta — el hueco D5 nació precisamente de confiar en la otra.
 */

/**
 * M-2 (SEC) — tope de política del % de aportación en especie. Sin `@Max`, un `vault_operator`
 * podía inflar arbitrariamente el costo de aportación (costo = referencia × pct/100) desde el DTO.
 * 100% (costo = referencia del día) es el techo de negocio para la aportación del dueño.
 */
export const MAX_APORTACION_PCT = 100;

export class CreateItemDto {
  // v1.39 (P-38): OPCIONAL — REQUERIDO para raw/graded y sealed SIN sealedProductId; con
  // sealedProductId el backend lo DERIVA (ancla del set). Ausente donde se requiere → 422 en el servicio.
  @IsOptional() @IsString() cardId?: string;
  @IsIn(['graded', 'sealed', 'raw']) productType!: ProductType;
  // v1.1: raw solo NM (se eliminan LP/MP/HP/DMG).
  @IsOptional() @IsIn(['NM']) rawCondition?: RawCondition;
  // v1.6-finish: acabado de la copia física (default normal). Validado contra
  // card.availableFinishes (SEC-A1); graded/sealed se fuerzan a normal en el servicio.
  @IsOptional() @IsIn(['normal', 'reverse_holo', 'holofoil', 'first_edition_holofoil'])
  finish?: Finish;
  // v1.1: subtipo del sellado (solo productType=sealed).
  @IsOptional() @IsIn(['box', 'etb', 'bundle', 'tin', 'blister']) sealedSubtype?: SealedSubtype;
  // v1.23-sealed-sales: condición del sellado (solo productType=sealed; default mint en el servicio).
  @IsOptional() @IsIn(['mint', 'minor_box_damage']) sealedCondition?: SealedCondition;
  @IsOptional() @IsIn(['PSA', 'CGC']) gradingCompany?: GradingCompany;
  @IsOptional() @IsString() gradeValue?: string;
  // v1.2 (M-12): nº de certificado PSA/CGC. Requerido para publicar una gradeada.
  @IsOptional() @IsString() certNumber?: string;
  @IsOptional() @IsString() locationId?: string;
  // v1.2 (M-13): sin fotos de producto (frontPhotoKey/backPhotoKey/extraPhotoKeys eliminados).
  @IsIn(['aportacion_en_especie', 'buylist', 'compra']) acquisitionType!: AcquisitionType;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_APORTACION_PCT) acquisitionPct?: number;
  // SEC N-2 (money-safe): `@Max` = MISMA cota que el dinero manual (`MAX_LIST_PRICE_CENTS`,
  // MX$1,000,000/pieza). Sin ella un `vault_operator` podía inyectar un costo cercano a Int32 y
  // desbordar los agregados de P&L (costo × qty). `@Min(0)` se mantiene: un costo 0 es legítimo
  // (promo/regalo), a diferencia de un precio de venta.
  @IsOptional() @IsInt() @Min(0) @Max(MAX_LIST_PRICE_CENTS) acquisitionCostCents?: number;
  // v1.1: precio manual MXN. Obligatorio para PUBLICAR el sellado (sin él no aparece en Compra).
  @IsOptional() @IsInt() @Min(1) @Max(MAX_LIST_PRICE_CENTS) listPriceCents?: number;
  @IsOptional() @IsString() sourceSellRequestItemId?: string;
  // v1.36-sealed-alta (M-37, P-35): 4 campos ADITIVOS SOLO para productType='sealed' (ignorados en
  // raw/graded). `tcgplayerProductId`+`tcgplayerGroupId` = mapeo TCGCSV; se fijan JUNTOS (uno sin el
  // otro → 422 VALIDATION_ERROR en el servicio); presentes ⇒ la pieza NACE MAPEADA (valúa la
  // aportación de inmediato por `sealed:tcg:<productId>`). `sealedImageUrl`/`sealedProductName` =
  // imagen/nombre de la API; el servicio VALIDA la imagen contra el host allowlist antes de persistir.
  @IsOptional() @IsInt() @Min(1) tcgplayerProductId?: number;
  @IsOptional() @IsInt() @Min(1) tcgplayerGroupId?: number;
  @IsOptional() @IsString() sealedImageUrl?: string;
  @IsOptional() @IsString() sealedProductName?: string;
  // v1.39-sealed-product-module (M-39, P-38): IDENTIDAD del sellado (FK → SealedProduct). RECOMENDADO;
  // sustituye a los 4 campos M-37 sueltos (DEPRECADOS si viene sealedProductId). El backend DERIVA
  // cardId ancla + mapeo + imagen/nombre/subtipo desde el SealedProduct (el cliente NO manda identidad).
  @IsOptional() @IsString() sealedProductId?: string;
  // v1.39 (P-38) + v1.39.1: fallback MANUAL money-safe del mercado (MXN centavos). Solo sellado; SOLO
  // cuando el mercado resuelto es null; `>0` (≤0 → 422 VALIDATION_ERROR en el servicio); AUDITADO. No
  // @Min aquí a propósito: ≤0 debe llegar al servicio para el 422 de negocio (no un 400 del pipe).
  @IsOptional() @IsInt() @Max(MAX_LIST_PRICE_CENTS) manualMarketMxnCents?: number;
}

export class UpdateItemDto {
  // v1.2 (M-13): sin fotos de producto. v1.2 (M-12): certNumber editable.
  @IsOptional() @IsString() certNumber?: string;
  @IsOptional() @IsIn(['box', 'etb', 'bundle', 'tin', 'blister']) sealedSubtype?: SealedSubtype;
  @IsOptional() @IsString() gradeValue?: string;
  @IsOptional() @IsInt() @Min(1) @Max(MAX_LIST_PRICE_CENTS) listPriceCents?: number;
  @IsOptional() @IsIn(['in_stock', 'listed']) status?: 'in_stock' | 'listed';
}

export class MoveItemDto {
  @IsString() toLocationId!: string;
  @IsOptional() @IsString() note?: string;
}

export class MarkItemDto {
  @IsIn(['lost', 'damaged']) mark!: 'lost' | 'damaged';
  @IsString() note!: string;
}

export class CreateLocationDto {
  @IsIn(['platform_stock', 'customer_custody']) zone!: 'platform_stock' | 'customer_custody';
  @IsString() box!: string;
  @IsString() row!: string;
  @IsString() slot!: string;
}

// ===== v1.16-master-set (§4.17b) — alta por LOTE =====

/**
 * Una línea del alta por lote. MISMOS campos que POST /admin/inventory/items + `qty` (default 1),
 * atajo que expande a N InventoryItem (N folios) para bulk raw/sellado; graded → qty forzado a 1
 * (cada slab es único por certNumber). API_CONTRACT §DTOs (BatchInventoryItemInput).
 */
export class BatchInventoryItemInput {
  // v1.39 (P-38): OPCIONAL — el backend deriva la ancla del set cuando viene `sealedProductId`.
  @IsOptional() @IsString() cardId?: string;
  @IsIn(['graded', 'sealed', 'raw']) productType!: ProductType;
  @IsOptional() @IsIn(['NM']) rawCondition?: RawCondition;
  @IsOptional() @IsIn(['normal', 'reverse_holo', 'holofoil', 'first_edition_holofoil'])
  finish?: Finish;
  @IsOptional() @IsIn(['box', 'etb', 'bundle', 'tin', 'blister']) sealedSubtype?: SealedSubtype;
  // v1.23-sealed-sales: condición del sellado (default mint en el servicio); solo productType=sealed.
  @IsOptional() @IsIn(['mint', 'minor_box_damage']) sealedCondition?: SealedCondition;
  @IsOptional() @IsIn(['PSA', 'CGC']) gradingCompany?: GradingCompany;
  @IsOptional() @IsString() gradeValue?: string;
  @IsOptional() @IsString() certNumber?: string;
  @IsOptional() @IsString() locationId?: string;
  @IsIn(['aportacion_en_especie', 'buylist', 'compra']) acquisitionType!: AcquisitionType;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_APORTACION_PCT) acquisitionPct?: number;
  // BLOQ-1 (fix regresión E2E DINERO): MISMAS reglas que CreateItemDto.acquisitionCostCents
  // (opcional, entero, @Min(0)). Un COSTO 0 es legítimo (promo/regalo), a diferencia de un precio
  // de venta; por eso @Min(0) y no @Min(1). Faltaba aquí → con ValidationPipe({whitelist:true}) el
  // acquisitionCostCents del cliente se borraba en silencio y toda pieza de lote nacía con costo NULL.
  // SEC N-2 (money-safe): `@Max` = MAX_LIST_PRICE_CENTS (paridad con CreateItemDto) — evita el overflow
  // de P&L (costo × qty) por un costo cercano a Int32 inyectado desde el DTO. `@Min(0)` intacto.
  @IsOptional() @IsInt() @Min(0) @Max(MAX_LIST_PRICE_CENTS) acquisitionCostCents?: number;
  @IsOptional() @IsInt() @Min(1) @Max(MAX_LIST_PRICE_CENTS) listPriceCents?: number;
  @IsOptional() @IsInt() @Min(1) @Max(MAX_BATCH_QTY) qty?: number;
  // v1.36-sealed-alta (M-37, P-35): 4 campos ADITIVOS SOLO para productType='sealed' (ignorados en
  // raw/graded). Ver notas en CreateItemDto. Vienen del SealedCatalogProductDTO que el operador eligió.
  @IsOptional() @IsInt() @Min(1) tcgplayerProductId?: number;
  @IsOptional() @IsInt() @Min(1) tcgplayerGroupId?: number;
  @IsOptional() @IsString() sealedImageUrl?: string;
  @IsOptional() @IsString() sealedProductName?: string;
  // v1.39-sealed-product-module (M-39, P-38): IDENTIDAD (recomendado) + fallback manual money-safe.
  @IsOptional() @IsString() sealedProductId?: string;
  @IsOptional() @IsInt() @Max(MAX_LIST_PRICE_CENTS) manualMarketMxnCents?: number;
}

export class BatchCreateInventoryRequest {
  @IsString() batchKey!: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => BatchInventoryItemInput)
  items!: BatchInventoryItemInput[];
}

// ===== v1.16-master-set (§4.17b) — publicar por LOTE =====

export class BulkPublishLineInput {
  @IsString() inventoryItemId!: string;
  @IsOptional() @IsInt() @Min(1) @Max(MAX_LIST_PRICE_CENTS) listPriceCents?: number;
}

export class BulkPublishRequest {
  @IsOptional() @IsString() batchKey?: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => BulkPublishLineInput)
  items!: BulkPublishLineInput[];
  // v1.26 (P-7 ⑤, §M1 / §4.24e): refresca la `PriceReference` con un fetch FRESCO on-demand por carta
  // ANTES de resolver el precio (sobre inventario UNPUBLISHED `in_stock`), para publicar con la
  // referencia recién traída y NO la almacenada stale. Hereda el gate ④: sin precio tras el refresh →
  // escala pendiente, NO publica. Money-touching (gate de seguridad posterior); respeta la cuota diaria.
  @IsOptional() @IsBoolean() repriceFresh?: boolean;
}

// ===== v1.28 (P-19, §4.26c) — publicar TODO (POST /admin/inventory/publish-all) =====

/**
 * PublishAllRequest (API_CONTRACT §M1 v1.28). Selección SERVER-SIDE (piezas `ownerType=platform` +
 * `status=in_stock` ± filtros) — a diferencia de `bulk-publish` NO recibe lista de ids ni capa la
 * selección (procesa por chunks). `productType` se valida contra el enum (400 VALIDATION_ERROR);
 * `setId` = id LOCAL del CardSet (inexistente → 400, filtro inválido). `batchKey` = idempotencia
 * vía `InventoryBatch` (`kind='publish_all'`; replay ⇒ resultado guardado + `idempotentReplay`).
 */
export class PublishAllRequestDto {
  @IsOptional() @IsString() batchKey?: string;
  @IsOptional() @IsString() setId?: string;
  @IsOptional() @IsIn(['graded', 'sealed', 'raw']) productType?: ProductType;
}

// ===== v1.20-master-set-everywhere (§4.20e) — ajuste por levantamiento físico =====

/**
 * Pieza "encontrada" del ajuste: MISMOS campos que `BatchInventoryItemInput` con UNA excepción
 * documentada (API_CONTRACT §DTOs): `acquisitionType` es OPCIONAL con default
 * `aportacion_en_especie` (lo aplica el servicio). `qty` default 1; graded fuerza 1.
 */
export class AdjustmentFoundItemInput {
  @IsString() cardId!: string;
  @IsIn(['graded', 'sealed', 'raw']) productType!: ProductType;
  @IsOptional() @IsIn(['NM']) rawCondition?: RawCondition;
  @IsOptional() @IsIn(['normal', 'reverse_holo', 'holofoil', 'first_edition_holofoil'])
  finish?: Finish;
  @IsOptional() @IsIn(['box', 'etb', 'bundle', 'tin', 'blister']) sealedSubtype?: SealedSubtype;
  // v1.23-sealed-sales: condición del sellado (default mint en el servicio); solo productType=sealed.
  @IsOptional() @IsIn(['mint', 'minor_box_damage']) sealedCondition?: SealedCondition;
  @IsOptional() @IsIn(['PSA', 'CGC']) gradingCompany?: GradingCompany;
  @IsOptional() @IsString() gradeValue?: string;
  @IsOptional() @IsString() certNumber?: string;
  @IsOptional() @IsString() locationId?: string;
  @IsOptional() @IsIn(['aportacion_en_especie', 'buylist', 'compra'])
  acquisitionType?: AcquisitionType;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_APORTACION_PCT) acquisitionPct?: number;
  @IsOptional() @IsInt() @Min(1) @Max(MAX_LIST_PRICE_CENTS) listPriceCents?: number;
  @IsOptional() @IsInt() @Min(1) @Max(MAX_BATCH_QTY) qty?: number;
}

// ===== P-29 — Baja rápida por CANTIDAD (POST /admin/inventory/items/bulk-remove) =====

/**
 * P-29 (baja rápida): da de baja las `quantity` piezas MÁS APROPIADAS de un (cardId, finish
 * [, condición]) de un golpe — el equivalente a «Alta rápida» para RESTAR. Reusa la semántica de
 * baja por-pieza de `POST /admin/inventory/adjustments` (motivos `perdida|danada|error_captura`)
 * pero seleccionando N piezas server-side en vez de operar un `inventoryItemId` concreto.
 *
 * Money-safe: NO inventa ni recalcula precios; solo transiciona el `status` de la pieza (baja de
 * stock por merma/venta manual/corrección) y deja el historial de dinero intacto. La selección solo
 * toca piezas `ownerType=platform` en `{in_stock, listed}` (mismo guardarraíl que el ajuste). Si hay
 * menos piezas que las pedidas → 422 INSUFFICIENT_STOCK y NO se baja ninguna (atómico).
 *
 * v1.35 — `batchKey?` opcional: MISMA idempotencia que `adjustFound` (`InventoryAdjustmentRequest.
 * encontrada`, v1.20.1/BE-47) y `publish-all` (`InventoryBatch` M-21, `kind='bulk_remove'`). Un
 * reintento con la misma key devuelve la respuesta original guardada (`idempotentReplay: true`) SIN
 * re-bajar N piezas — cierra el «encogimiento fantasma» del inventario. Formalizado en API_CONTRACT
 * §M1 (v1.34/v1.35).
 */
export class BulkRemoveRequestDto {
  @IsString() cardId!: string;
  @IsIn(['normal', 'reverse_holo', 'holofoil', 'first_edition_holofoil']) finish!: Finish;
  @IsInt() @Min(1) @Max(MAX_BATCH_QTY) quantity!: number;
  @IsIn(['perdida', 'danada', 'error_captura']) reason!: 'perdida' | 'danada' | 'error_captura';
  // Obligatoria (paridad con la baja por-pieza `adjustExisting`); `@IsNotEmpty` rechaza el string
  // vacío en el ValidationPipe y el servicio además rechaza blancos (whitespace) → 400. NO es opcional.
  @IsString() @IsNotEmpty() note!: string;
  // v1.35 — idempotency key generado por el cliente (anti doble-submit / anti reintento-fantasma tras
  // timeout ambiguo). Persistido en InventoryBatch (kind='bulk_remove'); replay → respuesta original.
  @IsOptional() @IsString() batchKey?: string;
  // Filtros OPCIONALES para desambiguar la casilla (cardId, finish, condición) del drawer M1.
  @IsOptional() @IsIn(['graded', 'sealed', 'raw']) productType?: ProductType;
  @IsOptional() @IsIn(['NM']) rawCondition?: RawCondition;
  @IsOptional() @IsIn(['mint', 'minor_box_damage']) sealedCondition?: SealedCondition;
}

/**
 * POST /admin/inventory/adjustments (API_CONTRACT §M1 v1.20/v1.20.1). Unión discriminada por `reason`:
 *  - `encontrada` → requiere `item` (crea pieza(s)); `note` opcional; `batchKey?` opcional
 *    (v1.20.1: idempotencia con la MISMA semántica que el alta por lote — replay devuelve la
 *    respuesta original con `idempotentReplay: true`; cierra BE-47).
 *  - `perdida | danada | error_captura` → requieren `inventoryItemId` + `note` (obligatoria);
 *    NO aceptan `batchKey` (su replay cae en 422 ITEM_NOT_ADJUSTABLE — idempotencia natural).
 * La coherencia cruzada (campo requerido/prohibido según reason) la valida el servicio → 400.
 */
export class InventoryAdjustmentRequestDto {
  @IsIn(['encontrada', 'perdida', 'danada', 'error_captura'])
  reason!: 'encontrada' | 'perdida' | 'danada' | 'error_captura';
  @IsOptional() @IsString() inventoryItemId?: string;
  @IsOptional() @IsString() note?: string;
  @IsOptional() @IsString() batchKey?: string;
  @IsOptional()
  @ValidateNested()
  @Type(() => AdjustmentFoundItemInput)
  item?: AdjustmentFoundItemInput;
}

// ===== v1.39-sealed-product-module (M-39, P-38, §4.34d) — sync + enlace de grupos =====

/**
 * POST /admin/inventory/sealed-products/sync (SealedSyncRequest). Uno de: `setId` (un set) o
 * `all:true` (todos). `groupIds?` = grupos EXTRA (promo/colección) a enlazar+sincronizar. La coherencia
 * cruzada (exactamente uno de setId/all) la valida el servicio → 400. `super_admin`.
 */
export class SealedSyncRequestDto {
  @IsOptional() @IsString() setId?: string;
  @IsOptional() @IsArray() @IsInt({ each: true }) @Min(1, { each: true }) groupIds?: number[];
  @IsOptional() @IsBoolean() all?: boolean;
}

/**
 * POST /admin/inventory/sealed-sets/:setId/groups (SealedSetGroupLinkRequest). Enlaza un grupo TCGCSV
 * EXTRA (promo/colección) al set (1 set → N grupos, §4.34b). `super_admin`.
 */
export class SealedSetGroupLinkRequestDto {
  @IsInt() @Min(1) tcgplayerGroupId!: number;
  @IsIn(['set_main', 'promo_collection']) kind!: 'set_main' | 'promo_collection';
}
