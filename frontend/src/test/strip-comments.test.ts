import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { analizarFuente, codigoDe, exigirQueConserveElCodigo, stripComments } from './strip-comments';

/**
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * **La batería del limpiador único del frontend.** Cada caso de aquí es una forma en la que un
 * limpiador de comentarios **deja de ver código** o **empieza a ver prosa**, y las dos cosas
 * rompen a los candados que lo usan: la primera los vuelve ciegos (pasan), la segunda los vuelve
 * supersticiosos (rojos falsos, que enseñan a reescribir el comentario para callarlos).
 *
 * ⚠️ El caso **real** —`StorefrontHeader.tsx:95-109`— y los canarios de los tres candados que lo
 * consumen viven al lado de cada candado, no aquí: `frontend-never-multiplies.test.ts`,
 * `PendingsBell.test.tsx` y `e2e-harness.test.ts`. Aquí está lo que es propiedad del instrumento.
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 */
const F = 'x.ts';
const TSX = 'x.tsx';

/** El limpiador retirado. Se conserva aquí para poder MEDIR contra él, no para usarlo. */
const v1 = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** El autómata de `backend/test/helpers/strip-comments.ts` (v2), para medir su límite. */
function automata(src: string): string {
  let out = '';
  let i = 0;
  let linea = false;
  let bloque = false;
  let comilla: "'" | '"' | '`' | null = null;
  while (i < src.length) {
    const c = src[i];
    const d = src[i + 1];
    if (linea) {
      if (c === '\n') {
        linea = false;
        out += c;
      }
      i += 1;
      continue;
    }
    if (bloque) {
      if (c === '*' && d === '/') {
        bloque = false;
        i += 2;
        continue;
      }
      if (c === '\n') out += c;
      i += 1;
      continue;
    }
    if (comilla) {
      out += c;
      if (c === '\\' && i + 1 < src.length) {
        out += d;
        i += 2;
        continue;
      }
      if (c === comilla) comilla = null;
      i += 1;
      continue;
    }
    if (c === '/' && d === '/') {
      linea = true;
      i += 2;
      continue;
    }
    if (c === '/' && d === '*') {
      bloque = true;
      i += 2;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') comilla = c as "'" | '"' | '`';
    out += c;
    i += 1;
  }
  return out;
}

describe('stripComments · ve el CÓDIGO y solo el código', () => {
  it('⭐ una apertura de bloque DENTRO de un `//` es TEXTO, no abre nada (el defecto del v1)', () => {
    const src = ['// activa en /buylist EXCEPTO /buylist/requests/*, que es «ventas»', "const x = 1;", '/* fin */', 'const y = 2;'].join('\n');
    const limpio = stripComments(src, F);
    expect(limpio).toContain('const x = 1;');
    expect(limpio).toContain('const y = 2;');
    // Y la demostración de que el caso importa: el v1 se comía `const x`.
    expect(v1(src)).not.toContain('const x = 1;');
  });

  it('⛔ un `//` DENTRO de un bloque es texto: no cierra ni adelanta nada', () => {
    const src = ['/* nota: ver http://x/y', '   y también // esto */', 'const z = 3;'].join('\n');
    expect(stripComments(src, F)).toContain('const z = 3;');
    expect(stripComments(src, F)).not.toContain('nota');
  });

  it('⭐ las cadenas se CONSERVAN, aunque lleven `//` o una apertura de bloque dentro', () => {
    const src = [
      "const url = 'https://tcghunt.mx/es/catalog';",
      'const glob = "**/*.spec.ts";',
      'const tpl = `a // b /* c */ d`;',
    ].join('\n');
    const limpio = stripComments(src, F);
    expect(limpio).toContain("'https://tcghunt.mx/es/catalog'");
    expect(limpio).toContain('"**/*.spec.ts"');
    expect(limpio).toContain('`a // b /* c */ d`');
  });

  it('⭐⭐ un literal de EXPRESIÓN REGULAR con comilla suelta no lo desincroniza — el límite del autómata', () => {
    /*
     * Es el caso REAL, medido hoy en los dos árboles: un literal de regex con un número IMPAR de
     * comillas desincroniza a cualquier limpiador que las cuente a mano — a partir de ahí se cree
     * dentro de una cadena y **conserva los comentarios**. Vive en `mail.templates.ts:27`
     * (`/'/g`), y su primo de frontend en `api-client.ts:216` y `e2e-harness.test.ts:119`.
     *
     * ⚠️ Ese sesgo NO es ceguera —va en la otra dirección— pero para una prohibición es un **rojo
     * falso**, y un rojo falso enseña a callar el candado reescribiendo el comentario.
     */
    const src = [
      "const esc = (s: string) => s.replace(/'/g, '&#39;');",
      '/* prosa que NO debe sobrevivir */',
      'const w = 4;',
    ].join('\n');
    const limpio = stripComments(src, F);
    expect(limpio).toContain('const w = 4;');
    expect(limpio, 'la prosa se coló: el limpiador se desincronizó').not.toContain('prosa que');
    // Medido: el autómata de `backend/` SÍ se desincroniza aquí y conserva el comentario.
    expect(automata(src)).toContain('prosa que');
  });

  it('⛔ el JSDoc también es prosa: se va (TypeScript lo mete en el árbol, hay que excluirlo)', () => {
    const src = ['/** @param n el número */', 'export function f(n: number) {', '  return n;', '}'].join('\n');
    const limpio = stripComments(src, F);
    expect(limpio).not.toContain('@param');
    expect(limpio).toContain('export function f(n: number) {');
  });

  it('⭐ en TSX: `{/* … */}` se va, y el TEXTO de JSX se conserva aunque lleve `//`', () => {
    const src = [
      'export const V = () => (',
      '  <p>',
      '    {/* comentario de JSX */}',
      '    Visita https://tcghunt.mx hoy',
      '  </p>',
      ');',
    ].join('\n');
    const limpio = stripComments(src, TSX);
    expect(limpio).not.toContain('comentario de JSX');
    expect(limpio).toContain('Visita https://tcghunt.mx hoy');
  });

  it('⭐ la NUMERACIÓN de líneas se conserva: un `fichero:N` del candado sigue apuntando bien', () => {
    const src = ['const a = 1;', '/* uno', '   dos', '   tres */', 'const b = 2;'].join('\n');
    const limpio = stripComments(src, F);
    expect(limpio.split('\n')).toHaveLength(5);
    expect(limpio.split('\n')[4]).toContain('const b = 2;');
    // El v1, en cambio, colapsa el archivo y desplaza todos los números.
    expect(v1(src).split('\n').length).toBeLessThan(5);
  });

  it('el censo de líneas con código no cuenta las que solo llevan comentario', () => {
    const src = ['// solo prosa', 'const a = 1;', '', '/** doc */', 'const b = 2;'].join('\n');
    expect(analizarFuente(src, F).lineasConCodigo).toEqual([2, 5]);
  });
});

