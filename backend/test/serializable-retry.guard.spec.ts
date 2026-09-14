import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { anclasEstructurales, codigoDeTexto } from './helpers/codigo-de-fichero';

/**
 * # `serializable-retry.guard.spec.ts` — ⭐⭐ **EL CANDADO TRANSVERSAL, en vez de seis parches**
 *
 * ## Por qué existe
 * El `500` medido el 2026-09-14 (`POST /buylist/requests`, dos altas simultáneas) no fue un descuido
 * de un sitio: fue **la misma omisión repetida seis veces**. Seis transacciones `SERIALIZABLE`,
 * ninguna con reintento — y el reintento **no es un extra del nivel de aislamiento, es su precio**.
 * Postgres promete equivalencia con una ejecución en serie y a cambio se reserva el derecho a
 * abortar con `40001`; una aplicación que pide la garantía y no reintenta **le pasa la factura al
 * cliente en forma de `500`**.
 *
 * Arreglar los seis y no dejar candado significa que **el séptimo nace roto**. Por eso lo que se
 * vigila no es la conducta de un endpoint, sino la **forma**: en `src/`, pedir `Serializable` solo
 * puede hacerse desde `common/serializable-retry.ts`.
 *
 * ## Qué ve y qué no
 * ⚠️ Es una prueba de **texto**, y eso es una limitación real: no detecta una transacción
 * serializable abierta por una vía que no nombre el enum (`$executeRaw('SET TRANSACTION ISOLATION
 * LEVEL SERIALIZABLE')`, por ejemplo). Lo que sí garantiza es que **la forma normal de escribirlo en
 * este repo** —la única que aparece hoy, seis veces— pase por el helper. *Un candado que cubre el
 * camino real vale más que ninguno; decir hasta dónde llega es lo que lo hace honesto.*
 *
 * ## ⭐⭐ Y AQUÍ EL DEFECTO PROPIO, que el techlead midió el mismo día en que este fichero nació
 * La versión original leía con `readFileSync` **crudo** —sin quitar comentarios— y eso **corta en
 * los dos sentidos**, que es lo que lo hace peor que un simple falso positivo:
 *  - un **comentario** que nombre el enum (por ejemplo, el que explica por qué no debe nombrarse)
 *    pone el candado **ROJO EN FALSO**, y lo que eso enseña es *«la salida es borrar la
 *    explicación»* — exactamente lo que el techlead nombró en `strip-comments.ts`;
 *  - un **comentario** con `runSerializable(…)` rompe el `toHaveLength(6)` **sin que nadie haya
 *    tocado código**, y a la inversa: uno de los seis llamadores comentado seguiría contándose,
 *    así que *el candado diría «seis» con cinco garantías vivas*. Esa mitad es la peligrosa.
 *
 * ⇒ Se lee por `codigoDeFichero` (autorómata v2 + no-vacuidad **por contenido**). ⛔ Y el docstring
 * de arriba puede volver a nombrar el enum sin que nada se ponga rojo, que es como debe ser.
 */

const SRC = join(__dirname, '..', 'src');
/** El ÚNICO fichero autorizado a nombrar el nivel de aislamiento. */
const HELPER = join('common', 'serializable-retry.ts');

/**
 * Lectura única del fichero, ya **sin comentarios** y con su control de no-vacuidad por contenido
 * (`anclasEstructurales` ancla por las DOS puntas: la ceguera de esta clase es parcial).
 */
const cache = new Map<string, string>();
function codigo(ruta: string): string {
  const memo = cache.get(ruta);
  if (memo !== undefined) return memo;
  const fuente = readFileSync(ruta, 'utf8');
  const limpio = codigoDeTexto(fuente, ruta, anclasEstructurales(fuente, ruta));
  cache.set(ruta, limpio);
  return limpio;
}

function ficherosTs(dir: string): string[] {
  const out: string[] = [];
  for (const nombre of readdirSync(dir)) {
    const p = join(dir, nombre);
    if (statSync(p).isDirectory()) out.push(...ficherosTs(p));
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

describe('⭐⭐ Candado — ninguna transacción `SERIALIZABLE` fuera del helper con reintento', () => {
  const ficheros = ficherosTs(SRC);

  /**
   * ⭐ **NO-VACUIDAD POR CONTENIDO.** «Hay más de 100 ficheros» es el control que ya falló en otro
   * candado de este repo: cubre el caso **TOTAL** (no se leyó nada) y **no ve el PARCIAL**, que es el
   * que ocurre — el limpiador conserva el fichero y pierde la región vigilada. Aquí se exige que el
   * texto limpio **conserve las llamadas que el candado va a contar**: si se perdieran, el
   * `toHaveLength(6)` de abajo diría «cero» y nadie sabría si es que no hay o que no se vio.
   */
  it('⛔ NO-VACUIDAD: el censo tiene código Y conserva las llamadas que se van a contar', () => {
    expect(ficheros.length).toBeGreaterThan(100);
    expect(codigo(join(SRC, HELPER))).toContain('export async function runSerializable');
    const conLlamada = ficheros.filter(
      (f) => !f.endsWith(HELPER) && codigo(f).includes('runSerializable('),
    );
    // ⛔ Rojo con 0: o el limpiador se los comió, o alguien quitó las seis garantías a la vez.
    expect(conLlamada.length).toBeGreaterThanOrEqual(2);
  });

  it('⛔ `TransactionIsolationLevel.Serializable` sólo aparece en `common/serializable-retry.ts`', () => {
    const infractores = ficheros.filter(
      (f) =>
        !f.endsWith(HELPER) &&
        /TransactionIsolationLevel\s*\.\s*Serializable/.test(codigo(f)),
    );
    // ⛔ Rojo con cualquier fichero: abrir una tx serializable a mano es abrir un `500` bajo
    // concurrencia. Se usa `runSerializable(this.prisma, fn, { label })`, que la abre igual de
    // serializable y además reintenta el `40001`.
    expect(infractores.map((f) => f.slice(SRC.length + 1))).toEqual([]);
  });

  it('⭐ y el helper SÍ la nombra (si dejara de hacerlo, ya no abriría transacciones serializables)', () => {
    // La otra mitad del candado: sin esto, borrar el enum del helper dejaría el test de arriba verde
    // con TODAS las transacciones degradadas a `READ COMMITTED` — el TOCTOU de `SEC-A2` de vuelta.
    expect(codigo(join(SRC, HELPER))).toMatch(/TransactionIsolationLevel\s*\.\s*Serializable/);
  });

  it('⭐ los seis llamadores siguen ahí: nadie "arregló" el 500 quitando la transacción', () => {
    // `SEC-A2` y sus hermanos dependen de que estas operaciones sigan siendo serializables. Si el
    // número baja, alguien quitó una garantía de concurrencia; si sube, hay que auditar que el nuevo
    // cuerpo no tenga efectos fuera de la BD (el reintento lo ejecutaría dos veces).
    // ⛔ Sobre CÓDIGO: un `runSerializable(…)` escrito en un comentario no es una garantía, y uno
    // COMENTADO tampoco lo es — contarlos era decir «seis» con cinco transacciones vivas.
    const sitios = ficheros
      .filter((f) => !f.endsWith(HELPER))
      .flatMap((f) => codigo(f).match(/\brunSerializable\s*\(/g) ?? []);
    expect(sitios).toHaveLength(6);
  });
});
