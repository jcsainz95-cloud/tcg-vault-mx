/**
 * auth-throttle.e2e-spec.ts — El rate-limiting de `/auth/login` (SEC-C1: 5 intentos/min por IP)
 * sigue VIVO y verificado punta a punta.
 *
 * Contexto (arreglo CI 2026-08-18): el `ThrottlerGuard` se omite bajo `NODE_ENV=test` porque el
 * storage in-memory persiste entre tests del mismo proceso y tumbaba 4 specs de auth con 429
 * (ver `src/config/test-env.ts`). Para que ese relajo NO deje el control de seguridad sin
 * probar, esta suite lo **re-activa explícitamente** (`E2E_ENABLE_THROTTLER=true`) y comprueba
 * contra la app real que el 6º intento en el mismo minuto recibe 429 RATE_LIMITED.
 *
 * API_CONTRACT §1 y §10 (errores); ARCHITECTURE §7.
 */
import { randomBytes } from 'crypto';
import { E2EHarness } from './helpers/e2e-app';

describe('E2E — Rate limiting real de /auth/login (SEC-C1)', () => {
  let h: E2EHarness;
  let prev: string | undefined;

  beforeAll(async () => {
    prev = process.env.E2E_ENABLE_THROTTLER;
    process.env.E2E_ENABLE_THROTTLER = 'true';
    h = await E2EHarness.create();
  });

  afterAll(async () => {
    await h?.close();
    // Se restaura para no contagiar a las demás suites (corren en el MISMO proceso, runInBand).
    if (prev === undefined) delete process.env.E2E_ENABLE_THROTTLER;
    else process.env.E2E_ENABLE_THROTTLER = prev;
  });

  it('corta la fuerza bruta: tras el límite por minuto responde 429 RATE_LIMITED', async () => {
    // Email inexistente a propósito: se ejercita el límite por IP sin tocar cuentas sembradas.
    const attempt = () =>
      h.api('POST', '/auth/login', {
        json: { email: 'brute_force@e2e.local', password: 'wrong-password' },
      });

    const statuses: number[] = [];
    let limited: Awaited<ReturnType<typeof attempt>> | undefined;
    for (let i = 0; i < 10 && !limited; i++) {
      const res = await attempt();
      statuses.push(res.status);
      if (res.status === 429) limited = res;
    }

    expect(limited).toBeDefined();
    expect(limited!.body.error.code).toBe('RATE_LIMITED');
    // 🔒 v1.80.7 (§0 «429», norma de forma): `Retry-After: n` ∧ `details.retryAfterSeconds === n` (el mismo entero).
    const retryAfter = Number(limited!.headers['retry-after']);
    expect(Number.isInteger(retryAfter) && retryAfter > 0).toBe(true);
    expect(limited!.body.error.details).toEqual({ retryAfterSeconds: retryAfter });
    // El límite es 5/min: los primeros intentos pasan al handler (401) antes del corte.
    expect(statuses.filter((s) => s === 401).length).toBeGreaterThanOrEqual(1);
    expect(statuses.indexOf(429)).toBeLessThanOrEqual(6);
  });

  // Fusionado de `staff-throttle.e2e-spec.ts` (HEAP-INTEG-94). v1.80.9, STF-21 (`API_CONTRACT §M6-U.9`, criterio 264): el
  // `@Throttle 5/min` por IP cubre también los nombres de usuario — misma ruta, mismo límite.
  it('STF-21: misma IP, 6 logins en 60 s con usuarios distintos ⇒ 401×5 y el 6.º 429 RATE_LIMITED', async () => {
    const ip = `10.21.${randomBytes(1)[0]}.${randomBytes(1)[0]}`;
    const statuses: number[] = [];
    let last: { status: number; body: any } | undefined;
    for (let i = 0; i < 6; i++) {
      last = await h.api('POST', '/auth/login', {
        json: { email: `stfthr${randomBytes(4).toString('hex')}`, password: 'mala-STF-000' },
        headers: { 'x-forwarded-for': ip },
      });
      statuses.push(last.status);
    }
    expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
    expect(last!.body.error.code).toBe('RATE_LIMITED');
  });
});
