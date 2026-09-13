/**
 * enum-parity-lock-canary.spec.ts — **el canario del candado que vigilaba PROSA.**
 *
 * ### Qué arregla, y por qué hace falta un canario y no solo un arreglo
 * `enum-values-parity.spec.ts` tiene un candado que exige que **ningún `@IsIn` de `src/` derive la
 * condición raw del enum de Prisma** (clase R: «raw = solo NM» es `PROJECT.md` §H, no el schema).
 * Corría su regex sobre el **fichero entero**, así que un **comentario** lo disparaba — y el síntoma
 * eran dos exenciones por nombre de fichero creciéndole al lado. techlead lo nombró exacto: *«el
 * síntoma de un candado que vigila prosa: cada fichero que quiera explicar la regla tiene que pedirle
 * permiso al test»*.
 *
 * ⚠️ **Lo caro de eso no es el falso rojo: es lo que ENTRENA.** Un candado que se rodea reescribiendo
 * un comentario enseña que la salida es cambiar la prosa. Al que le toca, o no documenta la regla, o
 * pide entrar en la lista blanca — y la lista blanca exime el **fichero entero**, con lo que el
 * candado se queda ciego justo en los dos ficheros donde la regla vive.
 *
 * ### Por qué el arreglo necesita canario
 * El arreglo (`stripComments`) mueve el candado de «mirar texto» a «mirar código», y **esa clase de
 * cambio puede desactivarlo sin que nada suene**: un stripper demasiado agresivo se come el código de
 * verdad y el candado pasa a estar siempre verde. Un candado siempre verde es indistinguible de uno
 * que funciona **hasta el día que se le necesita**. Así que se prueban las DOS mitades:
 *
 *  1. ⭐ **Sigue mordiendo el caso REAL** — un `@IsIn` que derive la condición del enum, en código.
 *  2. ⭐ **Ya NO muerde un comentario** que mencione exactamente lo mismo, en sus tres formas
 *     (`//`, bloque, y JSDoc multilínea, que es donde vive la prosa larga de este repo).
 *
 * ### ⛔ El canario NO toca el árbol vivo
 * Trabaja sobre **cadenas sintéticas**, no sobre ficheros del repo. Un canario que muta `src/` de
 * verdad es un canario que puede dejar el árbol sucio si se cae a mitad — y este proyecto ya pagó una
 * corrida de mutación sobre un árbol destruido (O-8).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './helpers/strip-comments';

/**
 * **La MISMA regex que usa el candado.** Está duplicada a propósito y con su propio guardián abajo:
 * un canario que importa el detector del candado no puede detectar que el detector se rompió, porque
 * comparte el defecto. Lo que impide que las dos copias diverjan es el test
 * «la regex del canario es LITERALMENTE la del candado», que lee el fichero del candado.
 */
const LOCK_RE = /Object\.values\(RawCondition\)|RAW_CONDITION_VALUES/;

/** Lo que hace el candado con el contenido de un fichero, reducido a una función. */
const lockBites = (fileContents: string): boolean => LOCK_RE.test(stripComments(fileContents));

