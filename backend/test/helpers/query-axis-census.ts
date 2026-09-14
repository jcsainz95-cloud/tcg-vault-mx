/**
 * query-axis-census.ts — **enumera los `@Query(...)` que la app expone de verdad, mirando CÓDIGO.**
 *
 * ### Para qué existe (`C-EQ-1`, mitad 2 · ARCHITECTURE §4.37.1-a · API_CONTRACT §0-Q punto 4)
 * *Una suite no puede fallar por un parámetro que nunca le contaron.* El censo de §0-Q que la v1.72
 * llevaba **escrito a mano** no se saltó `?context=`, `?reason=` y `?axis=` por descuido: **no
 * estaban en él**, y una lista escrita a mano no puede enterarse de lo que nadie le contó. Este
 * fichero es el que se entera: recorre los controllers, resuelve la **ruta** de cada handler y
 * devuelve los ejes de query que ese handler declara. La suite cruza esa salida contra dos listas
 * explícitas y pone **rojo** lo que no esté en ninguna.
 *
 * ### ⚠️ Mira CÓDIGO, no texto — y aquí va MEDIDO dónde importa, no donde suena bien
 * Pasa por `stripComments` **antes** de buscar. La versión primera de este docstring decía que sin
 * eso el docstring de `common/enum-filter.ts` —que *explica* `@Query('status') status?: string`— se
 * contaría como eje. **Medido el 2026-09-13 sobre una copia del árbol: es FALSO.** Con y sin
 * `stripComments`, el censo de `src/` da **176** ejes, idénticos. La razón es estructural: este
 * escáner solo mira **dentro del segmento de un handler** (de un decorador de ruta al siguiente), y
 * ese fichero no tiene ni un `@Get`, así que su prosa ya quedaba fuera por otro motivo.
 *
 * **Dónde sí importa, y es el caso realista:** un `@Query` **comentado** dentro de un handler — el
 * parámetro que alguien silenció al depurar y no borró. Medido sobre fuente sintética: escáner
 * normal ⇒ **1** eje; escáner en modo texto ⇒ **2**, uno **fantasma**. Un eje fantasma no da un rojo
 * honesto: da un rojo por un parámetro **que no existe**, y lo que eso enseña es a apagar el candado.
 * Es la misma familia del defecto que `H3-d` le quitó a `enum-values-parity.spec.ts` (*«cada fichero
 * que quiera explicar la regla tiene que pedirle permiso al test»*), con el alcance dicho de verdad.
 *
 * ⚠️ Esto se escribe así porque **el canario lo cazó**: su primera versión ponía el comentario antes
 * del `@Get` y salió **VERDE 3/3** ante la mutación que quita el `stripComments`. Un canario verde
 * por accidente afirma una cobertura que no existe.
 *
 * ### Cómo resuelve la ruta (y por qué la ruta y no solo el nombre)
 * Un `?status=` no es un eje: es **cinco** ejes distintos, uno por endpoint, con cinco dominios
 * posibles. Cruzar solo por nombre dejaría que un endpoint NUEVO con `@Query('status')` heredara la
 * declaración de otro y pasara en verde — que es la clase de hueco que `C-EQ-1` viene a cerrar. Por
 * eso la llave es `MÉTODO /ruta::param`:
 *  1. el prefijo lo da el `@Controller('x')` **más cercano por encima** (un fichero puede tener
 *     varios: `admin.controller.ts` declara cuatro, medido);
 *  2. el segmento de un handler va desde su decorador de ruta (`@Get`/`@Post`/…) hasta el siguiente;
 *  3. los `@Query(...)` de ese segmento son los de ese handler.
 *
 * ⛔ **No es un parser de TypeScript** y no pretende serlo. Su límite está dicho arriba y lo cierra
 * el **canario** (`test/enum-query-census-canary.spec.ts`), que reintroduce los dos defectos —el eje
 * sin declarar y el escáner ciego— y exige el rojo en los dos. Un candado sin canario no es un
 * candado: es una esperanza.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './strip-comments';

/** Un `@Query(...)` encontrado en el código, con la ruta del handler que lo declara. */
export interface QueryAxisSite {
  /** Ruta relativa al repo, p. ej. `src/modules/pricing/pricing.controller.ts`. */
  readonly file: string;
  /** `GET /admin/pricing/pending` — método + ruta completa (prefijo del `@Controller` incluido). */
  readonly route: string;
  /** Nombre del parámetro, o `null` si es un `@Query()` **sin nombre** (la query entera). */
  readonly param: string | null;
  /** Llave canónica del cruce: `GET /admin/pricing/pending::context`. */
  readonly key: string;
}

const ROUTE_DECORATOR = /@(Get|Post|Put|Patch|Delete|Head|Options|All)\(([^)]*)\)/g;
const CONTROLLER_DECORATOR = /@Controller\(([^)]*)\)/g;
const QUERY_DECORATOR = /@Query\(([^)]*)\)/g;

