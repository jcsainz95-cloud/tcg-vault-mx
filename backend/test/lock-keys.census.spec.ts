/**
 * lock-keys.census.spec.ts — censo de las claves de candado consultivo (`*_LOCK_KEY`) de `src/`: cada una es PROPIA.
 *
 * Dos candados con la misma clave se serializan entre sí sin que nadie lo haya decidido (o, peor, uno cree tener su turno
 * porque el otro tiene «el mismo» candado). API_CONTRACT §DYN.4.3 exige para `GRADED_TURNS_LOCK_KEY` una clave «distinta de las
 * demás `*_LOCK_KEY` del código»; PEN-DYN-2 añade `SETTINGS_CROSS_RULES_LOCK_KEY`. Lee el código, no la prosa.
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { GRADED_TURNS_LOCK_KEY } from '../src/modules/pricing/price-ingest.service';
import { SETTINGS_CROSS_RULES_LOCK_KEY } from '../src/modules/settings/settings.constants';

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') && !p.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}

/** `export const X_LOCK_KEY = 12_345;` ⇒ [nombre, valor, fichero]. */
export function lockKeysIn(sources: { file: string; text: string }[]): { name: string; value: number; file: string }[] {
  const out: { name: string; value: number; file: string }[] = [];
  for (const { file, text } of sources) {
    for (const m of text.matchAll(/export const (\w+_LOCK_KEY)\s*=\s*([\d_]+)\s*;/g)) {
      out.push({ name: m[1], value: Number(m[2].replace(/_/g, '')), file });
    }
  }
  return out;
}

function duplicates(keys: { name: string; value: number }[]): string[] {
  const byValue = new Map<number, string[]>();
  for (const k of keys) byValue.set(k.value, [...(byValue.get(k.value) ?? []), k.name]);
  return [...byValue.entries()].filter(([, names]) => names.length > 1).map(([v, names]) => `${v}: ${names.join(', ')}`);
}

describe('censo de claves de candado consultivo', () => {
  const src = join(__dirname, '..', 'src');
  const keys = lockKeysIn(walk(src).map((file) => ({ file, text: readFileSync(file, 'utf8') })));

  it('lee las claves del código (si el patrón dejara de casar, el censo no mediría nada)', () => {
    expect(keys.length).toBeGreaterThanOrEqual(10);
    expect(keys.map((k) => k.name)).toEqual(expect.arrayContaining(['GRADED_TURNS_LOCK_KEY', 'SETTINGS_CROSS_RULES_LOCK_KEY']));
    expect(keys.find((k) => k.name === 'GRADED_TURNS_LOCK_KEY')?.value).toBe(GRADED_TURNS_LOCK_KEY);
    expect(keys.find((k) => k.name === 'SETTINGS_CROSS_RULES_LOCK_KEY')?.value).toBe(SETTINGS_CROSS_RULES_LOCK_KEY);
  });

  it('ninguna clave se repite', () => {
    expect(duplicates(keys)).toEqual([]);
  });

  it('canario: una clave repetida se detecta', () => {
    const fake = lockKeysIn([
      { file: 'a.ts', text: 'export const A_LOCK_KEY = 91_130_103;' },
      { file: 'b.ts', text: 'export const B_LOCK_KEY = 91130103;' },
    ]);
    expect(duplicates(fake)).toEqual(['91130103: A_LOCK_KEY, B_LOCK_KEY']);
  });
});
