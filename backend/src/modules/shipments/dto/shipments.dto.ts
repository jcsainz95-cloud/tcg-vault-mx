import { ArrayNotEmpty, IsArray, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { ShipmentStatus } from '@prisma/client';

// SEC-C2: cota superior de `shippingCostCents`. Un valor absurdo distorsiona el P&L (M7) en
// silencio y, por encima de 2^31−1, desborda el `Int` de Postgres. Tope = MX$100,000 (en cents),
// holgado para el costo real de UN envío de paquetería y muy por debajo del Int32 máx.
export const SHIPPING_COST_MAX_CENTS = 100_000_00;

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
  // v1.4-finance: costo real MXN (centavos) que la plataforma paga al carrier. Opcional,
  // editable, entero >= 0. Interno de costo; NO se expone al cliente (API_CONTRACT §M4).
  // SEC-C2: cota superior para evitar distorsión silenciosa del P&L y overflow Int32.
  @IsOptional() @IsInt() @Min(0) @Max(SHIPPING_COST_MAX_CENTS) shippingCostCents?: number;
}
