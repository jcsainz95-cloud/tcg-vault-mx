import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
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
}
