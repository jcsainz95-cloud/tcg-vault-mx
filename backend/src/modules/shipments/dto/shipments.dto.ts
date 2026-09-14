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
  /**
   * ⭐ **v1.64(4) / D55(c) (`API_CONTRACT §M10-IVA.8`, `ARCHITECTURE §4.44.f-ter`) — el IVA
   * ACREDITABLE de esa factura, CONGELADO al capturar.**
   *
   * `shippingCostCents` es **BRUTO** —el importe TOTAL de la factura de la paquetería, IVA
   * incluido, que es la cifra que trae el papel— y esto es su acompañante. El neto es una **RESTA**
   * (`shippingCostCents − shippingCostIvaCents`), ⛔ **nunca** una división por `(1+r)`:
   * `ShipmentRequest` **no tiene `ivaRatePct`**, así que derivarlo obligaría a leer el **dial vivo**
   * y un P&L histórico cambiaría al mover `iva_pct` — incumpliendo `IVA-5`.
   *
   * ⛔ **Se CAPTURA, no se deriva** (`IVA-11(c)`). Omitirlo deja la columna como estaba (`0` en las
   * filas históricas ⇒ `neto = bruto`, la dirección **conservadora**: subestima la ganancia, no la
   * infla). ⛔ Y **no se backfillea a `costo × 16/116`**: sería inventar un crédito fiscal que nadie
   * verificó.
   *
   * Misma cota que el bruto: un crédito absurdo distorsiona el P&L en silencio igual que el costo.
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(SHIPPING_COST_MAX_CENTS)
  shippingCostIvaCents?: number;
}
