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
import { BuylistCategory, ProductType, RawCondition } from '@prisma/client';

export class PublicQuoteDto {
  @IsString() cardId!: string;
  @IsIn(['graded', 'sealed', 'raw']) productType!: ProductType;
  @IsOptional() @IsIn(['NM', 'LP', 'MP', 'HP', 'DMG']) rawCondition?: RawCondition;
}

export class RequestItemDto {
  @IsString() cardId!: string;
  @IsIn(['graded', 'sealed', 'raw']) productType!: ProductType;
  @IsOptional() @IsIn(['NM', 'LP', 'MP', 'HP', 'DMG']) rawCondition?: RawCondition;
  @IsIn(['comun', 'reverse_holo', 'ex_plus']) category!: BuylistCategory;
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
