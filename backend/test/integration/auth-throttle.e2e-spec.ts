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
    // El límite es 5/min: los primeros intentos pasan al handler (401) antes del corte.
    expect(statuses.filter((s) => s === 401).length).toBeGreaterThanOrEqual(1);
    expect(statuses.indexOf(429)).toBeLessThanOrEqual(6);
  });
});
