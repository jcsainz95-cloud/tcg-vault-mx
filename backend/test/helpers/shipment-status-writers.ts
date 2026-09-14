/**
 * shipment-status-writers.ts — ⭐⭐ **QUIÉN PUEDE MOVER EL `status` DE UN `ShipmentRequest`, MIRANDO
 * CÓDIGO.**
 *
 * ### Para qué existe (`REL-B`/`REL-C`, `API_CONTRACT §R.4.c` cláusula 3)
 * El contrato decide que `AV-5`/`AV-6` **NO estrenan columna de sello**, y esa decisión **descansa
 * sobre una premisa**, no sobre el CAS:
 *
 * > el CAS garantiza **un aviso por TRANSICIÓN**; «un aviso por **CICLO**» (criterio 205) solo se
 * > sigue de ahí **si el ciclo no se puede reabrir** — o sea, si el estado del envío **nunca
 * > retrocede**.
 *
 * Y esa premisa **era falsa cuando se escribió**: `setTracking` podía devolver un `enviado` a `guia`
 * (`REL-C`, medido **ROJO 10/10** con entrelazado forzado sobre `0e22415`) y el webhook de Stripe
 * podía devolverlo a `picking` (`payments.service.ts`, mismo patrón). Con el estado regresado, el
 * envío gana **otra** transición legítima a `enviado` ⇒ **segundo `AV-5`, con las dos peticiones
 * perfectamente serializadas y sin que nada parezca roto**.
 *
 * ⇒ Este censo vigila **la premisa**, no el síntoma. Si alguien vuelve a escribir el `status` de un
 * envío sin llevar la precondición al `WHERE`, esto se pone **rojo** — y el día que la premisa deje
 * de sostenerse, la decisión correcta pasa a ser la columna, que es una decisión del arquitecto.
 *
 * ### La regla, y por qué NO necesita lista blanca
 * Una lista blanca por nombre de fichero es *«el síntoma de un candado que vigila prosa»*
 * (techlead, `strip-comments.ts`): cada fichero que quiera escribir ahí tiene que pedirle permiso al
 * test. Aquí la exención la da **el propio código**, no un nombre:
 *
 * | El bloque `data` de la escritura… | Exigencia sobre el `where` | Clase |
 * |---|---|---|
 * | es un objeto literal **sin** `status` | ninguna — no puede mover el estado | `sin-status` |
 * | es un objeto literal **con** `status` | ⛔ **`status` en el `where`** | `guarded` / `unguarded` |
 * | es **opaco** (un identificador: `data`) | ⛔ **`status` en el `where`** (no se puede ver dentro) | `guarded` / `unguarded` |
 * | no se puede localizar `where` o `data` | — | `unclassified` |
 *
 * - **`unguarded` y `unclassified` cuentan como ROJO.** La tercera clase existe a propósito: *un
 *   candado que solo busca la forma que hoy conoce se rodea escribiendo la misma decisión de otra
 *   manera.* Si aparece una forma nueva, que la clasifique un humano y la escriba aquí.
 * - **Los `create` NO entran**, y la razón es de mecanismo, no de conveniencia: una fila que **nace**
 *   no puede *retroceder* un estado que aún no existía. La premisa que esto vigila es la monotonía
 *   de una fila viva.
 *
 * ### ⚠️ Su límite, dicho y no escondido
 * ⛔ **No es un parser de TypeScript.** Mira el fichero sin comentarios (`stripComments` v2 — ⛔ no la
 * regex de bloques de la v1, que se queda ciega a trozos) y recorta el argumento de la llamada
 * contando llaves/paréntesis, respetando cadenas. Un `where` construido en una variable aparte sale
 * como `unclassified`, que **también es rojo**. Lo que cierra el límite es el **canario**
 * (`shipments.state-monotonic-canary.spec.ts`), que reintroduce cada defecto y exige el rojo.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { stripComments } from './strip-comments';

export type StatusWriteKind = 'guarded' | 'unguarded' | 'sin-status' | 'unclassified';

export interface StatusWriteSite {
  /** Ruta relativa a `backend/`, p. ej. `src/modules/shipments/shipments.service.ts`. */
  readonly file: string;
  /** Línea (1-based) dentro del fichero ya sin comentarios (cuadra con el original: v2 conserva `\n`). */
  readonly line: number;
  /** `update` | `updateMany` | `upsert` — el verbo que puede pisar una fila viva. */
  readonly verb: string;
  readonly kind: StatusWriteKind;
  /** Llave estable para el informe: `src/…/x.ts:1282 updateMany`. */
  readonly key: string;
}

/** Verbos que escriben sobre una fila **que ya existe**. ⛔ `create` no: no puede retroceder nada. */
const VERBOS = ['update', 'updateMany', 'upsert'] as const;

/**
 * Recorta el texto entre el paréntesis de apertura en `open` y su pareja, contando llaves,
 * corchetes y paréntesis y **saltando cadenas**. Devuelve `null` si no cierra (fuente truncada).
 */
