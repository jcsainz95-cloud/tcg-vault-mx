import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import ts from 'typescript';
// El MISMO módulo que `next build` ejecuta antes de compilar: si él decide «reconfigurar», reescribe
// el fichero. Aquí se le deja hacerlo sobre una copia y se mide que NO tenga nada que añadir.
import { writeConfigurationDefaults } from 'next/dist/lib/typescript/writeConfigurationDefaults.js';
import { tsconfigPathForDistDir } from '../../next.config.mjs';

/**
 * 🔒 Hallazgo #1 de QA (2026-09-11): `next build` con `NEXT_DIST_DIR=.next-e2e-mock-<x>` reescribía el
 * `tsconfig.json` commiteado (reformateo + la entrada `.next-e2e-mock-<x>/types/…` en `include`). El
 * remedio vive en `next.config.mjs` (`typescript.tsconfigPath` → tsconfig GENERADO por distDir). Este
 * candado mide por CONDUCTA, con el propio `writeConfigurationDefaults` de Next:
 *   1. el generado extiende el principal y trae el `include` que Next exige;
 *   2. Next, invocado sobre el generado, NO escribe nada (ni en él ni en `tsconfig.json`);
 *   3. con `.next` no se genera nada: se usa `tsconfig.json` tal cual.
 */
const REPO_TSCONFIG = readFileSync(join(__dirname, '..', '..', 'tsconfig.json'), 'utf8');

const dirs: string[] = [];
function sandbox(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tcg-tsconfig-'));
  writeFileSync(join(dir, 'tsconfig.json'), REPO_TSCONFIG);
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('next.config.mjs · tsconfigPathForDistDir (hallazgo #1 de QA)', () => {
  it('el tsconfig.json del repo NO arrastra tipos de ningún distDir alternativo (solo .next/types)', () => {
    const include = (JSON.parse(REPO_TSCONFIG) as { include: string[] }).include;
    expect(include.filter((e) => /^\.next/.test(e))).toEqual(['.next/types/**/*.ts']);
  });

  it('con `.next` (build normal) devuelve tsconfig.json y no genera nada', () => {
    const dir = sandbox();
    expect(tsconfigPathForDistDir('.next', { baseDir: dir })).toBe('tsconfig.json');
    expect(tsconfigPathForDistDir('', { baseDir: dir })).toBe('tsconfig.json');
    expect(() => readFileSync(join(dir, 'tsconfig.next.json'))).toThrow();
  });

  it('con un distDir alternativo genera `tsconfig.<distDir>.json` que extiende el principal con SU include', () => {
    const dir = sandbox();
    const name = tsconfigPathForDistDir('.next-e2e-mock-fix1', { baseDir: dir });
    expect(name).toBe('tsconfig.next-e2e-mock-fix1.json');
    const generated = JSON.parse(readFileSync(join(dir, name), 'utf8')) as {
      extends: string;
      include: string[];
      exclude: string[];
    };
    expect(generated.extends).toBe('./tsconfig.json');
    expect(generated.include).toEqual(['next-env.d.ts', '**/*.ts', '**/*.tsx', '.next-e2e-mock-fix1/types/**/*.ts']);
    expect(generated.exclude).toEqual(['node_modules']);
    // Idempotente: una segunda llamada no cambia el contenido.
    tsconfigPathForDistDir('.next-e2e-mock-fix1', { baseDir: dir });
    expect(readFileSync(join(dir, name), 'utf8')).toBe(JSON.stringify(generated, null, 2) + '\n');
  });

  it('CONDUCTA: el reescritor de Next, sobre el generado, no toca ni el generado ni tsconfig.json', async () => {
    const dir = sandbox();
    const name = tsconfigPathForDistDir('.next-e2e-mock-fix1', { baseDir: dir });
    const generatedBefore = readFileSync(join(dir, name), 'utf8');
    await writeConfigurationDefaults(ts, join(dir, name), false, true, '.next-e2e-mock-fix1', false);
    expect(readFileSync(join(dir, name), 'utf8')).toBe(generatedBefore);
    expect(readFileSync(join(dir, 'tsconfig.json'), 'utf8')).toBe(REPO_TSCONFIG);
  });

  it('CONDUCTA (control del candado): sin el generado, Next SÍ reescribe tsconfig.json — el defecto existe', async () => {
    const dir = sandbox();
    await writeConfigurationDefaults(ts, join(dir, 'tsconfig.json'), false, true, '.next-e2e-mock-fix1', false);
    const after = readFileSync(join(dir, 'tsconfig.json'), 'utf8');
    expect(after).not.toBe(REPO_TSCONFIG);
    expect((JSON.parse(after) as { include: string[] }).include).toContain('.next-e2e-mock-fix1/types/**/*.ts');
  });
});
