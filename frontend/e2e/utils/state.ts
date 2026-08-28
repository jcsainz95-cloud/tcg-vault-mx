import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Estado COMPARTIDO ENTRE WORKERS de Playwright.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * POR QUÉ EXISTE (bloqueante de QA: «un gate cuyo verde depende de cuántos núcleos tenga
 * la máquina no es un gate»).
 *
 * `playwright.config.ts` corre `fullyParallel: true` y, fuera de CI, `workers: undefined`
 * ⇒ Playwright abre **un worker por núcleo**. Cada worker es un PROCESO: un `Map` a nivel de
 * módulo memoiza **por worker**, no por corrida. Con 3 roles y N workers eso son hasta 3×N
 * canjes de credenciales contra `POST /auth/login`, que el backend limita —legítimamente— a
 * **5 por minuto y por IP** (`@Throttle({ ttl: 60_000, limit: 5 })`, `auth.controller.ts`).
 * Desde 2 workers la suite empieza a comerse su propio cupo y devuelve `429 RATE_LIMITED`:
 * un rojo del ARNÉS que se lee igual que un rojo de producto, y que además dejaba el login
 * del stack inutilizable ~60 s para cualquiera que estuviera mirando en paralelo.
 *
 * La defensa del backend NO se toca (es producto). Lo que se arregla es el arnés: el trabajo
 * caro y rate-limitado se hace **una sola vez por corrida**, y los demás workers **esperan y
 * reutilizan** el resultado. El número de logins pasa a ser función del número de ROLES
 * (3), no del número de núcleos.
 * ─────────────────────────────────────────────────────────────────────────────────────
 *
 * Primitivas:
 *  - `readState`/`writeState`: caché en disco (escritura ATÓMICA vía `rename`, para que otro
 *    worker no lea nunca un JSON a medias).
 *  - `withFileLock`: exclusión mutua entre procesos con `mkdir` (atómico en POSIX y en Win32;
 *    `writeFile` NO lo es). Con detección de candado rancio para que un worker muerto no
 *    cuelgue la suite.
 *  - `sharedOnce`: el patrón completo «lee → si no sirve, toma el candado, vuelve a leer,
 *    calcula y publica». El doble chequeo es lo que evita la estampida: quien esperó el
 *    candado encuentra el valor ya publicado y NO recalcula.
 */

/**
 * Directorio del estado compartido. `E2E_STATE_DIR` permite aislarlo (CI con varias corridas
 * concurrentes en el mismo runner, o para forzar una corrida limpia).
 */
export const STATE_DIR =
  process.env.E2E_STATE_DIR ?? path.join(os.tmpdir(), 'tcg-vault-e2e-state');

function ensureDir(): string {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  return STATE_DIR;
}

/** Nombre de archivo seguro para cualquier clave (los roles/URLs traen `:`, `/`, `@`…). */
function fileFor(name: string): string {
  const safe = crypto.createHash('sha1').update(name).digest('hex').slice(0, 16);
  return path.join(ensureDir(), `${safe}.json`);
}

export interface StateEnvelope<T> {
  /** Epoch ms en que se publicó el valor (TTL lo evalúa quien lee). */
  at: number;
  value: T;
}

export function readState<T>(name: string): StateEnvelope<T> | null {
  try {
    const raw = fs.readFileSync(fileFor(name), 'utf8');
    const parsed = JSON.parse(raw) as StateEnvelope<T>;
    return typeof parsed?.at === 'number' ? parsed : null;
  } catch {
    // No existe, o quedó corrupto de una corrida abortada: se trata como «no hay».
    return null;
  }
}

/** Escritura ATÓMICA: se escribe a un temporal y se renombra (rename es atómico en el mismo FS). */
export function writeState<T>(name: string, value: T): void {
  const target = fileFor(name);
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ at: Date.now(), value } satisfies StateEnvelope<T>));
  fs.renameSync(tmp, target);
}

export function clearState(name: string): void {
  try {
    fs.rmSync(fileFor(name), { force: true });
  } catch {
    /* nada que borrar */
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface LockOptions {
  /** Cuánto espera un worker por el candado antes de rendirse. */
  timeoutMs?: number;
  /** A partir de qué edad un candado se considera de un proceso muerto y se rompe. */
  staleMs?: number;
}

/**
 * Exclusión mutua ENTRE PROCESOS. `mkdir` falla con `EEXIST` si el directorio ya existe y esa
 * comprobación-y-creación es ATÓMICA en el sistema de archivos — que es justo la garantía que
 * un `existsSync` + `writeFileSync` no da (dos workers pueden pasar el `existsSync` a la vez).
 */
export async function withFileLock<T>(
  name: string,
  fn: () => Promise<T>,
  { timeoutMs = 120_000, staleMs = 180_000 }: LockOptions = {},
): Promise<T> {
  const lockPath = `${fileFor(name)}.lock`;
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    try {
      fs.mkdirSync(lockPath);
      break;
    } catch {
      // Candado de un proceso muerto (worker que se cayó a media adquisición): se rompe.
      try {
        const age = Date.now() - fs.statSync(lockPath).mtimeMs;
        if (age > staleMs) fs.rmSync(lockPath, { recursive: true, force: true });
      } catch {
        /* desapareció mientras mirábamos: se reintenta */
      }
      if (Date.now() > deadline) {
        throw new Error(
          `Timeout esperando el candado "${name}" (${timeoutMs} ms). ` +
            `Si quedó rancio, borra ${lockPath}.`,
        );
      }
      await sleep(150);
    }
  }

  try {
    return await fn();
  } finally {
    fs.rmSync(lockPath, { recursive: true, force: true });
  }
}

export interface SharedOnceOptions<T> extends LockOptions {
  /** ¿El valor cacheado sigue sirviendo? Se evalúa ANTES y DESPUÉS de tomar el candado. */
  isFresh: (value: T, publishedAt: number) => boolean;
  /** El trabajo caro / rate-limitado. Corre en EXCLUSIÓN MUTUA y como mucho una vez por corrida. */
  compute: () => Promise<T>;
}

/**
 * «Cómputo caro, una sola vez por corrida y por clave, entre todos los workers».
 *
 * El segundo `readState` (ya con el candado en la mano) es la pieza que evita la estampida:
 * los N-1 workers que se quedaron esperando encuentran el valor recién publicado y devuelven
 * sin llamar a `compute`.
 */
export async function sharedOnce<T>(
  name: string,
  { isFresh, compute, ...lock }: SharedOnceOptions<T>,
): Promise<T> {
  const cached = readState<T>(name);
  if (cached && isFresh(cached.value, cached.at)) return cached.value;

  return withFileLock(
    name,
    async () => {
      const again = readState<T>(name);
      if (again && isFresh(again.value, again.at)) return again.value;
      const value = await compute();
      writeState(name, value);
      return value;
    },
    lock,
  );
}
