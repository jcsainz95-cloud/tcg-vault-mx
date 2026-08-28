import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Candado del ARNÉS E2E (hallazgo de devops sobre IMPORTANTE-2).
 *
 * `E2E_REAL` es, en `playwright.config.ts`, la bandera de **SELECCIÓN DE SPECS** (`grep: /@real/`).
 * La pregunta que un spec necesita contestar es otra: **«¿contra qué habla la app?»**, y ésa la
 * resuelve `IS_REAL` en `e2e/utils/auth.ts` (`!FORCE_MOCK && (APP_IS_EXTERNAL || REAL_SUBSET_SELECTED)`).
 *
 * Qué pasó: `guest-checkout.spec.ts` ramificaba con `process.env.E2E_REAL` CRUDO. Sin la bandera
 * puesta tomaba la rama MOCK de sus asertos —clic en «Pagar» simulado y esperar el número de
 * pedido— **contra un modal de Stripe real**: un verde falso en uno de los tres flujos de dinero,
 * justo el que el gate de promoción acababa de empezar a correr. Además ataba `.github/` a fijar
 * `E2E_REAL` sólo para que ese archivo se comportara.
 *
 * La regla: **un solo módulo lee la variable de entorno; los specs le preguntan a él.**
 */
function specFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.spec.ts'))
    .map((e) => join(dir, e.name));
}

describe('arnés E2E · el modo se pregunta UNA vez', () => {
  const e2eDir = join(__dirname, '..', '..', 'e2e');

  it('ningún spec lee `process.env.E2E_REAL` — para eso está `IS_REAL`', () => {
    const offenders = specFiles(e2eDir)
      .filter((f) => {
        // Se ignoran los comentarios: la prohibición es sobre el CÓDIGO, y explicar por qué no se
        // usa la variable es exactamente lo que queremos que siga escrito.
        const code = readFileSync(f, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/(^|[^:])\/\/.*$/gm, '$1');
        return /process\.env\.E2E_REAL/.test(code);
      })
      .map((f) => f.split('/').pop()!);
    expect(
      offenders,
      `specs que le preguntan al entorno en vez de a IS_REAL: ${offenders.join(', ')}`,
    ).toEqual([]);
  });

  it('los specs que ramifican por entorno importan `IS_REAL` del helper', () => {
    const branching = specFiles(e2eDir).filter((f) => /\bIS_REAL\b/.test(readFileSync(f, 'utf8')));
    // Hoy son checkout · guest-checkout · shipments · master-set · pricing-curve. No se fija la
    // lista (crecerá): se fija que quien ramifica lo hace con el import, no con el entorno.
    expect(branching.length).toBeGreaterThan(0);
    for (const f of branching) {
      const src = readFileSync(f, 'utf8');
      expect(src, `${f} usa IS_REAL sin importarlo de utils/auth`).toMatch(
        /import\s*\{[^}]*\bIS_REAL\b[^}]*\}\s*from\s*'\.\/utils\/auth'/,
      );
    }
  });
});
