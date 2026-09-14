import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Response } from 'express';
import { BusinessException } from '../business.exception';
import { ErrorCode } from '../error-codes';
import { isSerializationConflict } from '../serializable-retry';

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

    // ⭐⭐ §0-T — **LA TABLA CERRADA DE DOS ENTRADAS.** Va DESPUÉS de `BusinessException` y de
    // `HttpException` a propósito: una regla de negocio sale intacta y a la primera.
    const transitorio = this.motivoTransitorio(exception);
    if (transitorio) {
      // ⚠️ La distinción vive en el LOG, y ahí es OBLIGATORIA (§0-T regla 1): `P2028` señala **un
      // defecto nuestro** (algo sostuvo un candado de fila más allá de su ventana); agotar reintentos
      // bajo carga es **la cola esperable**. El cliente ve lo mismo porque su remedio es el mismo.
      this.logger.error(
        `§0-T ${ErrorCode.BUSY_TRY_AGAIN} [${transitorio}]: ` +
          (exception instanceof Error ? exception.message : String(exception)),
      );
      // `Retry-After` es NORMATIVO y en SEGUNDOS. Un 503 sin él invita a martillear.
      res.setHeader('Retry-After', '1');
      return res.status(HttpStatus.SERVICE_UNAVAILABLE).json({
        error: {
          code: ErrorCode.BUSY_TRY_AGAIN,
          message: 'the request could not be completed right now; try again',
          // ⛔ VACÍO. Nada de `reason`, ni códigos de Prisma, ni conteo de intentos: *un dato que el
          // cliente no puede usar, publicado en el contrato, es una promesa que habrá que sostener.*
          details: {},
        },
      });
    }

    this.logger.error('Unhandled exception', exception instanceof Error ? exception.stack : String(exception));
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: { code: ErrorCode.INTERNAL, message: 'Internal server error', details: {} },
    });
  }

  /**
   * ⛔⛔ **§0-T regla 3 — TABLA CERRADA DE DOS ENTRADAS. PROHIBIDO el mapeo GLOBAL de Prisma.**
   *
   * Traducir `P2002 → 409` o `P2025 → 404` de forma transversal **cambiaría en silencio la conducta de
   * decenas de rutas** que ya tienen su propia semántica de conflicto y de «no existe», y lo haría sin
   * que ninguna prueba lo pidiera. *Un mapeo global es una decisión de producto disfrazada de higiene.*
   * Todo lo demás de Prisma sigue saliendo **`500 INTERNAL`, exactamente como hoy**.
   *
   * Las dos entradas comparten la garantía que las hace seguras: **ninguna dejó nada escrito**.
   *  - **reintentos agotados** — `P2034` / SQLSTATE `40001` / `40P01`; el rollback es del motor;
   *  - **`P2028`** (timeout de transacción) — tampoco escribió nada, y ⛔ **no se reintenta en el
   *    servidor**: una tx que no cupo en su ventana vuelve a no caber y reintentarla multiplica la carga.
   *
   * @returns la etiqueta para el LOG, o `null` si no es ninguno de los dos.
   */
  private motivoTransitorio(exception: unknown): 'reintentos-agotados' | 'P2028' | null {
    if (exception instanceof Prisma.PrismaClientKnownRequestError && exception.code === 'P2028') {
      return 'P2028';
    }
    // ⚠️ `isSerializationConflict` es la MISMA función que decide si `runSerializable` reintenta, y
    // eso es deliberado: si aquí viviera una segunda lista de códigos, el día que difieran habría un
    // error que se reintenta y no se traduce, o al revés. Una fuente, dos lectores.
    return isSerializationConflict(exception) ? 'reintentos-agotados' : null;
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
