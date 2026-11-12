import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsEmail, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min,
  MinLength, ValidateNested,
} from 'class-validator';
import { FINISH_VALUES } from '../../common/enum-values';
import { Finish } from '@prisma/client';

const CONDITIONS = ['NM', 'LP', 'MP', 'HP', 'DMG'] as const;
export type CondStr = (typeof CONDITIONS)[number];

export class InviteSupplierDto {
  @IsString() @MinLength(1) @MaxLength(120) businessName!: string;
  @IsEmail() @MaxLength(254) email!: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
}

export class AcceptInviteDto {
  @IsString() @MinLength(10) @MaxLength(200) token!: string;
  @IsString() @MaxLength(200) password!: string;
}

export class ChangeSupplierPasswordDto {
  @IsString() @MaxLength(200) currentPassword!: string;
  @IsString() @MaxLength(200) newPassword!: string;
}

export class PatchSupplierDto {
  @IsOptional() @IsIn(['active', 'suspended']) status?: 'active' | 'suspended';
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) businessName?: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @IsBoolean() resetPassword?: boolean;
}

export class CreateSupplyRequestDto {
  @IsString() @MinLength(1) cardId!: string;
  @IsIn(FINISH_VALUES) finish!: Finish;
  @IsIn(CONDITIONS) minCondition!: CondStr;
  @IsInt() @Min(1) @Max(10000) qty!: number;
  @IsOptional() @IsInt() @Min(1) @Max(10000) pctBps?: number;
  @IsOptional() @IsInt() @Min(100) @Max(100_000_000) fixedUnitCents?: number;
  @IsOptional() @IsDateString() expiresAt?: string;
}

export class PatchSupplyRequestDto {
  @IsOptional() @IsIn(['closed']) status?: 'closed';
  @IsOptional() @IsInt() @Min(1) @Max(10000) qtyWanted?: number;
  @IsOptional() @IsInt() @Min(1) @Max(10000) pctBps?: number;
  @IsOptional() @IsInt() @Min(100) @Max(100_000_000) fixedUnitCents?: number;
  @IsOptional() @IsDateString() expiresAt?: string;
}

export class CreateSupplyOfferDto {
  @IsInt() @Min(1) @Max(10000) qty!: number;
  @IsIn(CONDITIONS) condition!: CondStr;
  @IsOptional() @IsInt() @Min(1) unitCents?: number;
}

export class SupplierRespondDto {
  @IsIn(['withdraw', 'accept', 'counter']) action!: 'withdraw' | 'accept' | 'counter';
  @IsOptional() @IsInt() @Min(1) unitCents?: number;
}

export class AdminRespondDto {
  @IsIn(['accept', 'reject', 'counter']) action!: 'accept' | 'reject' | 'counter';
  @IsOptional() @IsInt() @Min(1) unitCents?: number;
  @IsOptional() @IsInt() @Min(1) pctBps?: number;
}

export class ReceiveUnitDto {
  @IsInt() @Min(1) @Max(10000) n!: number;
  @IsIn(CONDITIONS) condition!: CondStr;
  @IsOptional() @IsString() @MaxLength(200) note?: string;
}
export class ReceiveDto {
  @IsArray() @ArrayMaxSize(10000) @ValidateNested({ each: true }) @Type(() => ReceiveUnitDto) units!: ReceiveUnitDto[];
}

export class VerifyUnitDto {
  @IsInt() @Min(1) @Max(10000) n!: number;
  @IsIn(['ok', 'adjusted', 'returned']) result!: 'ok' | 'adjusted' | 'returned';
  @IsOptional() @IsInt() @Min(1) @Max(9999) adjustBps?: number;
  @IsOptional() @IsString() @MaxLength(200) note?: string;
}
export class VerifyDto {
  @IsArray() @ArrayMaxSize(10000) @ValidateNested({ each: true }) @Type(() => VerifyUnitDto) units!: VerifyUnitDto[];
}

export class PayDto {
  @IsIn(['cash', 'transfer']) method!: 'cash' | 'transfer';
  @IsOptional() @IsString() @MaxLength(80) reference?: string;
}

export class PatchSupplySettingsDto {
  @IsOptional() @IsBoolean() autoPublish?: boolean;
  @IsOptional() @IsBoolean() autoAccept?: boolean;
  @IsOptional() @IsInt() @Min(1) @Max(10000) defaultPctBps?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100_000_000_00) weeklyBudgetCents?: number;
}

/** page/pageSize de query (string) → enteros acotados. */
export function pageOf(q: { page?: string; pageSize?: string }): { page: number; pageSize: number; skip: number } {
  const page = Math.max(1, parseInt(q.page ?? '1', 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(q.pageSize ?? '25', 10) || 25));
  return { page, pageSize, skip: (page - 1) * pageSize };
}
