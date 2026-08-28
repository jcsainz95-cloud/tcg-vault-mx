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

/**
 * ─────────────────────────────────────────────────────────────────────────────────────
 * Candado nº2 (bloqueante de QA, v1.50.3): **el gancho de grading no puede volver a quedar
 * fuera del gate.**
 *
 * Qué pasó: los 9 specs de `grading-estimate.spec.ts` navegaban a ids de FIXTURE
 * (`c-blastoise`, `c-eevee`, `c-pikachu`, `c-milotic-fa`) y asertaban montos de fixture, sin
 * declararse `mockOnly`. Contra el stack vivo eran 9 rojos; y como ninguno llevaba `@real`,
 * **el subset `@real` —el único que corre contra la plataforma levantada— no probaba ni una
 * línea de la feature**. En mock se probaba contra las propias simulaciones del front; en real,
 * nada. El «97/97» era cierto y no significaba nada sobre esta feature.
 *
 * Estas dos aserciones hacen ese estado IMPOSIBLE de reintroducir en silencio:
 *  1. el archivo tiene cobertura tagueada `@real`;
 *  2. ningún test que navegue a un id de fixture puede correr en real sin declararlo.
 * ─────────────────────────────────────────────────────────────────────────────────────
 */
describe('arnés E2E · el gancho de grading corre contra el stack real', () => {
  const specPath = join(__dirname, '..', '..', 'e2e', 'grading-estimate.spec.ts');
  const src = readFileSync(specPath, 'utf8');

  it('tiene cobertura declarada `@real` (el subset que corre contra la plataforma levantada)', () => {
    const tagged = src.match(/@real/g) ?? [];
    // Ficha (4) + teja (3) + vitrina (2) + back-office (2). Se exige un piso, no el número
    // exacto: añadir casos no debe romper el candado; vaciarlo, sí.
    expect(
      tagged.length,
      'grading-estimate.spec.ts se quedó sin tests `@real`: el gate volvería a no probar el gancho',
    ).toBeGreaterThanOrEqual(8);
  });

  it('los ids de FIXTURE solo aparecen en tests declarados `mockOnly` / `needsSeed`', () => {
    // Se parte por `test(`: cada trozo es un caso. Un caso que navega a `/catalog/c-…` depende de
    // datos que el backend real no promete, así que TIENE que declararlo — si no, es un rojo
    // garantizado contra el stack vivo (o, peor, un hueco de cobertura disfrazado).
    const cases = src.split(/\n\s*test\(/).slice(1);
    const offenders = cases
      .filter((c) => /\/catalog\/c-/.test(c) && !/mockOnly\(|needsSeed\(/.test(c))
      .map((c) => c.split('\n')[0].trim().slice(0, 80));
    expect(
      offenders,
      `tests que navegan a ids de fixture sin declararse mock-only/needs-seed: ${offenders.join(' | ')}`,
    ).toEqual([]);
  });
});
