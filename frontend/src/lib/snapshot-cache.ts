/**
 * Memoria de servidor de UNA entrada con tope DURO de edad (feed de Google y sitemap, §GSHOP). Ignora la cadena de consulta
 * (la llave es del llamador) y NUNCA sirve una copia más vieja que `ttlMs`: pasado el tope, o se regenera o falla.
 * Peticiones simultáneas comparten la misma carga. Una carga fallida no guarda nada.
 */
interface Entry<T> {
  at: number;
  value: T;
}
const store = new Map<string, Entry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

export async function fresh<T>(key: string, ttlMs: number, load: () => Promise<T>, now: () => number = Date.now): Promise<T> {
  const hit = store.get(key) as Entry<T> | undefined;
  if (hit && now() - hit.at < ttlMs) return hit.value;
  const pending = inflight.get(key) as Promise<T> | undefined;
  if (pending) return pending;
  const p = (async () => {
    try {
      const value = await load();
      store.set(key, { at: now(), value });
      return value;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

/** Solo para pruebas. */
export function resetSnapshotCache(): void {
  store.clear();
  inflight.clear();
}
