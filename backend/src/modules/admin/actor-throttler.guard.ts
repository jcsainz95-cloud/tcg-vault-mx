import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { isThrottlerDisabled } from '../../config/test-env';

/**
 * ⭐⭐ **`ActorThrottlerGuard` — el tope cuelga del ACTOR (`actorUserId`), no de la IP.**
 * v1.69 (P-78, hallazgo de `seguridad` sobre §M6-K.2; `docs/SECURITY_NOTES.md`).
 *
 * ### Por qué el eje de IP no sirve AQUÍ, dicho con la amenaza concreta
 * El tope de `GET /admin/users/:id/kyc/ine-links` no existe para frenar a una red: existe para
 * frenar **una sesión de `super_admin` abusada** —robada, prestada o mal usada— que quiera hacer un
 * volcado de identidades. Esa sesión **cambia de IP cuando quiere**, así que un tope por IP le cuesta
 * un proxy; y el eje de IP es exactamente el que **`P-RL-1` (ALTA, ABIERTO)** sabe esquivar
 * falsificando `X-Forwarded-For`. Un tope que el atacante elige **no es un tope**.
 *
 * Sobre el eje del actor, en cambio, el límite es el que la norma quería: **10 miradas por minuto
 * por persona**, un ritmo humano de revisión, y un volcado masivo choca contra él aunque salte de IP
 * en IP. *No impedimos que el dueño mire a sus clientes: hacemos que mirar cueste tiempo y deje
 * huella.*
 *
 * ### Por qué es un guard de RUTA y no un cambio del guard global
 * `AppThrottlerGuard` (`common/`) gobierna **todas** las rutas, incluidas las **anónimas**
 * (`/auth/login`, `/auth/register`), donde **no hay actor** y el eje correcto **es** la IP. Cambiar
 * el tracker global movería el eje de la protección de fuerza bruta de credenciales, que es de otro
 * frente y de otro stream. Este guard se aplica **solo al handler de PII**.
 *
 * ⚠️ **Corre DESPUÉS de `JwtAuthGuard`** (los guards globales se ejecutan antes que los de ruta), así
 * que `req.user` ya está poblado. Si aun así no lo estuviera, **no se degrada a la IP en silencio**:
 * se usa un cubo `anon` compartido, deliberadamente estrecho — una petición sin actor a esta ruta no
 * debería existir, y si existe es mejor que se estreche sola que que se abra sola.
 *
 * ⚠️ El guard global **también** sigue aplicando su cuenta por IP sobre el mismo `@Throttle` (dos
 * cubos, dos ejes, gana el más estricto). No se «arregla»: es defensa en profundidad y el eje que
 * este guard añade es el que la amenaza exige.
 */
@Injectable()
export class ActorThrottlerGuard extends ThrottlerGuard {
  protected async shouldSkip(context: ExecutionContext): Promise<boolean> {
    // Misma excepción que `AppThrottlerGuard`, y por el mismo motivo: bajo `NODE_ENV=test` la suite
    // automatizada golpea los endpoints en ráfaga. ⛔ No hay env var que lo apague en un entorno
    // real (`config/test-env.ts` exige `NODE_ENV === 'test'`).
    if (isThrottlerDisabled()) return true;
    return super.shouldSkip(context);
  }

  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    const user = req.user as { id?: unknown } | undefined;
    return typeof user?.id === 'string' ? `actor:${user.id}` : 'actor:anon';
  }
}
