/**
 * spend-gate.ts — 💰🔒 el candado de ejecución de la compra (API_CONTRACT §M4-SHIP.19.19.7, PS-99 (b)).
 *
 * ⭐ ÚNICO fichero de `backend/src` que lee `SKYDROPX_ALLOW_SPEND` y `SHIPPING_FAKE_PURCHASE` (C-SDX-8 ampliado en
 * v1.80.12.12, prueba estática). ⛔ `evaluateMutationGate`/`readMutationGateInput` NO leen `SHIPPING_FAKE_PURCHASE`. Las otras dos llaves
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
 * ¿Está girada la llave de devops? (`SKYDROPX_ALLOW_SPEND === 'true'`). La usa el arranque (rechaza
 * `SHIPPING_PROVIDER_ADAPTER=fake` con la llave girada, PS-98) y, para el adaptador real, `isPurchaseKeyTurned`.
 * ⛔ No es el candado: el candado es `assertMutationAllowed`.
 */
export function isSpendKeyTurned(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SKYDROPX_ALLOW_SPEND === 'true';
}

/** = `ShippingProviderSelection.kind` (la fábrica lo decide al ARRANCAR; ⛔ nunca sale de la petición). */
export type ProviderKind = 'skydropx' | 'fake' | 'noop';

/**
 * 💰🔒 v1.80.12.12 (§M4-SHIP.19.31.5) — la TERCERA llave de la puerta de compra depende del adaptador elegido al arrancar:
 *  - `skydropx` ⇒ `SKYDROPX_ALLOW_SPEND === 'true'` (sin cambio; el candado de ejecución sigue dentro del cliente real);
 *  - `fake`     ⇒ `SHIPPING_FAKE_PURCHASE === 'true'` (la pila E2E con el doble: sin red y sin dinero);
 *  - `noop`     ⇒ `false`.
 * La usan el paso 1 de `label` (`409 {missing:['allow_spend']}`), `labelOptions.canPurchase` y el proveedor por defecto
 * de `LABEL_SPEND_KEY`. ⛔ `SHIPPING_FAKE_PURCHASE` NO abre el adaptador real y NO entra en `evaluateMutationGate`.
 */
export function isPurchaseKeyTurned(kind: ProviderKind, env: NodeJS.ProcessEnv = process.env): boolean {
  if (kind === 'skydropx') return isSpendKeyTurned(env);
  if (kind === 'fake') return env.SHIPPING_FAKE_PURCHASE === 'true';
  return false;
}

/**
 * 🔒 v1.80.12.12 (§M4-SHIP.19.31.5 (2)) — ¿la llave del doble está puesta junto a un adaptador que NO es el doble?
 * `true` ⇔ `SHIPPING_FAKE_PURCHASE` no vacía (tras `trim`) ∧ `adapter !== 'fake'`. La fábrica NO arranca entonces: una
 * llave suelta en producción tumba el despliegue en vez de ignorarse en silencio.
 */
export function fakePurchaseKeyMisplaced(adapter: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return nonEmpty(env.SHIPPING_FAKE_PURCHASE) && adapter !== 'fake';
}

function nonEmpty(v: string | undefined): boolean {
  return typeof v === 'string' && v.trim() !== '';
}
