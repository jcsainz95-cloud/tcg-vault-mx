import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  AcquisitionType,
  Finish,
  GradingCompany,
  Locale,
  ProductType,
  RawCondition,
  SealedCondition,
  SealedSubtype,
} from '@prisma/client';
import {
  ACQUISITION_TYPE_VALUES,
  FINISH_VALUES,
  GRADING_COMPANY_VALUES,
  LOCALE_VALUES,
  PRODUCT_TYPE_VALUES,
  RAW_CONDITION_VALUES,
  SEALED_CONDITION_VALUES,
  SEALED_SUBTYPE_VALUES,
} from '../src/common/enum-values';

/**
 * v2.1.8 — **un enum se declara UNA vez, y su declaración espeja el schema.**
 *
 * ### El bug que lo motivó
 * `SealedSubtype` tiene **siete** valores; había **ocho listas de cinco a mano** y `upc`/`collection`
 * quedaron fuera de todas. El dueño **sí vende UPC** y no podía: no se podía capturar la pieza, no se
 * podía filtrar en la tienda, el filtro de la bóveda **mentía en silencio**, y el spread salía siempre
 * al fallback del 25 % porque `PUT /admin/pricing/sealed-spreads` devolvía 422 para `upc`.
 *
 * ### Qué vigila este archivo, y por qué así
 * Añadir dos strings a ocho listas habría cerrado **ese** bug dejando la **clase** abierta. Estos
 * tests cierran la clase en dos direcciones:
 *
 *  1. **Paridad**: cada lista derivada == los valores del enum de Prisma. Si mañana alguien añade un
 *     octavo subtipo al schema y no regenera, esto falla.
 *  2. **Residuo**: **ninguna lista literal** de esos valores sobrevive en `src/`. Sin esto, la paridad
 *     pasaría verde mientras un `@IsIn(['box', ...])` olvidado sigue rechazando al cliente — que es
 *     exactamente la situación que había.
 *
 * Es la misma doctrina del candado de arquitectura del eje de venta y de `DisplayBp`: convertir una
 * disciplina en algo que sostiene la máquina.
 */

describe('paridad — cada lista derivada espeja su enum del schema', () => {
  it.each([
    ['SealedSubtype', SEALED_SUBTYPE_VALUES, SealedSubtype],
    ['SealedCondition', SEALED_CONDITION_VALUES, SealedCondition],
    ['Finish', FINISH_VALUES, Finish],
    ['ProductType', PRODUCT_TYPE_VALUES, ProductType],
    ['RawCondition', RAW_CONDITION_VALUES, RawCondition],
    ['GradingCompany', GRADING_COMPANY_VALUES, GradingCompany],
    ['AcquisitionType', ACQUISITION_TYPE_VALUES, AcquisitionType],
    ['Locale', LOCALE_VALUES, Locale],
  ])('%s: la lista == el enum, sin faltantes ni sobrantes', (_n, derived, prismaEnum) => {
    expect([...derived].sort()).toEqual(Object.values(prismaEnum).sort());
  });

  it('SealedSubtype trae los SIETE, incluidos `upc` y `collection` (el bug exacto)', () => {
    expect(SEALED_SUBTYPE_VALUES).toContain('upc');
    expect(SEALED_SUBTYPE_VALUES).toContain('collection');
    expect(SEALED_SUBTYPE_VALUES).toHaveLength(7);
  });

  it('el schema es la fuente: se lee `schema.prisma` y se compara contra la lista', () => {
    // Cierra el hueco de que Prisma Client esté REGENERADO pero desfasado del schema en disco.
    const schema = readFileSync(join(__dirname, '..', 'prisma', 'schema.prisma'), 'utf8');
    const block = /enum SealedSubtype \{([\s\S]*?)\}/.exec(schema)![1];
    const fromSchema = block
      .split('\n')
      .map((l) => l.replace(/\/\/.*$/, '').trim())
      .filter((l) => l.length > 0);
    expect(fromSchema.sort()).toEqual([...SEALED_SUBTYPE_VALUES].sort());
  });
});

describe('residuo — ninguna lista literal de estos enums sobrevive en `src/`', () => {
  const SRC = join(__dirname, '..', 'src');

  function walk(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = join(dir, e.name);
      if (e.isDirectory()) return walk(full);
      return e.isFile() && e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts') ? [full] : [];
    });
  }

  /**
   * Detecta un array/`IsIn`/`Set` literal que enumere ≥2 valores del enum. No basta con buscar `'upc'`:
   * lo que delata el patrón es **varios valores del mismo enum juntos**, que es una lista escrita a mano.
   */
  function offenders(values: readonly string[]): string[] {
    const hits: string[] = [];
    for (const f of walk(SRC)) {
      if (f.endsWith(join('common', 'enum-values.ts'))) continue; // ahí VIVE la declaración
      const src = readFileSync(f, 'utf8');
      for (const line of src.split('\n')) {
        const code = line.replace(/\/\/.*$/, '');
        if (!/\[|new Set/.test(code)) continue;
        const found = values.filter((v) => new RegExp(`['"\`]${v}['"\`]`).test(code));
        if (found.length >= 2) hits.push(`${f.replace(SRC, 'src')} :: ${line.trim().slice(0, 90)}`);
      }
    }
    return hits;
  }

  it('SealedSubtype: cero listas a mano (había OCHO)', () => {
    expect(offenders(SEALED_SUBTYPE_VALUES)).toEqual([]);
  });

  it('SealedCondition: cero listas a mano', () => {
    expect(offenders(SEALED_CONDITION_VALUES)).toEqual([]);
  });

  it('Finish, ProductType, GradingCompany y AcquisitionType: cero listas a mano', () => {
    expect(offenders(FINISH_VALUES)).toEqual([]);
    expect(offenders(PRODUCT_TYPE_VALUES)).toEqual([]);
    expect(offenders(GRADING_COMPANY_VALUES)).toEqual([]);
    expect(offenders(ACQUISITION_TYPE_VALUES)).toEqual([]);
  });
});