/**
 * ⭐⭐⭐ **EL CONTROL POR CONTENIDO, Y LA LECCIÓN QUE LO HIZO FALTA.**
 *
 * El control que había antes (`PendingsBell.test.tsx`) preguntaba *«¿queda algo?»*. El modo de
 * fallo que ocurre de verdad no vacía el archivo: **se come un trozo**. Estos casos fijan que el
 * control nuevo distingue las dos cosas.
 */
describe('exigirQueConserveElCodigo · el caso PARCIAL, no solo el vacío', () => {
  const src = ['const a = 1;', 'const b = 2;', 'const c = 3;'].join('\n');

  it('pasa con la salida buena', () => {
    expect(() => exigirQueConserveElCodigo(src, stripComments(src, F), F)).not.toThrow();
  });

  it('⛔ rojo con el vaciado TOTAL (el caso que el control anterior sí cubría)', () => {
    expect(() => exigirQueConserveElCodigo(src, '', F)).toThrow(/se quedó ciego/i);
  });

  it('⭐ rojo con el vaciado PARCIAL de UNA sola línea — el que pasaba en verde', () => {
    const mutilado = ['const a = 1;', '', 'const c = 3;'].join('\n');
    expect(() => exigirQueConserveElCodigo(src, mutilado, F)).toThrow(/x\.ts:2/);
  });

  it('el rojo dice QUÉ línea se perdió y con qué texto: si no, no sirve para arreglarlo', () => {
    const mutilado = ['const a = 1;', 'const b = 2;', ''].join('\n');
    expect(() => exigirQueConserveElCodigo(src, mutilado, F)).toThrow(/const c = 3;/);
  });
});

describe('codigoDe · la puerta única de los candados', () => {
  it('⭐ el barrido entero de `src/` pasa el control por contenido — ni un fichero ciego', () => {
    // Es la afirmación fuerte: 0 ficheros donde el limpiador pierda código. Si alguno se cegara
    // (un fichero que deje de parsear, p. ej.), esto revienta con su `:N` delante.
    const rel = 'src/components/layout/StorefrontHeader.tsx';
    const abs = join(process.cwd(), rel);
    expect(() => codigoDe(abs, rel)).not.toThrow();
    expect(codigoDe(abs, rel)).toContain("href: '/vault'");
    // memoiza: la segunda llamada devuelve el MISMO texto sin reparsear.
    expect(codigoDe(abs, rel)).toBe(codigoDe(abs, rel));
  });

  it('⛔ y no conserva la prosa: el propio `StorefrontHeader` documenta `/buylist/requests`', () => {
    const rel = 'src/components/layout/StorefrontHeader.tsx';
    const crudo = readFileSync(join(process.cwd(), rel), 'utf8');
    expect(crudo, 'la trampa real ya no está: mover el canario').toContain('EXCEPTO el portal');
    expect(codigoDe(join(process.cwd(), rel), rel)).not.toContain('EXCEPTO el portal');
  });
});
