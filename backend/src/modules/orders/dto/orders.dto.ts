import { ArrayNotEmpty, IsArray, IsOptional, IsString } from 'class-validator';

export class QuoteDto {
  @IsArray() @ArrayNotEmpty() @IsString({ each: true }) inventoryItemIds!: string[];
}

export class SessionDto {
  @IsArray() @ArrayNotEmpty() @IsString({ each: true }) inventoryItemIds!: string[];
  @IsOptional() @IsString() billingProfileId?: string;
}

export class RefundDto {
  @IsString() reason!: string;
}
