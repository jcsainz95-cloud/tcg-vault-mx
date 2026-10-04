/**
 * spend-gate.ts — 💰🔒 el candado de ejecución de la compra (API_CONTRACT §M4-SHIP.19.19.7, PS-99 (b)).
 *
 * ⭐ ÚNICO fichero de `backend/src` que lee `SKYDROPX_ALLOW_SPEND` (C-SDX-8, prueba estática). Las otras dos llaves
 * (el dial `shipping_label_purchase` y el rol) las mira el verbo `label`; ésta es la que no depende de que el verbo
 * se acuerde: el cliente la evalúa justo antes de tocar la red en TODA llamada que gasta o cambia estado en
 * Skydropx (`assertMutationAllowed`, §19.19.3 (6)).
 *
 * Por qué existe aunque haya dos llaves (ARCHITECTURE §4.60 (l)): las llaves son configuración, y la configuración se
 * copia. Un `.env` de producción pegado en CI o en una prueba NO debe poder comprar: `CI`, `NODE_ENV=test` y
 * `JEST_WORKER_ID` niegan aunque `SKYDROPX_ALLOW_SPEND=true`.
 */
import { MutationForbiddenReason, SkydropxMutationForbiddenError } from './shipping-provider.errors';

export interface MutationGateInput {
  nodeEnv: string | undefined;
  ci: string | undefined;
  jestWorkerId: string | undefined;
  allowSpend: string | undefined;
}

export type MutationGateResult = 'allowed' | { forbidden: MutationForbiddenReason };

/**
 * Función PURA. `allowed` SOLO con `nodeEnv === 'production' ∧ !ci ∧ !jestWorkerId ∧ allowSpend === 'true'`.
 * Cualquier valor no vacío de `CI` niega (también `CI=false`: falla cerrado, nadie pone `CI` en producción).
 */
export function evaluateMutationGate(input: MutationGateInput): MutationGateResult {
  if (nonEmpty(input.jestWorkerId) || input.nodeEnv === 'test') return { forbidden: 'test_runtime' };
  if (nonEmpty(input.ci)) return { forbidden: 'ci' };
  if (input.nodeEnv !== 'production' || input.allowSpend !== 'true') return { forbidden: 'not_enabled' };
  return 'allowed';
}

/** Lee las cuatro entradas del entorno del PROCESO (⛔ no inyectable desde el cliente: no hay atajo). */
export function readMutationGateInput(env: NodeJS.ProcessEnv = process.env): MutationGateInput {
  return {
    nodeEnv: env.NODE_ENV,
    ci: env.CI,
    jestWorkerId: env.JEST_WORKER_ID,
    allowSpend: env.SKYDROPX_ALLOW_SPEND,
  };
}

/**
 * Lanza `SkydropxMutationForbiddenError(reason)` si el candado no deja pasar. Lee `process.env` en CADA llamada
 * (⛔ sin caché: una env que cambia en caliente no deja la puerta abierta).
 */
export function assertMutationAllowed(op: string): void {
  const result = evaluateMutationGate(readMutationGateInput(process.env));
  if (result !== 'allowed') throw new SkydropxMutationForbiddenError(result.forbidden, op);
}

/**
 * ¿Está girada la llave de devops? (`SKYDROPX_ALLOW_SPEND === 'true'`). La usan el verbo `label` (`409
 * {missing:['allow_spend']}` antes del reclamo, §19.19.7), `labelOptions.canPurchase` y el arranque (rechaza
 * `SHIPPING_PROVIDER_ADAPTER=fake` con la llave girada, PS-98). ⛔ No es el candado: el candado es
 * `assertMutationAllowed`.
 */
export function isSpendKeyTurned(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SKYDROPX_ALLOW_SPEND === 'true';
}

function nonEmpty(v: string | undefined): boolean {
  return typeof v === 'string' && v.trim() !== '';
}
