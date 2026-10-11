import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { BusinessException } from '../../../common/business.exception';
import { AccessoryLineInput, AccessoryLinesField, DeckPullInput, DeckPullsField } from './accessory-cart.dto';

/** v1.82 · PNL-6 (`R69-1`): tope del motivo del reembolso total — el de toda nota de este módulo. */
export const REFUND_REASON_MAX = 500;

/**
 * v1.82 · PNL-6 — `@MaxLength(max)` **que además nombra el campo** (`400 VALIDATION_ERROR { field, max }`).
 *
 * El `ValidationPipe` global no emite `details.field` (TECH_DEBT BE-82: haría falta un `exceptionFactory`
 * en `main.ts`, que no es de este pase), y el contrato pide `{ field: 'reason' }`. El `@Transform` corre
 * dentro de `plainToInstance`, ANTES de class-validator, y una `BusinessException` lanzada ahí sale
 * intacta por `AllExceptionsFilter` ⇒ ⛔ el servicio no llega a correr (cero filas, cero Stripe).
 * El `@MaxLength` queda como declaración (y respaldo) con **la misma cifra**: un solo número.
 * Un no-string pasa intacto al `@IsString()` de siempre.
 */
function MaxLengthWithField(field: string, max: number): PropertyDecorator {
  return applyDecorators(
    Transform(
      ({ value }) => {
        if (typeof value === 'string' && value.length > max) {
          throw BusinessException.badRequest('VALIDATION_ERROR', `${field} must be at most ${max} characters`, {
            field,
            max,
          });
        }
        return value;
      },
      { toClassOnly: true },
    ),
    MaxLength(max),
  );
}

export class QuoteDto {
  @IsArray() @ArrayNotEmpty() @IsString({ each: true }) inventoryItemIds!: string[];
  /**
   * 💰 v1.86⟨accesorios⟩ (§AC.5, criterio 749): se DECLARAN con la forma de §AC.4 para que el `whitelist` no los borre en
   * silencio; no vacíos ⇒ `422 ACCESSORIES_REQUIRE_DIRECT_SHIP` (lo lanza `OrdersController`). ⛔ Se rechazan, no se ignoran.
   */
  @AccessoryLinesField() accessoryLines?: AccessoryLineInput[];
  @DeckPullsField() deckPulls?: DeckPullInput[];
}

export class SessionDto {
  @IsArray() @ArrayNotEmpty() @IsString({ each: true }) inventoryItemIds!: string[];
  @IsOptional() @IsString() billingProfileId?: string;
  /** 💰 v1.86⟨accesorios⟩ (§AC.5): ver `QuoteDto`. */
  @AccessoryLinesField() accessoryLines?: AccessoryLineInput[];
  @DeckPullsField() deckPulls?: DeckPullInput[];
}

export class RefundDto {
  // 🔒 v1.82 (PNL-6, `R69-1`): 0–500 caracteres; más ⇒ `400 VALIDATION_ERROR {field:'reason'}`. ⛔ Sin
  // `MinLength` (rompería a quien hoy manda `""`).
  @IsString() @MaxLengthWithField('reason', REFUND_REASON_MAX) reason!: string;
  /**
   * 💰 v1.80.5 (SEC-SHIP-B10, §M4-SHIP.18.4): en una orden `vault` con cartas ya en manos del cliente
   * (`already_withdrawn`) el reembolso total exige esta confirmación explícita ⇒ si no, `422
   * REFUND_CONFIRMATION_REQUIRED {required:['pieces_with_customer'], items}`.
   */
  @IsOptional() @IsBoolean() confirmPiecesWithCustomer?: boolean;
  /**
   * 💰 v1.80.8.6 (§M4-SHIP.18.12 (4)) — motivo CERRADO del reembolso total de un pedido YA ENVIADO
   * (`not_arrived | arrived_damaged`, clase R `ACCEPTED_SHIPPED_REFUND_REASONS`). Solo `@IsOptional` (lo conserva el
   * `whitelist`): el dominio lo valida el servicio para responder `400 {field:'shippedReason', allowed}`.
   */
  @IsOptional() shippedReason?: unknown;
}

/** 🔒 v1.80.5/.6 (§M4-SHIP.18.10) — `POST /admin/orders/:id/reclaim-vault`. */
export class ReclaimVaultDto {
  @IsString() @MinLength(3) @MaxLength(500) note!: string;
  /** «Saqué de su caja las cartas de retiros preparados o con guía». */
  @IsOptional() @IsBoolean() confirmUnpacked?: boolean;
  /** v1.80.6 (SEC-SHIP-B12): acota `confirmUnpacked` a estas piezas (1–50; solo con `confirmUnpacked:true`). */
  @IsOptional() @IsArray() @ArrayNotEmpty() @ArrayMaxSize(50) @IsString({ each: true }) inventoryItemIds?: string[];
}

/**
 * v1.21.2 (§M3) — desenlace HUMANO de una pieza congelada por un contracargo con envío vivo.
 * `note` es OBLIGATORIA (3–500): es el registro de lo que el operador vio en el estante, y lo
 * único que queda como evidencia de por qué la carta volvió (o no) al inventario.
 */
export class ChargebackInventoryDto {
  @IsIn(['recuperada', 'no_recuperada', 'reexpedir'])
  outcome!: 'recuperada' | 'no_recuperada' | 'reexpedir';

  @IsString() @MinLength(3) @MaxLength(500) note!: string;
}
