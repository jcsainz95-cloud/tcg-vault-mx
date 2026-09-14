import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './helpers/strip-comments';

/**
 * ⭐⭐ **EL CANARIO DE `stripComments` — el instrumento del que cuelgan SIETE candados.**
 *
 * ### Por qué existe, y la fecha
 * `stripComments` lo usan `enum-values-parity`, `price-convention-writers` (`IVA-12`),
 * `query-axis-census`, `sell-request-states` y tres de los candados `IVA-*` nuevos. **Cuando un
 * instrumento se queda ciego, sus candados no fallan: pasan.** Ése es el peor de los verdes, y es
 * exactamente lo que ocurrió el **2026-09-14**.
 *
 * ### ⚠️⚠️ EL DEFECTO MEDIDO QUE ESTE FICHERO EXISTE PARA QUE NO VUELVA
 * La v1 quitaba **primero** los bloques (regex global) y **después** las colas de línea. Con eso, una
 * **línea** de comentario que contuviera la secuencia de apertura de bloque —como
 * `// … viaja solo en /admin/*`, que vive en **cinco** ficheros de `src/`— **abría un bloque** que se
 * comía el fichero hasta el siguiente cierre.
 *
 * **Lo que costó, medido:** en `guest-checkout.service.ts` se tragó **la escritura de la columna
 * `ivaTransferPct`** (una columna de dinero), y el censo del criterio **209** reportó que ese fichero
 * *«no la emite»*. **Verde, sobre código que sí estaba ahí.** Lo destapó una prueba nueva al esperar
 * un fichero en un conjunto exacto y no encontrarlo — ⛔ no un rojo del candado que se apoyaba en él.
 *
 * *Un candado cuyo instrumento puede quedarse ciego necesita una prueba del instrumento, no del
 * candado.*
 */

describe('⭐⭐ `stripComments` — quita comentarios y ⛔ NO se traga el código', () => {
  it('⭐⭐ EL DEFECTO DE LA v1: una línea `//` con la apertura de bloque ⛔ no abre nada', () => {
    const fuente = ['// el dial viaja solo en /admin/*', 'const importante = 1;', 'const otro = 2;'].join('\n');
    const out = stripComments(fuente);
    expect(out).toContain('const importante = 1;');
    expect(out).toContain('const otro = 2;');
    // Con la v1, `out` habría perdido TODO lo que hubiera hasta el siguiente cierre de bloque.
  });

  it('⭐⭐ …y el caso REAL que lo destapó: la columna `ivaTransferPct` se ve en `guest-checkout`', () => {
    // Éste es el fichero exacto donde el defecto mordió. Se asierta sobre el árbol de verdad, no
    // sobre fuente sintética: *una regresión del instrumento vuelve a taparlo aquí primero.*
    const src = stripComments(
      readFileSync(join(__dirname, '..', 'src', 'modules', 'orders', 'guest-checkout.service.ts'), 'utf8'),
    );
    expect(src).toMatch(/ivaTransferPct: ivaDials\.ivaTransferPct/);
    expect(src).toContain('priceConvention: PRICE_CONVENTION_OF_NEW_ROWS');
  });

  it('⭐ y los otros CUATRO ficheros con el mismo patrón siguen enteros', () => {
    // `uploads.service.ts` (`image/*`), `pricing.controller.ts` y `error-codes.ts` (`/admin/*`,
    // `/checkout/guest/*`). Se comprueba que después del comentario venenoso sigue habiendo código.
    const casos: [string[], string][] = [
      [['modules', 'uploads', 'uploads.service.ts'], 'export'],
      [['modules', 'pricing', 'pricing.controller.ts'], 'export class'],
      [['common', 'error-codes.ts'], 'export'],
    ];
    for (const [ruta, esperado] of casos) {
      const src = stripComments(readFileSync(join(__dirname, '..', 'src', ...ruta), 'utf8'));
      expect(src).toContain(esperado);
      // Control fuerte: el resultado conserva código de verdad, ⛔ no un muñón. ⚠️ La cota se pone
      // en caracteres absolutos y no en fracción del original: estos ficheros son **mayoría prosa**
      // (`error-codes.ts` documenta cada código), así que una fracción mediría el estilo del repo.
      expect(src.replace(/\s/g, '').length).toBeGreaterThan(2_000);
    }
  });

  it('⭐ un bloque que CONTIENE `//` sigue siendo un bloque (la razón por la que la v1 iba así)', () => {
    const out = stripComments('/* mira: http://ejemplo // dentro */\nconst z = 3;');
    expect(out).toContain('const z = 3;');
    expect(out).not.toContain('ejemplo');
  });

  it('⛔ los comentarios SÍ se van: el candado sigue mirando código y no prosa', () => {
    expect(stripComments('// RAW_CONDITION_VALUES aquí\nconst x = 1;')).not.toContain('RAW_CONDITION_VALUES');
    expect(stripComments('/* RAW_CONDITION_VALUES */\nconst x = 1;')).not.toContain('RAW_CONDITION_VALUES');
    expect(stripComments('const x = 1; // cola')).toBe('const x = 1; ');
  });

  it('⭐ las CADENAS se conservan (un literal en código es código, no prosa)', () => {
    expect(stripComments('const u = "https://x//y"; // cola')).toContain('"https://x//y"');
    expect(stripComments("const p = 'IVA_EXCLUSIVE'; // nota")).toContain("'IVA_EXCLUSIVE'");
    expect(stripComments('const t = `a/*b*/c`;')).toContain('`a/*b*/c`');
  });

  it('⭐ y el escape dentro de una cadena no la cierra antes de tiempo', () => {
    expect(stripComments('const s = "a\\"// b"; const y = 2;')).toContain('const y = 2;');
  });

  it('⭐ los SALTOS DE LÍNEA se preservan: los números de línea siguen cuadrando', () => {
    const fuente = ['const a = 1;', '/* uno', '   dos', '   tres */', 'const b = 2;'].join('\n');
    const out = stripComments(fuente);
    expect(out.split('\n')).toHaveLength(5);
    expect(out.split('\n')[4]).toBe('const b = 2;');
  });

  it('⚠️ SU LÍMITE, asertado en vez de escondido: no distingue una regex de una división', () => {
    // Se declara el límite con una prueba para que quien lo tope lo lea aquí y no lo descubra en un
    // candado. ⛔ Si algún día hace falta, la salida es un parser, no ensanchar una lista blanca.
    const out = stripComments('const re = /a\\/\\/b/;\nconst v = 9;');
    // El comportamiento exacto no se promete; lo que se promete es que NO se traga el fichero.
    expect(out).toContain('const v = 9;');
  });
});
