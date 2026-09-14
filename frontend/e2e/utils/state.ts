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

/**
 * ─────────────────────────────────────────────────────────────────────────────────────
 * IMP-A (QA) — ESTE DIRECTORIO GUARDA CREDENCIALES DE VERDAD, ASÍ QUE SE TRATA COMO TAL.
 *
 * `sessionFor` (`./env`) publica aquí el `TokenPair` COMPLETO —access **y refresh**— del seed,
 * incluido el de `super_admin`. Con el modo por defecto eso quedaba `0644` en un `/tmp`
 * compartido: **legible por cualquier usuario de la máquina**. Hoy son credenciales sintéticas
 * y el riesgo es bajo, pero `scripts/stack-native.sh` y `DEVOPS_NOTES` documentan correr esta
 * misma suite con `E2E_BASE_URL` apuntando a **staging**, y ahí lo que queda world-readable es
 * el refresh token de un `super_admin` de staging — es decir, sesión renovable, no un access
 * token que caduca en 15 min.
 *
 * Tres medidas, y ninguna es opcional:
 *  1. **Directorio `0700`** y **archivos `0600`** (el `chmod` explícito además del `mode`: el
 *     `mode` de `mkdir`/`writeFile` sólo aplica **al crear** y lo recorta el `umask`, así que un
 *     directorio o un temporal heredado de una corrida anterior seguiría siendo `0644`).
 *  2. **Purga en el `globalTeardown`** (`clearStateByPrefix('session:')`): el token no sobrevive
 *     a la corrida que lo creó. Antes se limpiaban `dial` y `scenario` y **nunca** la sesión.
 *  3. Cada entrada guarda su **clave lógica** en el sobre, porque el nombre del archivo es un
 *     hash: sin eso no hay forma de purgar «todas las sesiones» sin poder hablar con la API.
 * ─────────────────────────────────────────────────────────────────────────────────────
 */
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