/** Extrae el literal de cadena de un argumento de decorador (`'x'`, `"x"`, `` `x` ``), o `''`. */
function literalArg(raw: string): string {
  const m = /^\s*(['"`])([^'"`]*)\1/.exec(raw);
  return m ? m[2] : '';
}

/** `/admin` + `inventory/items` ⇒ `/admin/inventory/items`. Colapsa `//` y quita la barra final. */
function joinRoute(prefix: string, path: string): string {
  const joined = `/${prefix}/${path}`.replace(/\/+/g, '/');
  return joined.length > 1 ? joined.replace(/\/$/, '') : joined;
}

function walkTs(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return walkTs(full);
    return e.isFile() && e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts') ? [full] : [];
  });
}

/**
 * Recorre `src/` y devuelve **todos** los `@Query(...)` que hay en código, con su ruta resuelta.
 *
 * ⚠️ Recorre `src/` **entero**, no solo `*.controller.ts`: un handler puede vivir en un fichero con
 * otro nombre, y acotar por nombre de fichero sería la misma ceguera que acotar por lista blanca.
 */
export function censusQueryAxes(srcDir: string): QueryAxisSite[] {
  return walkTs(srcDir).flatMap((file) =>
    scanSource(`src${file.slice(srcDir.length)}`, readFileSync(file, 'utf8')),
  );
}

/**
 * El escáner, **puro**: un fichero (nombre + contenido CRUDO, sin pasar por `stripComments` — lo
 * hace él) ⇒ sus ejes de query.
 *
 * ⚠️ Se exporta **para el canario** (`test/enum-query-census-canary.spec.ts`), que lo alimenta con
 * fuentes SINTÉTICAS. Un canario que mutara ficheros del repo de verdad puede dejar el árbol sucio
 * si se cae a mitad, y este proyecto ya pagó una corrida de mutación sobre un árbol destruido (O-8).
 */
export function scanSource(relFile: string, rawSource: string): QueryAxisSite[] {
  const sites: QueryAxisSite[] = [];

  // ⭐⭐ **Si vienes a quitar este `stripComments`, lee esto: el motivo NO es el que parece.**
  //
  // Aquí decía que sin él se contaría como eje el docstring de `common/enum-filter.ts`, que EXPLICA
  // `@Query('status') status?: string`. **Eso es falso y está medido** (2026-09-13, sobre copia del
  // árbol entero): con y sin `stripComments`, el censo de `src/` da **176** ejes idénticos. Ese
  // fichero no tiene ni un decorador de ruta, y abajo solo se mira DENTRO del segmento de un
  // handler, así que su prosa ya quedaba fuera por otro motivo.
  //
  // **Lo que sí depende de esta línea** es el `@Query` **comentado dentro de un handler** — el
  // parámetro que alguien silenció al depurar y no borró. Medido: escáner normal ⇒ 1 eje; sin
  // `stripComments` ⇒ **2**, uno **fantasma**. Un eje fantasma no da un rojo honesto: da un rojo por
  // un parámetro que no existe, y lo que eso enseña es a apagar el candado.
  //
  // Lo vigila el canario (`test/enum-query-census-canary.spec.ts`, m2). ⚠️ Su PRIMERA versión ponía
  // el comentario ANTES del `@Get` y salió VERDE 3/3 ante la mutación que quita esta línea: el
  // canario afirmaba una cobertura que no tenía. Por eso el motivo va escrito aquí, en el sitio que
  // lee quien esté decidiendo si esto se puede quitar (techlead, condición `C2`).
  const code = stripComments(rawSource);
  if (!code.includes('@Query')) return sites;

  // Prefijos de `@Controller`, con su posición: el que aplica a un handler es el ÚLTIMO que quedó
  // por encima de él en el fichero.
  const prefixes: { at: number; prefix: string }[] = [];
  for (const m of code.matchAll(CONTROLLER_DECORATOR)) {
    prefixes.push({ at: m.index ?? 0, prefix: literalArg(m[1]) });
  }

  const routes = [...code.matchAll(ROUTE_DECORATOR)].map((m) => ({
    at: m.index ?? 0,
    method: m[1].toUpperCase(),
    path: literalArg(m[2]),
  }));

  for (let i = 0; i < routes.length; i++) {
    const r = routes[i];
    const end = i + 1 < routes.length ? routes[i + 1].at : code.length;
    const segment = code.slice(r.at, end);
    const params = [...segment.matchAll(QUERY_DECORATOR)];
    if (params.length === 0) continue;

    const prefix = prefixes.filter((p) => p.at < r.at).pop()?.prefix ?? '';
    const route = `${r.method} ${joinRoute(prefix, r.path)}`;

    for (const q of params) {
      const named = literalArg(q[1]);
      const param = named === '' ? null : named;
      sites.push({
        file: relFile,
        route,
        param,
        key: `${route}::${param ?? '<sin nombre>'}`,
      });
    }
  }

  return sites;
}
