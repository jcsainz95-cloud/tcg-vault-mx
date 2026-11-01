/**
 * Topes de las lecturas que hace el SERVIDOR antes de pintar (TL-MKT2-1). Un render de servidor que espera sin tope a
 * un backend que no responde deja la página colgada (I-1 de QA sobre `561ad425`: fichas sin respuesta en 30 s con el
 * backend congelado). Con tope, la lectura cae a `null` y la página sale con su carga en cliente.
 *
 * Dos formas, ninguna lanza:
 * - `withBudget(promise, ms)`: deja de ESPERAR al vencer, pero la petición sigue viva en segundo plano.
 * - `withAbortBudget(run, ms)`: además ABORTA el fetch al vencer (le pasa un `AbortSignal` a `run`); es la que se usa
 *   cuando la lectura acepta señal, para no acumular sockets colgados contra un backend congelado.
 *
 * **Cuál elegir — criterio de la respuesta tardía, ARCHITECTURE §4.DYN (f) 2 (v1.115, TL-MKT4-3).** La tardía llena la
 * caché de datos de Next **solo si el espacio de claves lo fijamos nosotros**:
 * - `withBudget` (la tardía llena la caché y sirve a la siguiente visita): claves CONSTANTES — portada `featured` /
 *   `showcase` (`lib/home-ssr.ts`) y la regla de envío (`loadShippingRuleForSSR`). No se pueden multiplicar.
 * - `withAbortBudget`: si la clave la elige QUIEN VISITA (catálogo: `q`/`setId`/`rarity` libres, PEN-MKT-2) o si no hay
 *   caché que llenar (fichas de carta y sellado: leen sin caché de datos).
 * Una lectura SSR nueva cita este criterio al elegir. La edad del dato que llega al cliente: §4.DYN (f) 9
 * (`responseAgeMs` en `lib/catalog-ssr.ts`).
 */

/** Resuelve `p` o `null` si tarda más de `ms` o falla. Nunca lanza. */
export async function withBudget<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    return await Promise.race([p.catch(() => null), late]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Como `withBudget`, pero al vencer el tope aborta la lectura con la señal que recibió `run`. Nunca lanza. */
export async function withAbortBudget<T>(run: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T | null> {
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      ctrl.abort();
      resolve(null);
    }, ms);
  });
  let p: Promise<T | null>;
  try {
    p = run(ctrl.signal).catch(() => null);
  } catch {
    p = Promise.resolve(null);
  }
  try {
    return await Promise.race([p, late]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
