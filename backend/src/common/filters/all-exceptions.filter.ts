import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { BusinessException } from '../business.exception';
import { ErrorCode } from '../error-codes';

/**
 * Filtro global: serializa TODA excepción al shape del contrato (API_CONTRACT §0):
 *   { error: { code, message, details } }
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();

    if (exception instanceof BusinessException) {
      const body = exception.getResponse() as {
        code: string;
        message: string;
        details: Record<string, unknown>;
      };
      return res.status(exception.getStatus()).json({ error: body });
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const raw = exception.getResponse();
      const message =
        typeof raw === 'string'
          ? raw
          : ((raw as { message?: string | string[] }).message ?? exception.message);
      return res.status(status).json({
        error: {
          code: this.mapStatusToCode(status),
          message: Array.isArray(message) ? message.join('; ') : message,
          details: typeof raw === 'object' ? (raw as Record<string, unknown>) : {},
        },
      });
    }

    this.logger.error('Unhandled exception', exception instanceof Error ? exception.stack : String(exception));
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: { code: ErrorCode.INTERNAL, message: 'Internal server error', details: {} },
    });
  }

  private mapStatusToCode(status: number): string {
    switch (status) {
      case 400:
        return ErrorCode.VALIDATION_ERROR;
      case 401:
        return ErrorCode.UNAUTHENTICATED;
      case 403:
        return ErrorCode.FORBIDDEN;
      case 404:
        return ErrorCode.NOT_FOUND;
      case 409:
        return ErrorCode.CONFLICT;
      case 429:
        return ErrorCode.RATE_LIMITED;
      default:
        return ErrorCode.INTERNAL;
    }
  }
}
