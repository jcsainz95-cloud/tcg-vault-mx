// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { centsToPesosInput, pesosToCents, pesosToCentsOrNull } from './money-input';
import { analizarFuente, codigoDe } from '@/test/strip-comments';

/**
 * TL-ENV-F2 — un solo conversor pesos → centavos en el front (`@/lib/money-input`). Recoge los casos que cubrían
 * `m4/pesosToCents.test.ts` y `accessories/money-input` (retirados), con la diferencia dicha: el de M4 aceptaba negativos y
 * 3 decimales con redondeo; el único los rechaza (un importe tecleado nunca es negativo y `12.345` es un error de tecleo).
 */
describe('pesosToCents · el conversor único', () => {
  it('vacío o solo espacios ⇒ `null` (el campo está vacío; ⛔ nunca 0)', () => {
    expect(pesosToCents('')).toBeNull();
    expect(pesosToCents('   ')).toBeNull();
  });

  it('cero explícito ⇒ 0 (no es lo mismo que vacío)', () => {
    expect(pesosToCents('0')).toBe(0);
    expect(pesosToCents('0.00')).toBe(0);
  });

  it('enteros, decimales y comas de miles, con aritmética de enteros', () => {
    expect(pesosToCents('150')).toBe(15_000);
    expect(pesosToCents('318.00')).toBe(31_800);
    expect(pesosToCents('12.5')).toBe(1250);
    expect(pesosToCents('0.29')).toBe(29);
    expect(pesosToCents('1,250.50')).toBe(125_050);
    expect(pesosToCents('.5')).toBe(50);
    expect(pesosToCents('12.')).toBe(1200);
    expect(pesosToCents('  1234.56  ')).toBe(123_456);
  });

  it('mal formado ⇒ `NaN` (se marca inválido; ⛔ no se envía)', () => {
    for (const bad of ['abc', '$100', '-5', '12.345', '1.2.3', '.', '1e3', '0x10', '1 000']) {
      expect(pesosToCents(bad), bad).toBeNaN();
    }
  });

  it('`pesosToCentsOrNull`: vacío y mal formado ⇒ `null`; el resto, igual', () => {
    expect(pesosToCentsOrNull('')).toBeNull();
    expect(pesosToCentsOrNull('abc')).toBeNull();
    expect(pesosToCentsOrNull('-5')).toBeNull();
    expect(pesosToCentsOrNull('150')).toBe(15_000);
    expect(pesosToCentsOrNull('0')).toBe(0);
  });

  it('`centsToPesosInput` ida y vuelta', () => {
    expect(centsToPesosInput(null)).toBe('');
    expect(centsToPesosInput(undefined)).toBe('');
    expect(centsToPesosInput(12_345)).toBe('123.45');
    expect(centsToPesosInput(5)).toBe('0.05');
    for (const c of [0, 1, 99, 100, 123_456, 1_234_500]) expect(pesosToCents(centsToPesosInput(c))).toBe(c);
  });
});

/**
 * Candado de TL-ENV-F2: ninguna pantalla vuelve a declarar su propio conversor. Comprobación de cierre de la ficha:
 * `grep -rnE "function (pesosToCents|toCents)" frontend/src/app` ⇒ 0; aquí se extiende a `components/` y a las formas
 * `const x = (…) =>` y `pesosInputToCents`, que el grep no veía.
 */
const ROOT = join(process.cwd(), 'src');
const CONVERSOR_LOCAL =
  /\b(?:function\s+(?:pesosToCents|pesosInputToCents|toCents)\b|(?:const|let)\s+(?:pesosToCents|pesosInputToCents|toCents)\s*=)/;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const abs = join(dir, name);
    return statSync(abs).isDirectory() ? walk(abs) : [abs];
  });
}

describe('TL-ENV-F2 · candado: un solo conversor pesos → centavos', () => {
  const ficheros = [...walk(join(ROOT, 'app')), ...walk(join(ROOT, 'components'))]
    .filter((abs) => /\.(ts|tsx)$/.test(abs) && !/\.test\.tsx?$/.test(abs))
    .map((abs) => abs.slice(process.cwd().length + 1));

  it('el barrido mira de verdad', () => {
    expect(ficheros.length).toBeGreaterThan(200);
  });

  it('⛔ ninguna pantalla declara su propio `pesosToCents`/`pesosInputToCents`/`toCents`', () => {
    const ofensores = ficheros.filter((rel) => CONVERSOR_LOCAL.test(codigoDe(join(process.cwd(), rel), rel)));
    expect(ofensores).toEqual([]);
  });

  it('canario: el conversor de `dsc-format.ts:75` de c421de13, reintroducido, se ve; en un comentario, no', () => {
    const rel = 'src/app/[locale]/(admin)/admin/codes/dsc-format.ts';
    const viejo = "export function pesosToCents(raw: string): number | null {\n  return null;\n}\n";
    expect(CONVERSOR_LOCAL.test(analizarFuente(viejo, rel).limpio)).toBe(true);
    expect(CONVERSOR_LOCAL.test(analizarFuente('const toCents = (pesos: string) => 0;\n', rel).limpio)).toBe(true);
    expect(CONVERSOR_LOCAL.test(analizarFuente('// antes: function pesosToCents(raw)\nexport const x = 1;\n', rel).limpio)).toBe(false);
  });
});
