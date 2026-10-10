/**
 * accessory-cart.dto.ts — el cuerpo ADITIVO del carrito con accesorios (API_CONTRACT §AC.4) y su declaración en la
 * compra CON cuenta (§AC.5). Lo que falla aquí sale `400 VALIDATION_ERROR` (ValidationPipe global, `whitelist: true`).
 *
 * ⛔ Ningún campo de precio (I-AC-3): una llave extra la borra el `whitelist` y el importe lo pone el servidor.
 * ⭐ Con cuenta se DECLARAN (para que el `whitelist` no los borre en silencio) y el controlador los rechaza con
 *    `422 ACCESSORIES_REQUIRE_DIRECT_SHIP` (criterio 749: se rechazan, ⛔ no se ignoran).
 */
import { applyDecorators } from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  Validate,
} from 'class-validator';
import { BusinessException } from '../../../common/business.exception';

/** §AC.4: ≤ 20 renglones, cantidad 1..99, ≤ 10 `deckPulls`, `pullToken` ≤ 4096. */
export const ACCESSORY_LINES_MAX = 20;
export const ACCESSORY_LINE_QTY_MAX = 99;
export const DECK_PULLS_MAX = 10;
export const PULL_TOKEN_MAX = 4096;

export class AccessoryLineInput {
  @IsUUID() accessoryId!: string;
  @IsInt() @Min(1) @Max(ACCESSORY_LINE_QTY_MAX) quantity!: number;
}

export class DeckPullInput {
  @IsString() @MinLength(1) @MaxLength(PULL_TOKEN_MAX) pullToken!: string;
  @IsBoolean() withEnergyBundle!: boolean;
}

/**
 * `accessoryId` repetido ⇒ `400 {field:'accessoryLines'}`. El `@Transform` corre dentro de `plainToInstance`, ANTES de
 * class-validator, y la `BusinessException` sale intacta por el filtro global (mismo patrón que `MaxLengthWithField`).
 */
function NoRepeatedAccessory(): PropertyDecorator {
  return Transform(
    ({ value }) => {
      if (Array.isArray(value)) {
        const seen = new Set<unknown>();
        for (const l of value) {
          const id = l && typeof l === 'object' ? (l as { accessoryId?: unknown }).accessoryId : undefined;
          if (id !== undefined && seen.has(id)) {
            throw BusinessException.badRequest('VALIDATION_ERROR', 'accessoryId must not repeat', { field: 'accessoryLines' });
          }
          seen.add(id);
        }
      }
      return value;
    },
    { toClassOnly: true },
  );
}

/** Los dos campos con la forma de §AC.4 (opcionales). */
export function AccessoryLinesField(): PropertyDecorator {
  return applyDecorators(
    IsOptional(),
    NoRepeatedAccessory(),
    IsArray(),
    ArrayMaxSize(ACCESSORY_LINES_MAX),
    ValidateNested({ each: true }),
    Type(() => AccessoryLineInput),
  );
}

export function DeckPullsField(): PropertyDecorator {
  return applyDecorators(IsOptional(), IsArray(), ArrayMaxSize(DECK_PULLS_MAX), ValidateNested({ each: true }), Type(() => DeckPullInput));
}

/** «Carrito vacío» = sin piezas NI accesorios (§AC.4): se valida EN EL DTO (validador de clase sobre el objeto). */
@ValidatorConstraint({ name: 'cartNotEmpty', async: false })
export class CartNotEmptyConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    const o = args.object as { inventoryItemIds?: unknown; accessoryLines?: unknown };
    const items = Array.isArray(o.inventoryItemIds) ? o.inventoryItemIds.length : 0;
    const acc = Array.isArray(o.accessoryLines) ? o.accessoryLines.length : 0;
    return items + acc > 0;
  }
  defaultMessage(): string {
    return 'the cart is empty (no pieces and no accessories)';
  }
}

export const CartNotEmpty = () => Validate(CartNotEmptyConstraint);