function ensureDir(): string {
  fs.mkdirSync(STATE_DIR, { recursive: true, mode: DIR_MODE });
  try {
    // `mode` de `mkdirSync` sólo aplica a la CREACIÓN (y lo recorta el `umask`): un directorio
    // que quedó de una corrida anterior con `0755` hay que estrecharlo a mano.
    fs.chmodSync(STATE_DIR, DIR_MODE);
  } catch {
    /* otro dueño / FS sin permisos POSIX (Win32): no es motivo para tumbar la suite */
  }
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
  /**
   * Clave LÓGICA de la entrada (`session:…`, `grading:scenario:…`). Va dentro del sobre porque el
   * nombre del archivo es un **hash** irreversible: sin esto, «purga todas las sesiones» sólo se
   * podría hacer recalculando cada clave —lo que exige resolver la API base y, si el stack ya se
   * cayó, dejaría los tokens en disco justo en el caso en que más molesta—.
   * Opcional al LEER: un archivo de una corrida anterior no lo trae y debe seguir siendo válido.
   */
  name?: string;
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

/**
 * Escritura ATÓMICA: se escribe a un temporal y se renombra (rename es atómico en el mismo FS).
 * **`0600` desde el primer byte** (y `chmod` explícito por si el temporal ya existía de una
 * corrida abortada): aquí dentro viajan tokens reales — ver la nota de IMP-A arriba.
 */
export function writeState<T>(name: string, value: T): void {
  const target = fileFor(name);
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(
    tmp,
    JSON.stringify({ at: Date.now(), name, value } satisfies StateEnvelope<T>),
    { mode: FILE_MODE },
  );
  try {
    fs.chmodSync(tmp, FILE_MODE);
  } catch {
    /* FS sin permisos POSIX */
  }
  // `rename` CONSERVA el modo del origen, así que el destino queda 0600 también.
  fs.renameSync(tmp, target);
}

export function clearState(name: string): void {
  try {
    fs.rmSync(fileFor(name), { force: true });
  } catch {
    /* nada que borrar */
  }
}

/** Recorre los archivos del estado (incluidos los `.tmp`) y entrega el sobre ya parseado. */
function forEachStateFile(fn: (envelope: StateEnvelope<unknown>, path: string) => void): void {
  let entries: string[];
  try {
    entries = fs.readdirSync(STATE_DIR);
  } catch {
    return; // el directorio no existe: nada que recorrer
  }
  for (const entry of entries) {
    // Los `.tmp` cuentan: un worker que muriera a media escritura deja ahí el MISMO contenido
    // —tokens incluidos— y el `rename` nunca llegó a limpiarlo.
    if (!entry.endsWith('.json') && !entry.endsWith('.tmp')) continue;
    const full = path.join(STATE_DIR, entry);
    try {
      fn(JSON.parse(fs.readFileSync(full, 'utf8')) as StateEnvelope<unknown>, full);
    } catch {
      /* archivo a medias, corrupto o borrado por otro proceso: se ignora */
    }
  }
}

/**
 * Borra TODA entrada cuya **clave lógica** empiece por `prefix`, sin necesitar la clave exacta
 * (IMP-A: el `globalTeardown` tiene que poder purgar `session:*` aunque el stack ya no conteste y
 * no se pueda resolver la API base con la que se formó la clave).
 *
 * Devuelve cuántos archivos se llevó, para que el llamador pueda decirlo en voz alta.
 */
export function clearStateByPrefix(prefix: string): number {
  let removed = 0;
  forEachStateFile((envelope, full) => {
    if (typeof envelope?.name !== 'string' || !envelope.name.startsWith(prefix)) return;
    fs.rmSync(full, { force: true });
    removed += 1;
  });
  return removed;
}

/**
 * Red de seguridad **por CONTENIDO**: borra toda entrada que guarde un token, se llame como se
 * llame. Cubre los dos casos que una purga por prefijo no puede ver:
 *  - archivos de corridas **anteriores a este arreglo**, que no llevan `name` en el sobre (son
 *    justo los que QA encontró con `0644` y sin dueño que los limpiara), y
 *  - cualquier consumidor futuro que cachee credenciales bajo otra clave.
 *
 * La garantía que se persigue es «al terminar la corrida no queda un token en disco», y ésa se
 * afirma sobre el contenido, no sobre el nombre del archivo.
 */
export function clearTokenState(): number {
  let removed = 0;
  forEachStateFile((envelope, full) => {
    const value = envelope?.value as Record<string, unknown> | null | undefined;
    if (!value || typeof value !== 'object') return;
    if (typeof value.accessToken !== 'string' && typeof value.refreshToken !== 'string') return;
    fs.rmSync(full, { force: true });
    removed += 1;
  });
  return removed;
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

/**
 * ═════════════════════════════════════════════════════════════════════════════════════
 * CUPO DE `POST /auth/login` COMPARTIDO ENTRE WORKERS (B-2 · causa raíz de los plantones de 60 s)
 * ═════════════════════════════════════════════════════════════════════════════════════
 *
 * **EL DEFECTO QUE ESTO CIERRA, medido (2026-09-14, stack `9328880`, `:3099`):**
 *   · `POST /auth/login` responde `200 200 200 200 200 429 429 429 429 429` a diez intentos
 *     seguidos, y vuelve a `200` **62 s** después ⇒ el throttler del producto es
 *     `{ ttl: 60_000, limit: 5 }` por IP (`backend/src/modules/auth/auth.controller.ts:25`),
 *     y **un intento bloqueado NO alarga la ventana**.
 *   · `sharedOnce` ya acotaba los canjes **por API** a uno por rol… pero **hay SEIS roles**
 *     (`SeedRole`) y, sobre todo, **los logins por FORMULARIO no pasaban por ahí**: cada test que
 *     teclea credenciales —que es el producto bajo prueba— gasta cupo sin que nadie lo cuente.
 *   · Cuando el cupo se agota, `loginViaApi` entra en su escalera de reintentos
 *     `1+2+4+8+16+32 = 63 s`… **más larga que el `timeout: 60_000` de un test**. Resultado
 *     medido en la traza: el test se queda **60 s sin emitir UNA SOLA llamada de Playwright** y
 *     muere con «Test timeout of 60000ms exceeded» **sin decir por qué**. La pantalla se queda en
 *     «Verificando sesión…» simplemente porque nunca se navegó.
 *   · Reproducido **3/3** con 2 workers (6 rojas cada vez) y **1/1** con `--workers=1` (2 rojas,
 *     otras distintas): NO es intermitencia, es **inanición de cupo** — y por eso cambia de
 *     víctima según el orden.
 *
 * **LA REGLA:** el arnés **obedece el límite del producto** en vez de chocar contra él. El
 * throttler ⛔ no se toca (es una defensa legítima, y el arnés que lo viola es el que está mal).
 *
 * **Por qué un fichero compartido y no un contador en memoria:** cada worker de Playwright es un
 * PROCESO. Un contador por proceso cuenta una fracción del gasto real y deja pasar la estampida
 * — exactamente el mismo error que `sharedOnce` vino a arreglar para los canjes por API.
 */
const LOGIN_BUDGET_KEY = 'login-budget:v1';

/** Límite del producto: `@Throttle({ ttl: 60_000, limit: 5 })` sobre `POST /auth/login`. */
const LOGIN_LIMIT = Number(process.env.E2E_LOGIN_LIMIT ?? 5);

/**
 * Ventana con MARGEN: el throttler mide 60 000 ms desde el primer impacto y el arnés no comparte
 * su reloj. 6 s de colchón cuestan poco y evitan que el intento «justo en el filo» sea el que
 * arranque otra ventana de inanición.
 */
const LOGIN_WINDOW_MS = Number(process.env.E2E_LOGIN_WINDOW_MS ?? 66_000);

/** Ranuras ya gastadas (epoch ms), las viejas podadas. */
function liveSlots(now: number): number[] {
  const stored = readState<number[]>(LOGIN_BUDGET_KEY);
  const slots = Array.isArray(stored?.value) ? stored!.value : [];
  return slots.filter((at) => typeof at === 'number' && now - at < LOGIN_WINDOW_MS);
}

/**
 * Reserva UNA ranura de `POST /auth/login`. Bloquea hasta que la haya, o **lanza diciendo
 * exactamente qué pasa** si la espera no cabe en el presupuesto.
 *
 * ⛔ **No se rinde en silencio y ⛔ no se salta el test.** Un `skip` aquí convertiría la inanición
 * de cupo en un verde, que es la avería que todo este bloque existe para impedir.
 *
 * @param label quién pide la ranura (rol o nombre del flujo). Sale en el mensaje de error.
 * @param maxWaitMs techo de espera. Por defecto **75 s**: una ventana COMPLETA del throttler
 *   (66 s con margen) más holgura. Cabe dentro del `timeout: 120_000` que `playwright.config.ts`
 *   aplica cuando se habla con el backend real — y ése es el punto: la escalera vieja de 63 s
 *   convivía con un `timeout` de 60 s, o sea **no podía completarse nunca**.
 */
export async function reserveLoginSlot(label: string, maxWaitMs = 75_000): Promise<void> {
  const deadline = Date.now() + maxWaitMs;
  for (;;) {
    const waitMs = await withFileLock(
      LOGIN_BUDGET_KEY,
      async () => {
        const now = Date.now();
        const slots = liveSlots(now);
        if (slots.length < LOGIN_LIMIT) {
          writeState(LOGIN_BUDGET_KEY, [...slots, now]);
          if (process.env.E2E_LOGIN_DEBUG === '1') {
            console.log(`[e2e][login-budget] «${label}» toma la ranura ${slots.length + 1}/${LOGIN_LIMIT}`);
          }
          return 0;
        }
        // La ranura más vieja es la primera que sale de la ventana.
        return Math.max(250, Math.min(...slots) + LOGIN_WINDOW_MS - now);
      },
      { timeoutMs: 60_000 },
    );
    if (waitMs === 0) return;
    if (process.env.E2E_LOGIN_DEBUG === '1') {
      console.log(`[e2e][login-budget] «${label}» espera ${Math.ceil(waitMs / 1000)} s (cupo lleno)`);
    }
    if (Date.now() + waitMs > deadline) {
      throw new Error(
        `Cupo de POST /auth/login agotado y la espera (${Math.ceil(waitMs / 1000)} s) no cabe en ` +
          `el presupuesto de «${label}». El producto limita ese endpoint a ${LOGIN_LIMIT} por ` +
          `${Math.round(LOGIN_WINDOW_MS / 1000)} s POR IP y todos los workers salen de la misma; ` +
          `esto NO es un fallo de la UI. Corre con menos workers, o reduce los logins del subset ` +
          `(cada login por FORMULARIO gasta cupo igual que uno por API).`,
      );
    }
    await sleep(waitMs);
  }
}

/** Cuántas ranuras de login se han gastado en la ventana viva. Para decirlo en voz alta. */
export function loginSlotsUsed(): number {
  return liveSlots(Date.now()).length;
}

/** Olvida el gasto acumulado (lo llama el `globalTeardown`: el cupo no es de nadie entre corridas). */
export function clearLoginBudget(): void {
  clearState(LOGIN_BUDGET_KEY);
}
