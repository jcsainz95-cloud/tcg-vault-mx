/**
 * shipping-provider.errors.ts — los errores del proveedor de guías, con su status HTTP ya decidido por la matriz de
 * `API_CONTRACT §M4-SHIP.19.19.3 (4)`. El dominio los convierte a la respuesta con `toBusinessException()`.
 *
 * ⛔ Ningún mensaje ni `details` lleva cuerpo del proveedor, token ni secreto: solo `provider`, `op`, `status`,
 * `reason` y, en el rechazo, el código/mensaje que el proveedor dio (que la pantalla muestra en llano, T.4.5).
 */
import { HttpStatus } from '@nestjs/common';
import { BusinessException } from '../../common/business.exception';
import { ErrorCode, ErrorCodeType } from '../../common/error-codes';

export type ShippingProviderErrorCode =
  | typeof ErrorCode.SHIPPING_PROVIDER_ERROR
  | typeof ErrorCode.SHIPPING_PROVIDER_BUSY
  | typeof ErrorCode.SHIPPING_PROVIDER_REJECTED
  | typeof ErrorCode.SHIPPING_PROVIDER_NOT_CONFIGURED;

export class ShippingProviderError extends Error {
  constructor(
    public readonly code: ShippingProviderErrorCode,
    public readonly httpStatus: number,
    public readonly details: Record<string, unknown>,
    message?: string,
  ) {
    super(message ?? `${code} ${JSON.stringify(details)}`);
    this.name = 'ShippingProviderError';
  }

  toBusinessException(): BusinessException {
    return new BusinessException(this.code as ErrorCodeType, this.httpStatus, this.code, this.details);
  }

  static error(op: string, status: number | null, reason?: string): ShippingProviderError {
    const details: Record<string, unknown> = { provider: 'skydropx', op, status };
    if (reason) details.reason = reason;
    return new ShippingProviderError(ErrorCode.SHIPPING_PROVIDER_ERROR, HttpStatus.BAD_GATEWAY, details);
  }

  static busy(op: string): ShippingProviderError {
    return new ShippingProviderError(ErrorCode.SHIPPING_PROVIDER_BUSY, HttpStatus.SERVICE_UNAVAILABLE, {
      provider: 'skydropx',
      op,
    });
  }

  static rejected(op: string, providerCode: string | null, providerMessage: string | null): ShippingProviderError {
    return new ShippingProviderError(ErrorCode.SHIPPING_PROVIDER_REJECTED, HttpStatus.UNPROCESSABLE_ENTITY, {
      provider: 'skydropx',
      op,
      providerCode,
      providerMessage,
    });
  }

  static notConfigured(missing: string[]): ShippingProviderError {
    return new ShippingProviderError(ErrorCode.SHIPPING_PROVIDER_NOT_CONFIGURED, HttpStatus.CONFLICT, { missing });
  }
}

/**
 * 💰 «Compra en vuelo» (§19.7 paso 9 ⚠️, §19.19.3 (4)): la petición de compra SALIÓ y no sabemos si Skydropx creó la
 * guía (timeout, red, `5xx`, `404`, `2xx` ilegible). ⛔ No se reintenta: lo resuelve `recoverInFlightLabel` /
 * `label/release`. El status HTTP es el de la fila de la matriz (`503` o `502`).
 */
export class ShippingProviderPurchaseInFlightError extends ShippingProviderError {
  readonly purchaseInFlight = true as const;
  constructor(base: ShippingProviderError) {
    super(base.code, base.httpStatus, base.details, base.message);
    this.name = 'ShippingProviderPurchaseInFlightError';
  }
}

export type MutationForbiddenReason = 'test_runtime' | 'ci' | 'not_enabled';

/**
 * 🔒 PS-99 — el candado de ejecución negó una llamada que gasta (§19.19.7). Sale como
 * `409 SHIPPING_PROVIDER_NOT_CONFIGURED {missing:['allow_spend']}` (⛔ no dice cuál de las condiciones falló).
 */
export class SkydropxMutationForbiddenError extends ShippingProviderError {
  constructor(
    public readonly reason: MutationForbiddenReason,
    public readonly op: string,
  ) {
    super(
      ErrorCode.SHIPPING_PROVIDER_NOT_CONFIGURED,
      HttpStatus.CONFLICT,
      { missing: ['allow_spend'] },
      `skydropx mutation forbidden (${reason}) op=${op}`,
    );
    this.name = 'SkydropxMutationForbiddenError';
  }
}
