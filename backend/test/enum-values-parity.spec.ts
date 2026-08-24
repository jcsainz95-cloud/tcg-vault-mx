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
  SEALED_CONDITION_VALUES,
  SEALED_SUBTYPE_VALUES,
} from '../src/common/enum-values';
// v2.1.9 (D4): `RawCondition` es CLASE R — ya NO se deriva. Vive literal en `business-rules.ts`.
import { ACCEPTED_RAW_CONDITIONS } from '../src/common/business-rules';

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

/**
 * v2.1.9 (S49-P4, seguridad) — **el ANCLA. Sin esto la paridad era una tautología.**
 *
 * La versión anterior afirmaba `Object.values(prismaEnum) === Object.values(prismaEnum)`: `derived`
 * ES el `Object.values` del mismo enum, así que el test **no podía fallar**. Un valor nuevo en
 * cualquier enum del schema pasaba en VERDE y quedaba **auto-aceptado en la API** — el `@IsIn` se
 * ensanchaba solo, el filtro público empezaba a admitirlo y ningún test lo notaba. El único ancla
 * real era el `toHaveLength(7)` de `SealedSubtype`, y era accidental (se escribió para fijar ESE bug).
 *
 * Aquí va la lista ESPERADA de cada enum, escrita a mano. Añadir un valor al schema **rompe este
 * archivo a propósito**, y quien lo arregle tiene que decidir —conscientemente— tres cosas que el
 * espejo automático decidía por él:
 *   1. ¿el valor nuevo debe aceptarse en los `@IsIn` públicos?
 *   2. ¿hay reglas de negocio con listas propias que NO son el enum completo? (ver `UserStatus` y
 *      `ACCEPTED_RAW_CONDITIONS` — decisiones de producto, no espejos del schema);
 *   3. ¿hay pricing / filtros / spreads que necesiten calibración para el valor nuevo?
 *
 * Es el mismo criterio que ya rige en `enum-values.ts`: derivar es correcto **mientras** alguien
 * confirme que el enum completo ES la regla. Este test es el sitio donde se confirma.
 */
const EXPECTED_ENUM_VALUES: Record<string, readonly string[]> = {
  SealedSubtype: ['blister', 'box', 'bundle', 'collection', 'etb', 'tin', 'upc'],
  SealedCondition: ['minor_box_damage', 'mint'],
  Finish: ['first_edition_holofoil', 'holofoil', 'normal', 'reverse_holo'],
  ProductType: ['graded', 'raw', 'sealed'],
  GradingCompany: ['CGC', 'PSA'],
  AcquisitionType: ['aportacion_en_especie', 'buylist', 'compra'],
  Locale: ['en', 'es'],
};

/** Los enums de Prisma de clase E, por nombre (para el `it.each` de tres bandas). */
const PRISMA_ENUMS: Record<string, Record<string, string>> = {
  SealedSubtype,
  SealedCondition,
  Finish,
  ProductType,
  GradingCompany,
  AcquisitionType,
  Locale,
};

/** Las listas DERIVADAS que consume `src/`, por nombre. */
const DERIVED_VALUES: Record<string, readonly string[]> = {
  SealedSubtype: SEALED_SUBTYPE_VALUES,
  SealedCondition: SEALED_CONDITION_VALUES,
  Finish: FINISH_VALUES,
  ProductType: PRODUCT_TYPE_VALUES,
  GradingCompany: GRADING_COMPANY_VALUES,
  AcquisitionType: ACQUISITION_TYPE_VALUES,
  Locale: LOCALE_VALUES,
};

