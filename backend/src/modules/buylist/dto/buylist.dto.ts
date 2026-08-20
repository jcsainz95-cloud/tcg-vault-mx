import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { Finish, ProductType, RawCondition } from '@prisma/client';

const FINISHES = ['normal', 'reverse_holo', 'holofoil', 'first_edition_holofoil'] as const;

/**
 * v1.15 (ARCHITECTURE §4.16b) — cap de ítems por request del batch quote
 * (`POST /buylist/quote/batch`). Constante de servidor: cubre el `pageSize` 20 del grid del
 * cotizador con holgura sin ser vector de abuso. Vacío o sobre-cap → 400 VALIDATION_ERROR.
 */
export const BUYLIST_QUOTE_BATCH_MAX = 50;

/**
 * B-4 / S-B5 (pentest): cota dura de sanidad sobre `approvedPriceCents` en la decisión
 * carta-por-carta. Es la **primera línea** (rechazo 400 en el ValidationPipe) contra un
 * monto absurdo tipo el PoC `99999999` (MX$999,999). Fijada a **MX$10,000 = 1,000,000c**,
 * que coincide con el tope AML mensual por defecto (`buylist_cap_per_month_cents`): ningún
 * ítem individual puede aprobar más que el tope mensual completo. La cota fina y relativa
 * (≤ `quotedPriceCents` × factor, y ≤ tope por solicitud) se valida server-side en
 * `buylist.service.ts` (`itemDecision`).
 */
export const MAX_APPROVED_PRICE_CENTS = 1_000_000;

export class PublicQuoteDto {
  @IsString() cardId!: string;
  @IsIn(['graded', 'sealed', 'raw']) productType!: ProductType;
  @IsOptional() @IsIn(['NM']) rawCondition?: RawCondition;
  // v1.6-finish: acabado cotizado (default normal). Se valida server-side contra
  // card.availableFinishes (SEC-A1); fuera de la lista → 422 FINISH_NOT_AVAILABLE.
  @IsOptional() @IsIn(FINISHES) finish?: Finish;
}

/**
 * v1.15 (BuylistQuoteItemDTO del contrato §6) — un ítem del batch quote. Espeja EXACTAMENTE los
 * campos del quote por-carta (`PublicQuoteDto`); SIN `qty` (el modelo es una línea por carta
 * física, ARCHITECTURE §4.16b). El `finish` se valida por-ítem server-side (SEC-A1).
 */
export class BuylistQuoteItemDto {
  @IsString() cardId!: string;
  @IsIn(['graded', 'sealed', 'raw']) productType!: ProductType;
  @IsOptional() @IsIn(['NM']) rawCondition?: RawCondition;
  @IsOptional() @IsIn(FINISHES) finish?: Finish;
}

/**
 * v1.15 (§4.16b) — `POST /buylist/quote/batch`. `items` no vacío (`@ArrayNotEmpty`) y con tope
 * `BUYLIST_QUOTE_BATCH_MAX` (`@ArrayMaxSize`). Vacío o sobre-cap → 400 VALIDATION_ERROR (nivel
 * request). Los errores de cada carta (NOT_FOUND / FINISH_NOT_AVAILABLE) son POR-ÍTEM (HTTP 200).
 */
export class BatchQuoteDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(BUYLIST_QUOTE_BATCH_MAX)
  @ValidateNested({ each: true })
  @Type(() => BuylistQuoteItemDto)
  items!: BuylistQuoteItemDto[];
}

export class RequestItemDto {
  @IsString() cardId!: string;
  @IsIn(['graded', 'sealed', 'raw']) productType!: ProductType;
  @IsOptional() @IsIn(['NM']) rawCondition?: RawCondition;
  // v1.6-finish: acabado del item (default normal), validado contra card.availableFinishes.
  @IsOptional() @IsIn(FINISHES) finish?: Finish;
  // v1.3.1: `category` REMOVIDO. El backend deriva la regla server-side de Card.rarity (SEC-A1);
  // un `category` que envíe el cliente lo descarta el ValidationPipe (whitelist).
}

export class CreateRequestDto {
  @IsArray() @ArrayNotEmpty() @ValidateNested({ each: true }) @Type(() => RequestItemDto)
  items!: RequestItemDto[];
  // v1.15 (ARCHITECTURE §4.16a, PII): `clabe` OPCIONAL. Si se omite, el backend resuelve la CLABE
  // del PROPIO usuario en archivo (KycProfile.clabeEnc, desencriptada — misma fuente que
  // reveal-clabe); si tampoco hay en archivo → 422 CLABE_REQUIRED. Con `clabe` presente el flujo
  // no cambia (formato 18 dígitos → CLABE_INVALID; nombre propio por blind index → CLABE_NOT_OWN_NAME).
  @IsOptional() @IsString() clabe?: string;
  @IsOptional() @IsObject() ineUploadKeys?: { front: string; back: string };
}

export class RespondDto {
  @IsIn(['accept', 'decline']) decision!: 'accept' | 'decline';
}

export class ItemDecisionDto {
  @IsIn(['approve', 'adjust', 'reject']) decision!: 'approve' | 'adjust' | 'reject';
  // B-4: cota dura de sanidad (MX$10,000). La cota fina (≤ quoted × factor y ≤ tope por
  // solicitud) la impone `BuylistService.itemDecision` server-side.
  @IsOptional() @IsInt() @Min(0) @Max(MAX_APPROVED_PRICE_CENTS) approvedPriceCents?: number;
  // v1.18-buylist-rejects (§M5): motivo del rechazo — OBLIGATORIO con decision:"reject"
  // (3–500 chars; falta/vacío → 400 VALIDATION_ERROR vía ValidationPipe). Para approve/adjust se
  // IGNORA (no se valida ni se persiste). El servicio re-valida (defensa en profundidad, con trim).
  @ValidateIf((o: ItemDecisionDto) => o.decision === 'reject')
  @IsString()
  @Length(3, 500)
  reason?: string;
}

/**
 * v1.18-buylist-rejects (§M5): query de `GET /admin/buylist/rejected-items`. Paginación inválida
 * (no entera, <1, pageSize>100) → 400 VALIDATION_ERROR (norma del contrato, a diferencia del
 * clamp del listado legacy). `userId?` filtra por vendedor (simetría F1).
 */
export class RejectedItemsQueryDto {
  @IsOptional() @IsString() userId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
}

export class PaySpeiDto {
  @IsString() speiReference!: string;
}

/**
 * v1.24-buylist-request-reject (§M5): body de `POST /admin/buylist/:id/reject` (botón «Rechazar
 * solicitud»). `reason` OPCIONAL (0–500 chars) — motivo INTERNO del cierre a nivel solicitud, NO
 * PII, va al AuditLog (`after`); no se expone al cliente ni a correo (no hay correo en este flujo).
 * Body vacío `{}` es válido.
 */
export class RejectRequestDto {
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}
