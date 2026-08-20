import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
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

export class CreateItemDto {
  @IsString() cardId!: string;
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
  @IsOptional() @IsInt() @Min(0) acquisitionPct?: number;
  @IsOptional() @IsInt() @Min(0) acquisitionCostCents?: number;
  // v1.1: precio manual MXN. Obligatorio para PUBLICAR el sellado (sin él no aparece en Compra).
  @IsOptional() @IsInt() @Min(0) @Max(MAX_LIST_PRICE_CENTS) listPriceCents?: number;
  @IsOptional() @IsString() sourceSellRequestItemId?: string;
}

export class UpdateItemDto {
  // v1.2 (M-13): sin fotos de producto. v1.2 (M-12): certNumber editable.
  @IsOptional() @IsString() certNumber?: string;
  @IsOptional() @IsIn(['box', 'etb', 'bundle', 'tin', 'blister']) sealedSubtype?: SealedSubtype;
  @IsOptional() @IsString() gradeValue?: string;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_LIST_PRICE_CENTS) listPriceCents?: number;
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
  @IsIn(['aportacion_en_especie', 'buylist', 'compra']) acquisitionType!: AcquisitionType;
  @IsOptional() @IsInt() @Min(0) acquisitionPct?: number;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_LIST_PRICE_CENTS) listPriceCents?: number;
  @IsOptional() @IsInt() @Min(1) @Max(MAX_BATCH_QTY) qty?: number;
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
  @IsOptional() @IsInt() @Min(0) @Max(MAX_LIST_PRICE_CENTS) listPriceCents?: number;
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
  @IsOptional() @IsInt() @Min(0) acquisitionPct?: number;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_LIST_PRICE_CENTS) listPriceCents?: number;
  @IsOptional() @IsInt() @Min(1) @Max(MAX_BATCH_QTY) qty?: number;
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
