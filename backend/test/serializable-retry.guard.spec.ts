import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

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
 */

const SRC = join(__dirname, '..', 'src');
/** El ÚNICO fichero autorizado a nombrar el nivel de aislamiento. */
const HELPER = join('common', 'serializable-retry.ts');

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

  it('el censo no está vacío (si lo estuviera, este candado no estaría midiendo nada)', () => {
    // Control de no-vacuidad: sin esto, un `SRC` mal resuelto haría pasar el candado por ausencia.
    expect(ficheros.length).toBeGreaterThan(100);
  });

  it('⛔ `TransactionIsolationLevel.Serializable` sólo aparece en `common/serializable-retry.ts`', () => {
    const infractores = ficheros.filter(
      (f) =>
        !f.endsWith(HELPER) &&
        /TransactionIsolationLevel\s*\.\s*Serializable/.test(readFileSync(f, 'utf8')),
    );
    // ⛔ Rojo con cualquier fichero: abrir una tx serializable a mano es abrir un `500` bajo
    // concurrencia. Se usa `runSerializable(this.prisma, fn, { label })`, que la abre igual de
    // serializable y además reintenta el `40001`.
    expect(infractores.map((f) => f.slice(SRC.length + 1))).toEqual([]);
  });

  it('⭐ y el helper SÍ la nombra (si dejara de hacerlo, ya no abriría transacciones serializables)', () => {
    // La otra mitad del candado: sin esto, borrar el enum del helper dejaría el test de arriba verde
    // con TODAS las transacciones degradadas a `READ COMMITTED` — el TOCTOU de `SEC-A2` de vuelta.
    const helper = readFileSync(join(SRC, HELPER), 'utf8');
    expect(helper).toMatch(/TransactionIsolationLevel\s*\.\s*Serializable/);
  });

  it('⭐ los seis llamadores siguen ahí: nadie "arregló" el 500 quitando la transacción', () => {
    // `SEC-A2` y sus hermanos dependen de que estas operaciones sigan siendo serializables. Si el
    // número baja, alguien quitó una garantía de concurrencia; si sube, hay que auditar que el nuevo
    // cuerpo no tenga efectos fuera de la BD (el reintento lo ejecutaría dos veces).
    const llamadores = ficheros.filter((f) => /\brunSerializable\s*\(/.test(readFileSync(f, 'utf8')));
    const sitios = llamadores
      .filter((f) => !f.endsWith(HELPER))
      .flatMap((f) => readFileSync(f, 'utf8').match(/\brunSerializable\s*\(/g) ?? []);
    expect(sitios).toHaveLength(6);
  });
});
