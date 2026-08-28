import { IS_REAL } from './utils/env';
import { restoreGradingDial } from './utils/grading';

/**
 * `globalTeardown` de Playwright — corre UNA vez, cuando **todos** los workers terminaron.
 *
 * Es el único sitio correcto para deshacer un cambio de configuración GLOBAL del entorno: un
 * `afterAll` corre por worker y apagaría el interruptor mientras otro worker sigue navegando.
 *
 * Hoy solo restaura el dial `gradedEstimatesEnabled` que el arnés del gancho de grading enciende
 * para poder probar la feature contra el stack real (ver `e2e/utils/grading.ts`). En modo mock no
 * hay nada que deshacer y sale inmediatamente.
 */
export default async function globalTeardown(): Promise<void> {
  if (!IS_REAL) return;
  await restoreGradingDial();
}
