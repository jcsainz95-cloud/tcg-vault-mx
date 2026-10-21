/**
 * open-handles.teardown.ts — CANDADO «la integración termina sola» (globalTeardown). Propiedad: backend.
 *
 * De dónde viene (2026-10-19): `RedisCardShowCounterStore` creaba su propio cliente ioredis y nadie lo
 * cerraba; cada `app.close()` de la suite dejaba un socket a Redis vivo y la integración NO TERMINABA
 * NUNCA. En CI eso no es un rojo: es un job colgado hasta que GitHub lo cancela a las 6 h, y el gate
 * `backend-e2e` no da veredicto (ni verde ni rojo) — desde el 16-oct en `production` y en toda rama.
 *
 * Qué hace: la suite corre `--runInBand` (`maxWorkers: 1`), así que los specs viven EN ESTE proceso y
 * sus handles son los de este proceso. Al acabar, espera hasta `GRACE_MS` a que se suelte todo lo que
 * mantiene vivo el event loop (sockets, servidores, timers con ref); si queda algo:
 *   1. lo lista por stderr (tipo y destino, p. ej. `Socket -> 127.0.0.1:6379`),
 *   2. sale con código 1 — la corrida termina en ROJO, con diagnóstico, en vez de colgarse.
 * El `process.exit(1)` solo se alcanza cuando ya hay un defecto: no es `--forceExit` (que saldría verde
 * con el handle dentro); es convertir un cuelgue mudo en un rojo que dice qué quedó abierto.
 *
 * Lo que NO cuenta: stdio (`_isStdio`) y handles sin ref (`unref()`): no impiden salir.
 * Canario y mediciones: docs/BACKEND_NOTES.md §Handles.
 */

const GRACE_MS = Number(process.env.OPEN_HANDLES_GRACE_MS ?? 3000);
const POLL_MS = 100;

interface HandleLike {
  constructor?: { name?: string };
  _isStdio?: boolean;
  _handle?: { hasRef?: () => boolean } | null;
  hasRef?: () => boolean;
  remoteAddress?: string;
  remotePort?: number;
  address?: () => unknown;
}

function describe(h: HandleLike): string {
  const name = h?.constructor?.name ?? typeof h;
  if (h?.remotePort) return `${name} -> ${h.remoteAddress}:${h.remotePort}`;
  if (typeof h?.address === 'function') {
    try {
      const a = h.address() as { port?: number } | null;
      if (a && typeof a === 'object' && a.port) return `${name} :${a.port}`;
    } catch {
      /* sin dirección */
    }
  }
  return name;
}

/** Lo que hoy mantiene vivo el event loop, sin stdio ni handles `unref`. Exportado para su prueba unitaria. */
export function liveResources(): string[] {
  const out: string[] = [];
  const getHandles = (process as unknown as { _getActiveHandles?: () => HandleLike[] })._getActiveHandles;
  for (const h of getHandles ? getHandles.call(process) : []) {
    if (h?._isStdio) continue;
    const inner = h?._handle ?? h;
    if (inner && typeof inner.hasRef === 'function' && !inner.hasRef()) continue;
    out.push(describe(h));
  }
  // Los timers no salen en `_getActiveHandles` (Node ≥ 11); `getActiveResourcesInfo` solo lista los que
  // tienen ref, que son los que cuelgan la salida.
  for (const r of process.getActiveResourcesInfo()) {
    if (r === 'Timeout' || r === 'Immediate') out.push(r);
  }
  return out;
}

export default async function openHandlesTeardown(): Promise<void> {
  const deadline = Date.now() + GRACE_MS;
  let left = liveResources();
  while (left.length > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    left = liveResources();
  }
  if (left.length === 0) return;
  process.stderr.write(
    `\n[open-handles] ROJO: la suite terminó pero ${left.length} recurso(s) siguen manteniendo vivo el proceso ` +
      `tras ${GRACE_MS} ms:\n${left.map((l) => `  - ${l}`).join('\n')}\n` +
      '[open-handles] Sin este candado el proceso no saldría nunca (CI lo cancela a las 6 h). Cierra lo que ' +
      'se abre: onModuleDestroy en producción o afterAll en el spec. Ver docs/BACKEND_NOTES.md §Handles.\n',
  );
  process.exit(1);
}
