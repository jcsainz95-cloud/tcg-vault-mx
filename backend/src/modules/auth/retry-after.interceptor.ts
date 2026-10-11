import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Response } from 'express';
import { Observable, catchError, throwError } from 'rxjs';
import { BusinessException } from '../../common/business.exception';

/**
 * v1.80 (C7, contrato §0 `TOO_MANY_PASSWORD_ATTEMPTS`): la cabecera `Retry-After` (segundos) es
 * NORMATIVA y lleva el mismo número que `details.retryAfterSeconds`. Se pone aquí, en el módulo que
 * emite el código, y no en el filtro global (zona compartida que este corte no necesita tocar): el
 * filtro serializa con `res.status().json()`, que conserva las cabeceras ya puestas.
 */
@Injectable()
export class PasswordAttemptsRetryAfterInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      catchError((err: unknown) => {
        if (err instanceof BusinessException && err.code === 'TOO_MANY_PASSWORD_ATTEMPTS') {
          const seconds = Number(err.details.retryAfterSeconds);
          if (Number.isFinite(seconds) && seconds > 0) {
            context.switchToHttp().getResponse<Response>().setHeader('Retry-After', String(seconds));
          }
        }
        return throwError(() => err);
      }),
    );
  }
}
