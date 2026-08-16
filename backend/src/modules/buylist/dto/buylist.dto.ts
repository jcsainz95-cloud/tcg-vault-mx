import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { Finish, ProductType, RawCondition } from '@prisma/client';

const FINISHES = ['normal', 'reverse_holo', 'holofoil', 'first_edition_holofoil'] as const;

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
  @IsString() clabe!: string;
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
}

export class PaySpeiDto {
  @IsString() speiReference!: string;
}
