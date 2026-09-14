/**
 * # codigo-de-fichero.spec.ts — ⭐⭐ **EL CANARIO DEL INSTRUMENTO QUE USAN LOS OTROS OCHO CANDADOS**
 *
 * `codigoDeFichero` es ahora la única puerta por la que los candados de `backend/test` leen código.
 * Un instrumento compartido sin canario es **un único punto de ceguera para todos a la vez**, que es
 * exactamente lo que este pase vino a corregir: la v2 de `stripComments` arregló el helper y **no la
 * clase**, porque once sitios llevaban su propia copia de la v1.
 *
 * Lo que se demuestra aquí, y ninguna es una afirmación de prosa:
 *  1. el algoritmo **v1 se queda ciego** ante una apertura de bloque dentro de un comentario de
 *     línea o de una cadena — con el mismo texto, la v2 no;
 *  2. el control de no-vacuidad **por ANCLA** detecta la ceguera **PARCIAL** (la que ocurre);
 *  3. un control de «no está vacío» **NO la detecta** — se escribe aquí el contraejemplo, porque es
 *     el control que ya existía en otro candado de este repo y que no vio el fallo;
 *  4. la **cota independiente** muerde donde el ancla podría no llegar, y ninguna de las dos sobra.
 */
import {
  anclasEstructurales,
  codigoDeTexto,
  comprobarNoVacuidad,
  cotaDeCodigo,
} from './helpers/codigo-de-fichero';
import { stripComments } from './helpers/strip-comments';

/** El algoritmo v1, verbatim, tal como vivía copiado en once sitios. */
const v1 = (s: string) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('//'))
    .join('\n');

/**
 * Fuente sintética con el defecto REAL: un comentario de línea que contiene la apertura de bloque
 * (el caso medido en `pricing.controller.ts:336`, `/admin/*`) y un cierre más abajo. Entre los dos
 * hay **código que importa**.
 */
const CON_APERTURA_FANTASMA = [
  "import { Injectable } from '@nestjs/common';",
  '',
  'export class Tarifas {',
  '  // el dial viaja solo en /admin/* y no sale a superficie de cliente',
  '  private readonly secreto = process.env.DIAL_SECRETO;',
  '  aplicar(pct: number) {',
  '    return pct * 2;',
  '  }',
  '  /** un docblock cualquiera, cuyo cierre termina el bloque fantasma */',
  '  publicar() {',
  '    return this.secreto;',
  '  }',
  '}',
].join('\n');

describe('⭐⭐ (1) la v1 se queda CIEGA y la v2 no — con el mismo texto', () => {
  it('⛔ la v1 se come la línea del secreto y el método `aplicar`', () => {
    const ciego = v1(CON_APERTURA_FANTASMA);
    expect(ciego).not.toContain('DIAL_SECRETO');
    expect(ciego).not.toContain('aplicar(pct: number)');
  });

  it('⭐ la v2 los conserva (y quita el comentario, que es lo que se le pedía)', () => {
    const limpio = stripComments(CON_APERTURA_FANTASMA);
    expect(limpio).toContain('DIAL_SECRETO');
    expect(limpio).toContain('aplicar(pct: number)');
    expect(limpio).not.toContain('el dial viaja solo en');
    expect(limpio).not.toContain('docblock cualquiera');
  });

  it('⭐ y también con la apertura dentro de una CADENA (el caso de `mail-shell.ts`)', () => {
    const fuente = ["export const CSS = 'td /* ojo */ { color: red }';", "export const FIN = 1;"].join(
      '\n',
    );
    // La v1 se come el interior de la cadena y deja el literal MUTILADO; la v2 respeta las cadenas.
    expect(v1(fuente)).not.toContain('ojo');
    expect(v1(fuente)).toContain("'td  { color: red }'");
    expect(stripComments(fuente)).toContain("'td /* ojo */ { color: red }'");
  });
});