describe('canario · el candado de `RawCondition` mira CÓDIGO (y sigue mordiendo)', () => {
  describe('⭐ mitad 1 — SIGUE MORDIENDO el defecto real', () => {
    /**
     * El defecto exacto que la clase R prohíbe: derivar del enum de Prisma la lista que expresa una
     * REGLA de `PROJECT.md`. Si el schema gana `LP`, esto lo aceptaría **el mismo día**, en las dos
     * puntas de dinero (publicar y cotizar), sin que nadie lo decidiera.
     */
    it('un `@IsIn` que deriva la condición del enum ⇒ ROJO', () => {
      expect(
        lockBites(`
          import { RawCondition } from '@prisma/client';
          export class CreateItemDto {
            @IsIn(Object.values(RawCondition))
            rawCondition!: string;
          }
        `),
      ).toBe(true);
    });

    it('la constante derivada reintroducida en `enum-values.ts` ⇒ ROJO', () => {
      expect(lockBites(`export const RAW_CONDITION_VALUES = Object.values(RawCondition);`)).toBe(true);
    });

    it('⭐ código DESPUÉS de un bloque de prosa largo ⇒ ROJO (el stripper no se come el código)', () => {
      expect(
        lockBites(`
          /**
           * Un docstring larguísimo, con /* pseudo-anidado en texto y mucha prosa,
           * varias líneas, y menciones a la regla.
           */
          @IsIn(RAW_CONDITION_VALUES)
          condition!: string;
        `),
      ).toBe(true);
    });

    it('⭐ código en la MISMA línea que un comentario de bloque cerrado ⇒ ROJO', () => {
      expect(lockBites(`/* nota */ const x = RAW_CONDITION_VALUES;`)).toBe(true);
    });
  });

  describe('⭐ mitad 2 — YA NO muerde la PROSA (lo que obligaba a la lista blanca)', () => {
    it('comentario de línea (`//`) ⇒ VERDE', () => {
      expect(lockBites(`// ⚠️ NO la sustituyas por RAW_CONDITION_VALUES.`)).toBe(false);
    });

    it('comentario de bloque de una línea ⇒ VERDE', () => {
      expect(lockBites(`/* antes esto era Object.values(RawCondition) */`)).toBe(false);
    });

    it('⭐ JSDoc multilínea ⇒ VERDE (es la forma REAL del caso que disparaba el candado)', () => {
      expect(
        lockBites(`
          /**
           * En v2.1.8 se derivó RAW_CONDITION_VALUES y se metió en cuatro \`@IsIn\`.
           * Daba el mismo resultado —\`enum RawCondition { NM }\` tiene un solo valor—
           * pero por accidente: usar Object.values(RawCondition) BORRARÍA la regla.
           */
          export const ACCEPTED_RAW_CONDITIONS: readonly RawCondition[] = ['NM'];
        `),
      ).toBe(false);
    });

    /**
     * ⭐⭐ **La prueba que cierra el círculo: los dos ficheros de la lista blanca, TAL CUAL están en el
     * árbol, ya no disparan el candado.** No es un fixture sintético — son los ficheros reales. Si
     * alguien mete de verdad el patrón en código en cualquiera de los dos, esto se pone rojo, que es
     * justo lo que la lista blanca (que eximía el fichero **entero**) no podía hacer.
     */
    it.each([
      ['src/common/business-rules.ts', join(__dirname, '..', 'src', 'common', 'business-rules.ts')],
      ['src/common/enum-values.ts', join(__dirname, '..', 'src', 'common', 'enum-values.ts')],
    ])('%s — exento antes por NOMBRE, hoy limpio por CONTENIDO ⇒ VERDE', (_label, path) => {
      const raw = readFileSync(path, 'utf8');
      // Premisa: el fichero SÍ menciona el patrón (si no, el test no probaría nada).
      expect(LOCK_RE.test(raw)).toBe(true);
      // Y aun así el candado no muerde, porque las menciones son PROSA.
      expect(lockBites(raw)).toBe(false);
    });
  });

  /**
   * El canario duplica la regex del candado (ver el comentario de `LOCK_RE`). Esto impide que las dos
   * copias diverjan en silencio: si alguien cambia la del candado, este test se pone rojo y le obliga
   * a mirar si el canario sigue midiendo lo que cree.
   */
  it('⛔ la regex del canario es LITERALMENTE la del candado (no pueden divergir)', () => {
    const lockSrc = readFileSync(join(__dirname, 'enum-values-parity.spec.ts'), 'utf8');
    expect(stripComments(lockSrc)).toContain(LOCK_RE.source);
  });

  /**
   * El arreglo de `H3-d` retiró las **dos** exenciones por nombre de fichero del candado (y una
   * tercera del detector hermano). Esto impide que vuelvan por la puerta de atrás: la próxima vez que
   * alguien se tope con el candado, la salida tiene que ser mirar el código, no añadir un nombre.
   */
  it('⭐ el candado NO tiene lista blanca por nombre de fichero', () => {
    const lockSrc = stripComments(readFileSync(join(__dirname, 'enum-values-parity.spec.ts'), 'utf8'));
    expect(lockSrc).not.toMatch(/business-rules\.ts'\)\)\)\s*return false/);
    expect(lockSrc).not.toMatch(/endsWith\(join\('common', 'enum-values\.ts'\)\)\)\s*return false/);
    expect(lockSrc).not.toMatch(/endsWith\(join\('common', 'enum-values\.ts'\)\)\)\s*continue/);
  });
});
