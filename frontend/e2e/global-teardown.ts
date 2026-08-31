import { IS_REAL, clearSessions } from './utils/env';
import { restoreGradingDial } from './utils/grading';

/**
 * `globalTeardown` de Playwright — corre UNA vez, cuando **todos** los workers terminaron.
 *
 * Es el único sitio correcto para deshacer un cambio de configuración GLOBAL del entorno: un
 * `afterAll` corre por worker y apagaría el interruptor mientras otro worker sigue navegando.
 *
 * Hace dos cosas, y el orden importa:
 *
 *  1. **Apaga el dial `gradingHookEnabled`** (v1.51, M-46) que el arnés del gancho de grading
 *     enciende para poder probar la feature contra el stack real (ver `e2e/utils/grading.ts`). Sólo
 *     aplica en modo real; en mock no hay nada que deshacer. **Apaga, no restaura**: desde el
 *     colapso a un solo dial, `on` publica **y** autoriza gasto en un proveedor de paga, así que
 *     dejarlo encendido «porque así estaba» convertiría el siguiente tick del cron en una factura
 *     que nadie pidió. Encenderlo es del dueño, desde M10 (ARCHITECTURE §4.38r.3).
 *
 *  2. **Purga del disco los tokens de la corrida** (IMP-A de QA). `e2e/utils/state.ts` cachea el
 *     `TokenPair` COMPLETO —access **y refresh**— de cada rol para no comerse el rate-limit de
 *     `POST /auth/login`; entre ellos el de `super_admin`. Se limpiaban `dial` y `scenario` y
 *     **nunca** la sesión, así que los tokens sobrevivían en `/tmp` hasta caducar — y con
 *     `E2E_BASE_URL` apuntando a staging (caso documentado en `scripts/stack-native.sh` y
 *     `DEVOPS_NOTES`) eso es una sesión renovable de `super_admin` de staging tirada en el runner.
 *     Va **después** de restaurar el dial porque restaurarlo necesita esa misma sesión, y **fuera
 *     del `if`**: si la restauración falla, los tokens se borran igual. Purgar no cuesta red.
 */
export default async function globalTeardown(): Promise<void> {
  try {
    if (IS_REAL) await restoreGradingDial();
  } finally {
    const removed = clearSessions();
    if (removed > 0) {
      console.log(`[e2e] Estado de sesión purgado del disco: ${removed} archivo(s) con tokens.`);
    }
  }
}