describe('CLASE E — paridad a TRES BANDAS: schema.prisma ⇄ enum-values.ts ⇄ contrato', () => {
  /**
   * v2.1.9 (D4) — **la tercera banda es la que fallaba.**
   *
   * La versión anterior comparaba `Object.values(e)` contra `Object.values(e)`: una tautología que
   * **no podía fallar**. Pero aunque hubiera comparado bien dos bandas, habría seguido sin ver el
   * fallo REAL que ocurrió DOS veces: `PriceSource` sin `tcgcsv_singles` y `SealedSubtype` sin
   * `upc`/`collection` — en ambos casos la **línea canónica del contrato** era la desfasada, y nadie
   * la comparaba con nada. El contrato manda sobre el código (CLAUDE.md), así que una discrepancia
   * ahí no es cosmética: es la especificación diciendo una cosa y el sistema haciendo otra.
   */
  const CONTRACT = readFileSync(join(__dirname, '..', '..', 'docs', 'API_CONTRACT.md'), 'utf8');

  /** Lee la línea canónica `Nombre = a | b | c` del bloque «Enums (fuente de verdad)» del contrato. */
  function contractValues(name: string): string[] {
    const line = new RegExp(`^${name}\\s+=\\s+(.+)$`, 'm').exec(CONTRACT);
    if (!line) throw new Error(`El contrato no declara el enum ${name} en su línea canónica`);
    return line[1]
      .replace(/\/\/.*$/, '') // comentario de la misma línea
      .split('|')
      .map((v) => v.trim())
      .filter((v) => v.length > 0);
  }

  const NAMES = Object.keys(EXPECTED_ENUM_VALUES);

  it.each(NAMES)('%s · banda 1 — el enum de Prisma == el conjunto APROBADO (ancla humana)', (name) => {
    // Sin este ancla, «paridad» era `x === x`: un valor nuevo en el schema pasaba VERDE y quedaba
    // auto-aceptado en la API. Romper aquí es el punto: obliga a decidir.
    expect(Object.values(PRISMA_ENUMS[name]).sort()).toEqual([...EXPECTED_ENUM_VALUES[name]].sort());
  });

  it.each(NAMES)('%s · banda 2 — la lista derivada que consume `src/` == el enum', (name) => {
    expect([...DERIVED_VALUES[name]].sort()).toEqual(Object.values(PRISMA_ENUMS[name]).sort());
  });

  it.each(NAMES)('%s · banda 3 — la línea CANÓNICA del contrato == el enum', (name) => {
    expect(contractValues(name).sort()).toEqual(Object.values(PRISMA_ENUMS[name]).sort());
  });

  it('SealedSubtype trae los SIETE, incluidos `upc` y `collection` (el bug exacto)', () => {
    expect(SEALED_SUBTYPE_VALUES).toContain('upc');
    expect(SEALED_SUBTYPE_VALUES).toContain('collection');
    expect(SEALED_SUBTYPE_VALUES).toHaveLength(7);
  });

  it('el schema en DISCO es la fuente: se lee `schema.prisma` y se compara contra la lista', () => {
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

describe('CLASE R — `RawCondition` expresa una REGLA, no el schema (D4, §4.37)', () => {
  /**
   * v2.1.9 (D4) — `RawCondition` se reclasifica de E a R y **sale de `enum-values.ts`**.
   *
   * La pregunta que decide la clase: *si mañana el schema gana `LP`, ¿el alta de inventario y el
   * cotizador deben aceptarlo **solos**?* La respuesta es **no**: `PROJECT.md` §H (LOCKED) dice que
   * «el raw se opera ÚNICAMENTE en NM» y §E que «si al recibir/verificar no está en NM, no se
   * compra». Derivar la lista del enum BORRARÍA esa regla el día que el enum crezca — y en las dos
   * puntas de dinero a la vez (se publicarían cartas no-NM y se cotizarían para compra).
   *
   * Los dos tests que el contrato exige para una clase R: **lista exacta** y **subconjunto** del enum.
   */
  it('lista EXACTA: el marketplace acepta `NM` y nada más (PROJECT §H)', () => {
    expect([...ACCEPTED_RAW_CONDITIONS]).toEqual(['NM']);
  });

  it('SUBCONJUNTO del enum de Prisma: la regla no puede aceptar algo que la BD no sabe guardar', () => {
    const schemaValues = Object.values(RawCondition) as string[];
    for (const accepted of ACCEPTED_RAW_CONDITIONS) {
      expect(schemaValues).toContain(accepted);
    }
    // Y es un subconjunto PROPIO o igual: nunca más ancho que el schema.
    expect(ACCEPTED_RAW_CONDITIONS.length).toBeLessThanOrEqual(schemaValues.length);
  });

  it('`enum-values.ts` ya NO exporta `RAW_CONDITION_VALUES` (no se puede derivar por accidente)', () => {
    const src = readFileSync(join(__dirname, '..', 'src', 'common', 'enum-values.ts'), 'utf8');
    expect(src).not.toMatch(/export const RAW_CONDITION_VALUES/);
  });

  it('ningún `@IsIn` de `src/` deriva la condición del enum de Prisma', () => {
    const SRC = join(__dirname, '..', 'src');
    const walkAll = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const full = join(dir, e.name);
        if (e.isDirectory()) return walkAll(full);
        return e.isFile() && e.name.endsWith('.ts') ? [full] : [];
      });
    const offenders = walkAll(SRC).filter((f) => {
      if (f.endsWith(join('common', 'business-rules.ts'))) return false; // ahí VIVE la regla
      if (f.endsWith(join('common', 'enum-values.ts'))) return false; // ahí vive el porqué (comentario)
      return /Object\.values\(RawCondition\)|RAW_CONDITION_VALUES/.test(readFileSync(f, 'utf8'));
    });
    expect(offenders.map((f) => f.replace(SRC, 'src'))).toEqual([]);
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
