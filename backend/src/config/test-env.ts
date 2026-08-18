/**
 * test-env.ts — ÚNICO punto donde el código de producción se comporta distinto porque
 * está corriendo bajo la suite automatizada. Propiedad: backend.
 *
 * REGLA DURA (auditable de un vistazo): **nada de aquí puede activarse fuera de
 * `NODE_ENV === 'test'`**. No hay env var que apague el rate-limiting ni el scheduler en
 * staging/producción: la condición `NODE_ENV === 'test'` es un AND obligatorio en las dos
 * funciones de abajo, y `test` es un valor que solo fija jest (y el job E2E de CI). Las envs
 * `E2E_ENABLE_*` solo sirven para volver a ENCENDER la pieza dentro de la propia suite
 * (specs que verifican el rate-limiting real), nunca para apagarla en un entorno real.
 *
 * Motivación (CI 2026-08-18, run 32080601928):
 *  - **Throttler**: `POST /auth/login` está limitado a 5/min por IP (SEC-C1). La suite E2E
 *    hace ~10 logins desde 127.0.0.1 en el mismo minuto y el storage in-memory del throttler
 *    persiste entre tests del mismo proceso → 4 tests caían con 429 RATE_LIMITED. El límite
 *    de producción NO se toca (sigue 5/min); solo se omite el guard bajo `NODE_ENV=test`.
 *  - **Scheduler BullMQ**: cada harness E2E levanta el AppModule completo → cada suite
 *    registraba los crons diarios y un worker sobre la cola compartida `tcg-daily`, y el
 *    catch-up de `price-ingest` (auditoría 2026-08-17) encolaba trabajo REAL al arranque:
 *    el worker se ponía a ingerir precios contra pokemontcg.io y `worker.close()` esperaba a
 *    que terminara → `afterAll` colgado (timeout de 30 s) y handles abiertos. En tests el
 *    scheduler no aporta nada (ninguna spec lo ejercita) y sí aporta indeterminismo y
 *    escrituras de fondo en la BD de test.
 */

/** `true` solo bajo la suite automatizada (jest fija NODE_ENV=test; el job E2E también). */
export function isTestEnv(): boolean {
  return process.env.NODE_ENV === 'test';
}

/**
 * Rate-limiting global (ThrottlerGuard) omitido SOLO en tests.
 * Una spec puede re-activarlo con `E2E_ENABLE_THROTTLER=true` para verificar el 429 real
 * (ver `test/integration/auth-throttle.e2e-spec.ts`).
 */
export function isThrottlerDisabled(): boolean {
  return isTestEnv() && process.env.E2E_ENABLE_THROTTLER !== 'true';
}

/**
 * Scheduler BullMQ (crons diarios + worker + catch-up de price-ingest) deshabilitado SOLO en
 * tests. Se puede re-activar con `E2E_ENABLE_SCHEDULER=true` si algún día se quiere una spec
 * dedicada al scheduler contra Redis real.
 */
export function isSchedulerDisabled(): boolean {
  return isTestEnv() && process.env.E2E_ENABLE_SCHEDULER !== 'true';
}