function argumento(src: string, open: number): string | null {
  let prof = 0;
  let comilla: string | null = null;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (comilla) {
      if (c === '\\') i += 1;
      else if (c === comilla) comilla = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      comilla = c;
      continue;
    }
    if (c === '(' || c === '{' || c === '[') prof += 1;
    else if (c === ')' || c === '}' || c === ']') {
      prof -= 1;
      if (prof === 0) return src.slice(open + 1, i);
    }
  }
  return null;
}

/**
 * Devuelve el valor de la propiedad `clave` en el **primer nivel** de un objeto literal, como texto.
 * `null` si no está. `'<opaco>'` si la propiedad viene en forma abreviada (`data` a secas) o su
 * valor es un identificador — el caso que **no se puede mirar por dentro** y por eso exige guarda.
 */
export function propiedadDePrimerNivel(cuerpo: string, clave: string): string | null {
  let prof = 0;
  let comilla: string | null = null;
  for (let i = 0; i < cuerpo.length; i++) {
    const c = cuerpo[i];
    if (comilla) {
      if (c === '\\') i += 1;
      else if (c === comilla) comilla = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      comilla = c;
      continue;
    }
    if (c === '{' || c === '[' || c === '(') {
      prof += 1;
      continue;
    }
    if (c === '}' || c === ']' || c === ')') {
      prof -= 1;
      continue;
    }
    if (prof !== 0) continue;
    if (!cuerpo.startsWith(clave, i)) continue;
    // Frontera de identificador: `data` no casa dentro de `metadata`.
    const antes = i === 0 ? '' : cuerpo[i - 1];
    if (/[A-Za-z0-9_$]/.test(antes)) continue;
    const resto = cuerpo.slice(i + clave.length);
    const m = /^\s*(:)?/.exec(resto);
    if (!m) continue;
    if (!m[1]) {
      // Forma abreviada `{ …, data }` / `{ …, data }` ⇒ opaco.
      if (/^\s*[,}\n]/.test(resto)) return '<opaco>';
      continue;
    }
    const valor = resto.slice(m[0].length).trimStart();
    if (valor.startsWith('{')) {
      const cerrado = argumento(`(${valor}`, 0);
      return cerrado === null ? '<opaco>' : cerrado;
    }
    // `where: algo` / `data: algo` ⇒ no se puede mirar por dentro.
    return '<opaco>';
  }
  return null;
}

/** ¿Este texto menciona la columna `status` como propiedad (⛔ no como parte de `orderStatus`)? */
function mencionaStatus(texto: string): boolean {
  return /(^|[^A-Za-z0-9_$'"])status\s*:/.test(texto) || /(^|[^A-Za-z0-9_$])status\s*,/.test(texto);
}

/**
 * Clasifica las escrituras sobre `shipmentRequest` de un **texto** de TypeScript.
 * Expuesta aparte de {@link censoDeEscriturasDeEstado} para que el canario la alimente con fuente
 * sintética (⛔ un candado que solo se puede probar contra el árbol real no se puede probar).
 */
export function clasificarEscriturasDeEstado(fuente: string, file: string): StatusWriteSite[] {
  const src = stripComments(fuente);
  const sitios: StatusWriteSite[] = [];
  const re = /\bshipmentRequest\s*\.\s*(update|updateMany|upsert)\s*\(/g;
  for (let m = re.exec(src); m !== null; m = re.exec(src)) {
    const verb = m[1];
    if (!(VERBOS as readonly string[]).includes(verb)) continue;
    const line = src.slice(0, m.index).split('\n').length;
    const cuerpo = argumento(src, m.index + m[0].length - 1);
    const where = cuerpo === null ? null : propiedadDePrimerNivel(cuerpo, 'where');
    const data = cuerpo === null ? null : propiedadDePrimerNivel(cuerpo, 'data');
    let kind: StatusWriteKind;
    if (cuerpo === null || where === null || data === null) {
      kind = 'unclassified';
    } else if (data !== '<opaco>' && !mencionaStatus(data)) {
      // No puede mover el estado ⇒ la premisa de monotonía no le afecta.
      kind = 'sin-status';
    } else {
      kind = where !== '<opaco>' && mencionaStatus(where) ? 'guarded' : 'unguarded';
    }
    sitios.push({ file, line, verb, kind, key: `${file}:${line} ${verb}` });
  }
  return sitios;
}

function walkTs(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return walkTs(full);
    if (!e.isFile() || !e.name.endsWith('.ts')) return [];
    // Los `.spec.ts` co-ubicados no se compilan a `dist/` (`tsconfig.build.json`): no corren dinero.
    return e.name.endsWith('.spec.ts') || e.name.endsWith('.e2e-spec.ts') ? [] : [full];
  });
}

/** Censo sobre un árbol real. `root` es el directorio a recorrer; `base`, la raíz de las rutas. */
export function censoDeEscriturasDeEstado(root: string, base: string): StatusWriteSite[] {
  return walkTs(root).flatMap((f) =>
    clasificarEscriturasDeEstado(readFileSync(f, 'utf8'), relative(base, f).split('\\').join('/')),
  );
}
