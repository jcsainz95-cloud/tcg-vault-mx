/**
 * redis-connection.util.ts — resolución del `family` DNS para las conexiones ioredis
 * (auditoría de precios 2026-08-17, ver docs/BACKEND_NOTES.md).
 *
 * CONTEXTO (Railway): el private networking (`redis.railway.internal`) resuelve SOLO
 * registros AAAA (IPv6). ioredis usa `family: 4` (IPv4) por DEFECTO → el lookup falla
 * con ENOTFOUND/ETIMEDOUT y la conexión reintenta PARA SIEMPRE en silencio: los crons
 * BullMQ nunca corren y los precios del catálogo jamás se pueblan. Fix conocido y
 * documentado por Railway: `family: 0` (lookup dual-stack IPv4+IPv6).
 *
 * Precedencia (de mayor a menor):
 *  1. Env `REDIS_FAMILY` (0 | 4 | 6) — override explícito de devops sin tocar la URL.
 *  2. `?family=` en la propia REDIS_URL — ioredis ya la parsea; NO la pisamos.
 *  3. Default `0` (dual-stack) — funciona igual con IPv4 local/CI y con IPv6-only (Railway).
 */
export function resolveRedisFamily(url: string, envValue?: string): number | undefined {
  if (envValue != null && envValue.trim() !== '') {
    const n = Number(envValue.trim());
    if (n === 0 || n === 4 || n === 6) return n;
  }
  // La URL ya trae `?family=` → ioredis la respeta; devolver undefined evita pisarla
  // (las opciones explícitas del constructor tienen precedencia sobre la query de la URL).
  if (/[?&]family=/.test(url)) return undefined;
  return 0;
}

/** Opciones ioredis para BullMQ con el `family` resuelto (solo se añade si aplica). */
export function bullRedisOptions(
  url: string,
  envValue?: string,
): { maxRetriesPerRequest: null; family?: number } {
  const family = resolveRedisFamily(url, envValue);
  return {
    // BullMQ exige maxRetriesPerRequest=null en la conexión de los workers.
    maxRetriesPerRequest: null,
    ...(family !== undefined ? { family } : {}),
  };
}
