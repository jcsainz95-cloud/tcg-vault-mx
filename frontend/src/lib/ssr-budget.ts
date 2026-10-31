/**
 * Topes de las lecturas que hace el SERVIDOR antes de pintar (TL-MKT2-1). Un render de servidor que espera sin tope a
 * un backend que no responde deja la página colgada (I-1 de QA sobre `561ad425`: fichas sin respuesta en 30 s con el
 * backend congelado). Con tope, la lectura cae a `null` y la página sale con su carga en cliente.
 *
 * Dos formas, ninguna lanza:
 * - `withBudget(promise, ms)`: deja de ESPERAR al vencer, pero la petición sigue viva en segundo plano.
 * - `withAbortBudget(run, ms)`: además ABORTA el fetch al vencer (le pasa un `AbortSignal` a `run`); es la que se usa
 *   cuando la lectura acepta señal, para no acumular sockets colgados contra un backend congelado.
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