describe('⭐⭐ (2)(3) el control por ANCLA ve la ceguera PARCIAL; «no está vacío» NO', () => {
  it('⛔ `codigoDeTexto` REVIENTA si el ancla desapareció del texto limpio', () => {
    // Se simula un limpiador estropeado pasando a la comprobación un texto ya mutilado: el ancla
    // `aplicar(` vivía en la región que se perdió.
    // ⛔ Se le inyecta un limpiador ROTO (la v1) a la comprobación: es la única forma de ver el
    // control morder, porque el limpiador de verdad (v2) ya no se equivoca.
    expect(() =>
      comprobarNoVacuidad(CON_APERTURA_FANTASMA, v1(CON_APERTURA_FANTASMA), 'sintetico', [
        'aplicar(pct: number)',
      ]),
    ).toThrow(/anclas ausentes/);
  });

  it('⭐ y NO revienta con el texto sano: el candado no se pone rojo por existir', () => {
    expect(() =>
      codigoDeTexto(CON_APERTURA_FANTASMA, 'sintetico', ['aplicar(pct: number)']),
    ).not.toThrow();
  });

  /**
   * ⭐⭐⭐ **EL CONTRAEJEMPLO QUE JUSTIFICA TODO EL FICHERO.**
   * `PendingsBell.test.tsx:140` **ya tenía** un control de no-vacuidad, y su autor conocía el modo de
   * fallo: blindó *«el fichero quedó vacío»*. **El que ocurre de verdad es el PARCIAL**, y aquí se
   * demuestra que ese control lo deja pasar: el texto mutilado **no está vacío**, tiene líneas, y
   * sigue conteniendo la clase. *Un candado puede estar ciego a trozos y pasar todos sus propios
   * controles.*
   */
  it('⛔⛔ un control de «no está vacío» PASA sobre el texto mutilado — por eso no basta', () => {
    const ciego = v1(CON_APERTURA_FANTASMA);
    expect(ciego.trim().length).toBeGreaterThan(0);
    expect(ciego.split('\n').filter((l) => l.trim() !== '').length).toBeGreaterThan(3);
    expect(ciego).toContain('export class Tarifas');
    // …y sin embargo le falta justo lo que el candado iba a mirar.
    expect(ciego).not.toContain('DIAL_SECRETO');
  });
});

describe('⭐ (4) la COTA independiente muerde, y no da rojos falsos', () => {
  it('⛔ revienta cuando el texto limpio conserva menos líneas que la cota del original', () => {
    // Región tragada GRANDE: la cota del original cuenta las 12 asignaciones; el texto mutilado no.
    const fuente = [
      'export const A = 0;',
      '// una nota con /* dentro',
      ...Array.from({ length: 12 }, (_, i) => `export const V${i} = ${i};`),
      '/** y el cierre que remata el bloque fantasma */',
      'export const Z = 99;',
    ].join('\n');
    expect(() =>
      // Ancla presente a propósito: lo que dispara aquí es **solo** la cota.
      comprobarNoVacuidad(fuente, v1(fuente), 'sintetico', ['export const A']),
    ).toThrow(/líneas vivas tras limpiar/);
  });

  it('la cota cuenta líneas que NO parecen comentario (es un conteo por otra vía)', () => {
    expect(cotaDeCodigo(CON_APERTURA_FANTASMA)).toBeGreaterThan(5);
    expect(cotaDeCodigo(['/**', ' * solo prosa', ' */', '// y una cola'].join('\n'))).toBe(0);
  });
});

describe('⭐ anclas estructurales — por las DOS puntas, no por una', () => {
  it('devuelve la PRIMERA y la ÚLTIMA declaración de primer nivel', () => {
    const fuente = ['export const A = 1;', 'function medio() {}', 'export class Z {}'].join('\n');
    expect(anclasEstructurales(fuente, 'x')).toEqual(['export const A', 'export class Z']);
  });

  it('⭐ y por eso ve un bloque fantasma que se abre a MITAD del fichero', () => {
    // El bloque fantasma se abre a mitad y **no cierra hasta el final**: se lleva por delante todo
    // lo que hay detrás, incluida la última declaración. Un ancla del principio no se entera.
    const fuente = [
      'export const A = 1;',
      '// nota con /* dentro',
      'export class Z {}',
      'const cola = 1;',
      '/** el cierre llega al final del fichero */',
    ].join('\n');
    const anclas = anclasEstructurales(fuente, 'x');
    expect(anclas).toEqual(['export const A', 'const cola']);
    expect(v1(fuente)).toContain(anclas[0]);
    // ⛔ Ésta es la que delata la ceguera PARCIAL, y es la razón de anclar por las dos puntas.
    expect(v1(fuente)).not.toContain(anclas[1]);
  });

  it('cae a `describe(` en un spec sin declaraciones, y si no hay nada REVIENTA', () => {
    expect(anclasEstructurales("describe('a', () => {});", 'x')).toEqual(['describe(']);
    expect(() => anclasEstructurales('1 + 1;', 'x')).toThrow(/sin ancla/);
  });
});
