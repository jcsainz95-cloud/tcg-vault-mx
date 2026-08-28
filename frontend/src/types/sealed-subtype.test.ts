import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { SEALED_SUBTYPES, type SealedSubtype } from './contract';
import es from '../../messages/es.json';
import en from '../../messages/en.json';

/**
 * T-1 (techlead) — candado anti-desincronización de `SealedSubtype`.
 *
 * Qué pasó: el contrato define SIETE subtipos de sellado, el backend los acepta (200 con
 * `?sealedSubtype=upc`, 400 con basura) y el `PUT /admin/pricing/sealed-spreads` ya calibra
 * `upc`/`collection`. Pero el front tenía TRES listas de CINCO escritas a mano que tapaban la
 * unión: el editor de spreads de M2 pinta UNA FILA POR ELEMENTO ⇒ el dueño no tenía dónde
 * ponerle precio a UPC ni a Collection, y los filtros de catálogo/tienda DESCARTABAN
 * `?sealedSubtype=upc` sin decir nada. Un filtro que ignora en silencio no falla: miente.
 *
 * Estos tests fijan las tres propiedades que impiden que vuelva a pasar:
 *  1. la lista cubre exactamente el enum del contrato (§Enums, línea `SealedSubtype = …`);
 *  2. cada subtipo tiene etiqueta legible en AMBOS locales (paridad es/en);
 *  3. NADIE vuelve a declarar una segunda lista literal de subtipos fuera de `contract.ts`.
 */

/**
 * Valores del contrato `docs/API_CONTRACT.md` §Enums:
 * `SealedSubtype = box | etb | bundle | tin | blister | upc | collection`.
 * Se escriben a mano A PROPÓSITO: es el espejo del documento contra el que se compara el código.
 * Si el arquitecto agrega un subtipo al contrato, este test es el que obliga a propagarlo.
 */
const CONTRACT_SEALED_SUBTYPES = [
  'box',
  'etb',
  'bundle',
  'tin',
  'blister',
  'upc',
  'collection',
] as const;

/**
 * Candado de TIPO (falla en `tsc`, no solo en runtime): estas dos asignaciones solo compilan si la
 * unión `SealedSubtype` y la lista del contrato son el MISMO conjunto. Si alguien borra un valor de
 * `SEALED_SUBTYPES`, la primera deja de compilar; si agrega uno que el contrato no tiene, falla la
 * segunda. Es la mitad estática del candado; los `it()` de abajo son la mitad dinámica.
 */
const _unionCoversContract: SealedSubtype = null as unknown as (typeof CONTRACT_SEALED_SUBTYPES)[number];
const _contractCoversUnion: (typeof CONTRACT_SEALED_SUBTYPES)[number] = null as unknown as SealedSubtype;
void _unionCoversContract;
void _contractCoversUnion;

/** Camina un objeto de mensajes y devuelve sus rutas de clave (`a.b.c`). */
function keyPaths(obj: unknown, prefix = ''): string[] {
  if (typeof obj !== 'object' || obj === null) return [prefix];
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
    keyPaths(v, prefix ? `${prefix}.${k}` : k),
  );
}

/** Todos los `.ts`/`.tsx` bajo `src/`, sin `node_modules`. */
function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.next') continue;
      sourceFiles(full, acc);
    } else if (/\.tsx?$/.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

describe('SealedSubtype — lista única (T-1)', () => {
  it('la lista cubre EXACTAMENTE el enum del contrato (§Enums), sin faltantes ni extras', () => {
    expect([...SEALED_SUBTYPES].sort()).toEqual([...CONTRACT_SEALED_SUBTYPES].sort());
  });

  it('incluye `upc` y `collection` — los dos que el front descartaba en silencio', () => {
    expect(SEALED_SUBTYPES).toContain('upc');
    expect(SEALED_SUBTYPES).toContain('collection');
  });

  it('no repite valores (una fila duplicada en el editor = dos inputs para el mismo spread)', () => {
    expect(new Set(SEALED_SUBTYPES).size).toBe(SEALED_SUBTYPES.length);
  });

  it('sigue el orden canónico del contrato §4.34c (`sortOrder` upc=0 … collection=6)', () => {
    expect(SEALED_SUBTYPES).toEqual(['upc', 'etb', 'box', 'bundle', 'tin', 'blister', 'collection']);
  });

  it('cada subtipo tiene etiqueta en AMBOS locales (paridad es/en)', () => {
    const esKeys = new Set(keyPaths(es));
    const enKeys = new Set(keyPaths(en));
    for (const sub of SEALED_SUBTYPES) {
      const key = `status.sealedSubtype.${sub}`;
      expect(esKeys.has(key), `ES sin etiqueta para ${key}`).toBe(true);
      expect(enKeys.has(key), `EN sin etiqueta para ${key}`).toBe(true);
    }
  });

  it('ningún módulo declara una SEGUNDA lista literal de subtipos fuera de contract.ts', () => {
    // El bug fueron TRES arrays `const X: SealedSubtype[] = [...]` regados por el front. Este
    // test hace imposible reintroducirlos: la única declaración legítima es la del contrato
    // (que además NO matchea este patrón, porque es `as const` y la unión se deriva de ella).
    const offenders = sourceFiles(join(__dirname, '..'))
      .filter((f) => !f.endsWith('sealed-subtype.test.ts'))
      .filter((f) => /:\s*SealedSubtype\[\]\s*=|Array<SealedSubtype>\s*=/.test(readFileSync(f, 'utf8')))
      .map((f) => f.replace(join(__dirname, '..'), 'src'));
    expect(offenders, `listas duplicadas de SealedSubtype en: ${offenders.join(', ')}`).toEqual([]);
  });
});
