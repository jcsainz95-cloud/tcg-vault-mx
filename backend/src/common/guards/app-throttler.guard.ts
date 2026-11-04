import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerLimitDetail } from '@nestjs/throttler';
import { isThrottlerDisabled } from '../../config/test-env';

/**
 * AppThrottlerGuard — `ThrottlerGuard` de Nest con UNA sola diferencia: bajo la suite
 * automatizada (`NODE_ENV=test`) se omite.
 *
 * Por qué a nivel de GUARD y no de config: los endpoints sensibles llevan `@Throttle(...)`
 * por handler (login 5/min, register 5/min, refresh 20/min — SEC-C1). Relajar la config
 * global del `ThrottlerModule` NO afectaría a esos overrides, que son justo los que hacían
 * caer la suite E2E con 429. `shouldSkip` cubre global y overrides por igual.
 *
 * Producción/staging NO se debilitan: la condición vive en `config/test-env.ts` y exige
 * `NODE_ENV === 'test'`; no hay env var que apague el rate-limiting en un entorno real.
 * Los límites configurados (global y por handler) quedan intactos.
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected async shouldSkip(context: ExecutionContext): Promise<boolean> {
    if (isThrottlerDisabled()) return true;
    return super.shouldSkip(context);
  }

  /**
   * v1.117 (§CTA.4): con throttlers CON NOMBRE (`signup`, `signup-day`) Nest pone `Retry-After-<nombre>`, no `Retry-After`,
   * y la norma de forma del 429 (§0 v1.80.7: `Retry-After: n` ∧ `details.retryAfterSeconds = n`) lee `Retry-After`. Se pone
   * aquí la cabecera canónica con la MISMA cifra que Nest calculó; para `default` es la que ya ponía (mismo valor).
   */
  protected async throwThrottlingException(context: ExecutionContext, detail: ThrottlerLimitDetail): Promise<void> {
    const res = context.switchToHttp().getResponse<{ header?: (k: string, v: unknown) => unknown }>();
    if (typeof res?.header === 'function' && Number.isInteger(detail.timeToBlockExpire) && detail.timeToBlockExpire > 0) {
      res.header('Retry-After', detail.timeToBlockExpire);
    }
    return super.throwThrottlingException(context, detail);
  }
}
