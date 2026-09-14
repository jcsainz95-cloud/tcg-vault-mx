/**
 * price-convention-writers.ts — **el instrumento de `IVA-12(b)`: quién ESCRIBE una convención de
 * precio, mirando CÓDIGO.**
 *
 * ### Para qué existe (`API_CONTRACT §M10-IVA.9.d`, criterio **214**, `ARCHITECTURE §4.55`)
 * `IVA-12` está escrito **por lo negativo**: *«tras el despliegue **ningún camino escribe
 * `IVA_EXCLUSIVE`**»*. Eso no se puede medir con un `rg` a pelo, y el contrato lo dice en la misma
 * frase: *«`rg "IVA_EXCLUSIVE" backend/src` **no devuelve ningún ESCRITOR**; solo el **lector** (el
 * `switch` de `money.ts`) y fixtures/pruebas»*. ⇒ hace falta **distinguir escritor de lector**, y
 * hacerlo sobre código y no sobre prosa.
 *
 * ### Las tres clases, y por qué la tercera existe
 *  - **`writer`** — `priceConvention: 'IVA_EXCLUSIVE'` / `priceConvention = 'IVA_EXCLUSIVE'`. Es lo
 *    que `IVA-12` prohíbe: **la fila nace bajo la convención vieja**.
 *  - **`reader`** — `case 'IVA_EXCLUSIVE':`. Es lo que `IVA-3` **exige que siga existiendo**: una
 *    orden ya cobrada **no se reinterpreta sola**, y el `switch` que la lee tiene que conocer las dos
 *    ramas. *`IVA-12` dice «lo nuevo nace bien»; `IVA-3` dice «lo viejo no se reinterpreta». Son dos
 *    candados y hacen falta los dos.*
 *  - **`unclassified`** — cualquier otra aparición en código. **Cuenta como rojo**, y a propósito:
 *    un candado que solo busca la forma que hoy conoce se rodea escribiendo la misma decisión de otra
 *    manera (`const C = 'IVA_EXCLUSIVE'; … priceConvention: C`). *Si aparece una forma nueva, que la
 *    clasifique un humano y la escriba aquí, no que pase en silencio.*
 *
 * ### ⚠️ Su límite, dicho y no escondido
 * ⛔ **No es un parser de TypeScript.** Mira el fichero sin comentarios (`stripComments`) y clasifica
 * **cada aparición** por lo que la precede. Un escritor partido en dos líneas entre
 * `priceConvention:` y el literal **se ve** (el patrón admite espacios y saltos); uno que pase el
 * valor por una variable sale como **`unclassified`**, que también es rojo. Lo que cierra el límite
 * es el **canario** (`iva-12-price-convention-writers.spec.ts`), que reintroduce los defectos y
 * exige el rojo — **incluida la mutación que mató a la primera versión**: dos escritores en la misma
 * línea.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { stripComments } from './strip-comments';

export type ConventionSiteKind = 'writer' | 'reader' | 'unclassified';

export interface ConventionSite {
  /** Ruta relativa a `backend/`, p. ej. `src/modules/orders/orders.service.ts`. */
  readonly file: string;
  /** Línea (1-based) dentro del fichero original. */
  readonly line: number;
  readonly kind: ConventionSiteKind;
  /** Llave del trinquete: `src/…/x.ts:1282`. */
  readonly key: string;
}

/**
 * ⭐ **Se clasifica POR APARICIÓN, no por línea, y eso NO es un detalle de estilo.**
 * La primera versión miraba línea a línea, y la batería de mutación lo cazó: **dos escritores en la
 * MISMA línea contaban como uno** ⇒ un escritor nuevo podía colarse pegado a uno ya censado sin
 * mover el trinquete. *Un candado que cuenta líneas mide el formateador, no el código.*
 */
/** `priceConvention: 'IVA_EXCLUSIVE'` / `priceConvention = 'IVA_EXCLUSIVE'` — la ASIGNACIÓN. */
const WRITER_PREFIX = /priceConvention\s*[:=]\s*(['"`])\s*$/;
/** `case 'IVA_EXCLUSIVE':` — la rama del LECTOR que `IVA-3` exige conservar. */
const READER_PREFIX = /case\s+(['"`])\s*$/;
/** Cuánto contexto se mira hacia atrás: suficiente para un salto de línea y sangría de Prettier. */
const VENTANA = 120;

function walkTs(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return walkTs(full);
    return e.isFile() && e.name.endsWith('.ts') ? [full] : [];
  });
}

/**
 * Clasifica las apariciones de `IVA_EXCLUSIVE` en un **texto** de TypeScript.
 * Expuesta aparte de {@link censoDeConvencion} para que el canario la alimente con fuente sintética.
 */
export function clasificarConvencion(fuente: string, file: string): ConventionSite[] {
  const src = stripComments(fuente);
  const sitios: ConventionSite[] = [];
  for (let off = src.indexOf('IVA_EXCLUSIVE'); off !== -1; off = src.indexOf('IVA_EXCLUSIVE', off + 1)) {
    const prefijo = src.slice(Math.max(0, off - VENTANA), off);
    const kind: ConventionSiteKind = WRITER_PREFIX.test(prefijo)
      ? 'writer'
      : READER_PREFIX.test(prefijo)
        ? 'reader'
        : 'unclassified';
    const line = src.slice(0, off).split('\n').length;
    sitios.push({ file, line, kind, key: `${file}:${line}` });
  }
  return sitios;
}

/**
 * Censo sobre un árbol real. `root` es el directorio a recorrer; `base` es la raíz contra la que se
 * relativizan las rutas (por defecto, `backend/`).
 */
export function censoDeConvencion(root: string, base: string): ConventionSite[] {
  return walkTs(root).flatMap((f) =>
    clasificarConvencion(readFileSync(f, 'utf8'), relative(base, f).split('\\').join('/')),
  );
}
