/**
 * TL D3 (2026-10-19) · paridad de TEXTO de `parseFirstUtm` con el backend (`backend/src/common/first-utm.ts`).
 *
 * `utm.test.ts` solo mira comportamiento con casos elegidos: si el backend cambia la regex o la lista de
 * claves, esos casos pueden seguir verdes. Aquí se LEE el fichero del backend como texto (el frontend no
 * importa código del backend, patrón de `mock/marketing.parity.test.ts`) y se exige lo mismo:
 * la regex de valor, la lista clave-de-query ⇒ clave-corta (y su orden) y el cuerpo de la función sin comentarios.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { UTM_KEY_MAP, UTM_VALUE_RE } from './utm';

const ROOT = resolve(__dirname, '../../../..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');
const BACKEND = read('backend/src/common/first-utm.ts');
const FRONTEND = read('frontend/src/lib/measurement/utm.ts');

function regexLiteral(src: string): string {
  const m = src.match(/const UTM_VALUE_RE = \/(.+)\/([a-z]*);/);
  if (!m) throw new Error('UTM_VALUE_RE no encontrada');
  return `/${m[1]}/${m[2]}`;
}

function keyMap(src: string): Array<[string, string]> {
  const block = src.match(/const UTM_KEY_MAP[^=]*=\s*\[([\s\S]*?)\];/);
  if (!block) throw new Error('UTM_KEY_MAP no encontrada');
  return [...block[1].matchAll(/\['(\w+)',\s*'(\w+)'\]/g)].map((m) => [m[1], m[2]]);
}

/** Cuerpo de `parseFirstUtm` sin comentarios ni espacios: lo que ejecuta, no cómo está explicado. */
function body(src: string): string {
  const start = src.indexOf('export function parseFirstUtm(');
  if (start < 0) throw new Error('parseFirstUtm no encontrada');
  const open = src.indexOf('{', src.indexOf(')', start));
  let depth = 0;
  let end = open;
  for (; end < src.length; end++) {
    if (src[end] === '{') depth++;
    else if (src[end] === '}' && --depth === 0) break;
  }
  return src
    .slice(start, end + 1)
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, '');
}

describe('D3 · parseFirstUtm del frontend = el del backend (texto)', () => {
  it('misma regex de valor', () => {
    expect(regexLiteral(FRONTEND)).toBe(regexLiteral(BACKEND));
    expect(String(UTM_VALUE_RE)).toBe(regexLiteral(BACKEND));
  });

  it('misma lista de claves, en el mismo orden', () => {
    const be = keyMap(BACKEND);
    expect(be.length).toBe(4);
    expect(UTM_KEY_MAP.map(([a, b]) => [a, b])).toEqual(be);
  });

  it('mismo cuerpo de parseFirstUtm (sin comentarios ni espacios)', () => {
    expect(body(FRONTEND)).toBe(body(BACKEND));
  });
});
