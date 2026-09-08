/**
 * `widen-list.ts` — **ENSANCHAR UNA LISTA DE POLÍTICA DENTRO DE UN TEST.** Propiedad: backend.
 *
 * ### Por qué existe (techlead, gate de v1.55)
 * `buylist.grade-key-derivation.spec.ts` encontró **dos** defectos que ninguna otra técnica veía, y
 * los encontró por la misma razón: en vez de **razonar** sobre qué pasaría el día que
 * `BUYLIST_ACCEPTED_PRODUCT_TYPES` gane un valor, **ensancha la lista de verdad** y mira qué hace el
 * código. La lista es una constante de módulo (`export const`), así que no se puede reasignar: se
 * intercepta el módulo con un `jest.mock` cuya propiedad es un **GETTER**, y el getter consulta un
 * valor que el test controla.
 *
 * Ese truco estaba **enterrado en un spec**. Se mueve aquí sin argumentarlo más: *toda lista de
 * política que un `switch`, una guarda o un barrido consuman tiene exactamente el mismo agujero* —el
 * día que crezca, ¿qué hace el consumidor?—, y la respuesta solo es fiable si se ensancha la lista
 * real. Listas de esta clase, hoy: `BUYLIST_ACCEPTED_PRODUCT_TYPES` (`common/business-rules`),
 * `BUYLIST_ACCEPTED_*`/`*_TERMINAL_*` y cualquier `readonly T[]` exportada que decida política.
 *
 * ### ⚠️ Lo que este helper NO hace
 * **No sustituye a la aserción.** Ensanchar la lista solo crea el escenario; lo que vale es lo que se
 * asevera dentro —que el consumidor **no** invente un default, que el `never` obligue a decidir, que
 * la degradación sea explícita—. *Una lista ensanchada sin aserción es un fixture, y un fixture no es
 * una prueba* (la lección de B-1: `pickupAddressLine: null` apagaba el bloque en vez de mirarlo).
 *
 * ### Uso
 * ```ts
 * // 1) En la CABECERA del spec (se iza por encima de los imports; por eso `require` y no `import`).
 * jest.mock('../src/common/business-rules', () =>
 *   // eslint-disable-next-line @typescript-eslint/no-var-requires
 *   require('./helpers/widen-list').widenableModule(
 *     jest.requireActual('../src/common/business-rules'),
 *     'BUYLIST_ACCEPTED_PRODUCT_TYPES',
 *   ),
 * );
 *
 * // 2) En el cuerpo.
 * import { setList, resetLists, withList } from './helpers/widen-list';
 * afterEach(resetLists);                                    // ⚠️ OBLIGATORIO: es estado global.
 * setList('BUYLIST_ACCEPTED_PRODUCT_TYPES', ['raw', 'graded']);
 * await withList('BUYLIST_ACCEPTED_PRODUCT_TYPES', [], async () => { ... });
 * ```
 */

/** Overrides vivos, por nombre de export. `undefined` (ausente) ⇒ manda el valor REAL del módulo. */
const overrides = new Map<string, readonly unknown[]>();

/**
 * Envuelve el módulo REAL sustituyendo `keys` por **getters**. Se llama DENTRO del factory de
 * `jest.mock`, que se iza por encima de todo import: de ahí que el spec lo alcance con `require`.
 *
 * ⚠️ **Getter y no valor**: un `{ ...actual, KEY: algo }` congelaría la lista en el instante del
 * `jest.mock` —o sea antes de que ningún test haya podido decidir nada— y el ensanche no se vería.
 */
export function widenableModule<T extends object>(actual: T, ...keys: (keyof T & string)[]): T {
  const wrapped: Record<string, unknown> = { ...(actual as Record<string, unknown>) };
  for (const key of keys) {
    Object.defineProperty(wrapped, key, {
      enumerable: true,
      configurable: true,
      get: () => overrides.get(key) ?? (actual as Record<string, unknown>)[key],
    });
  }
  return wrapped as T;
}

/** Instala el valor de la lista. Vive hasta `resetLists()` — por eso el `afterEach` no es opcional. */
export function setList<T>(key: string, value: readonly T[]): void {
  overrides.set(key, value);
}

/** Devuelve TODAS las listas a su valor real. Va en el `afterEach` del spec. */
export function resetLists(): void {
  overrides.clear();
}

/**
 * Variante ACOTADA: instala el valor solo durante `fn` y lo retira **siempre** —también si `fn`
 * lanza y también si es `async`—. Preferible a `setList` cuando el ensanche es de un solo test: el
 * estado global no puede quedarse colgado y filtrarse al siguiente.
 */
export function withList<T, R>(key: string, value: readonly T[], fn: () => R): R {
  const had = overrides.has(key);
  const previous = overrides.get(key);
  const restore = () => {
    if (had) overrides.set(key, previous as readonly unknown[]);
    else overrides.delete(key);
  };
  overrides.set(key, value);
  let result: R;
  try {
    result = fn();
  } catch (e) {
    restore();
    throw e;
  }
  if (result != null && typeof (result as { then?: unknown }).then === 'function') {
    return (result as unknown as Promise<unknown>).then(
      (v) => {
        restore();
        return v;
      },
      (e) => {
        restore();
        throw e;
      },
    ) as unknown as R;
  }
  restore();
  return result;
}
