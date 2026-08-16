import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ProductType, RawCondition } from '@prisma/client';

export class PublicQuoteDto {
  @IsString() cardId!: string;
  @IsIn(['graded', 'sealed', 'raw']) productType!: ProductType;
  @IsOptional() @IsIn(['NM']) rawCondition?: RawCondition;
}

export class RequestItemDto {
  @IsString() cardId!: string;
  @IsIn(['graded', 'sealed', 'raw']) productType!: ProductType;
  @IsOptional() @IsIn(['NM']) rawCondition?: RawCondition;
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
  @IsOptional() @IsInt() @Min(0) approvedPriceCents?: number;
}

export class PaySpeiDto {
  @IsString() speiReference!: string;
}
