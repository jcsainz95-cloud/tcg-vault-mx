import { ArrayNotEmpty, IsArray, IsIn, IsString } from 'class-validator';
import { ShipmentStatus } from '@prisma/client';

export class ShipmentQuoteDto {
  @IsArray() @ArrayNotEmpty() @IsString({ each: true }) inventoryItemIds!: string[];
  @IsString() addressId!: string;
}

export class CreateShipmentDto {
  @IsArray() @ArrayNotEmpty() @IsString({ each: true }) inventoryItemIds!: string[];
  @IsString() addressId!: string;
}

export class UpdateStatusDto {
  @IsIn(['solicitado', 'picking', 'guia', 'enviado', 'entregado', 'cancelado'])
  to!: ShipmentStatus;
}

export class TrackingDto {
  @IsString() carrier!: string;
  @IsString() trackingNumber!: string;
}
