/**
 * redis-close.ts — EL cierre de un cliente ioredis propio (TD-HND-3; BACKEND_NOTES §Handles). Antes estaba copiado en cuatro
 * sitios (planificador, intentos de login, contador del Card Show, health) con tres variantes.
 *
 * `quit` ordenado con tope; si no contesta a tiempo o falla ⇒ `disconnect` (corte duro). Nunca lanza ni deja el timer vivo.
 * Con `requireReady`, si la conexión no está `ready` ni se intenta `quit` (se encolaría offline y colgaría el apagado).
 */
export interface QuittableRedis {
  quit(): Promise<unknown>;
  disconnect(): void;
  readonly status?: string;
}

export const REDIS_QUIT_TIMEOUT_MS = 1000;

export async function closeRedisClient(
  client: QuittableRedis,
  opts: { timeoutMs?: number; requireReady?: boolean } = {},
): Promise<'quit' | 'disconnect'> {
  if (opts.requireReady && client.status !== 'ready') {
    client.disconnect();
    return 'disconnect';
  }
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      client.quit(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('redis quit timeout')), opts.timeoutMs ?? REDIS_QUIT_TIMEOUT_MS);
        // No mantiene vivo el event loop por sí mismo (si `quit` cuelga, el socket ya lo mantiene).
        timer.unref?.();
      }),
    ]);
    return 'quit';
  } catch {
    client.disconnect();
    return 'disconnect';
  } finally {
    clearTimeout(timer);
  }
}
