import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import {
  AcquisitionType,
  GradingCompany,
  ProductType,
  RawCondition,
  SealedSubtype,
} from '@prisma/client';

export class CreateItemDto {
  @IsString() cardId!: string;
  @IsIn(['graded', 'sealed', 'raw']) productType!: ProductType;
  // v1.1: raw solo NM (se eliminan LP/MP/HP/DMG).
  @IsOptional() @IsIn(['NM']) rawCondition?: RawCondition;
  // v1.1: subtipo del sellado (solo productType=sealed).
  @IsOptional() @IsIn(['box', 'etb', 'bundle', 'tin', 'blister']) sealedSubtype?: SealedSubtype;
  @IsOptional() @IsIn(['PSA', 'CGC']) gradingCompany?: GradingCompany;
  @IsOptional() @IsString() gradeValue?: string;
  @IsOptional() @IsString() locationId?: string;
  @IsOptional() @IsString() frontPhotoKey?: string;
  @IsOptional() @IsString() backPhotoKey?: string;
  @IsOptional() extraPhotoKeys?: string[];
  @IsIn(['aportacion_en_especie', 'buylist', 'compra']) acquisitionType!: AcquisitionType;
  @IsOptional() @IsInt() @Min(0) acquisitionPct?: number;
  @IsOptional() @IsInt() @Min(0) acquisitionCostCents?: number;
  // v1.1: precio manual MXN. Obligatorio para PUBLICAR el sellado (sin él no aparece en Compra).
  @IsOptional() @IsInt() @Min(0) listPriceCents?: number;
  @IsOptional() @IsString() sourceSellRequestItemId?: string;
}

export class UpdateItemDto {
  @IsOptional() @IsString() frontPhotoKey?: string;
  @IsOptional() @IsString() backPhotoKey?: string;
  @IsOptional() extraPhotoKeys?: string[];
  @IsOptional() @IsString() gradeValue?: string;
  @IsOptional() @IsInt() @Min(0) listPriceCents?: number;
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
