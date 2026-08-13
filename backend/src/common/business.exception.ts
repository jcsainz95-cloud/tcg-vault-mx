import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCodeType } from './error-codes';

/**
 * BusinessException — Excepción con `errorCode` estable + status HTTP.
 * El filtro global la serializa al shape del contrato:
 *   { error: { code, message, details } }
 */
export class BusinessException extends HttpException {
  constructor(
    public readonly code: ErrorCodeType,
    status: HttpStatus,
    message?: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super({ code, message: message ?? code, details }, status);
  }

  static validation(code: ErrorCodeType, message?: string, details?: Record<string, unknown>) {
    return new BusinessException(code, HttpStatus.UNPROCESSABLE_ENTITY, message, details);
  }

  static forbidden(code: ErrorCodeType, message?: string, details?: Record<string, unknown>) {
    return new BusinessException(code, HttpStatus.FORBIDDEN, message, details);
  }

  static notFound(code: ErrorCodeType = 'NOT_FOUND', message?: string) {
    return new BusinessException(code, HttpStatus.NOT_FOUND, message);
  }

  static conflict(code: ErrorCodeType, message?: string, details?: Record<string, unknown>) {
    return new BusinessException(code, HttpStatus.CONFLICT, message, details);
  }

  static badRequest(code: ErrorCodeType, message?: string, details?: Record<string, unknown>) {
    return new BusinessException(code, HttpStatus.BAD_REQUEST, message, details);
  }

  /** 503 — error transitorio; el cliente puede reintentar (p. ej. fallo del proveedor de pago). */
  static retriable(code: ErrorCodeType, message?: string, details?: Record<string, unknown>) {
    return new BusinessException(code, HttpStatus.SERVICE_UNAVAILABLE, message, details);
  }
}
