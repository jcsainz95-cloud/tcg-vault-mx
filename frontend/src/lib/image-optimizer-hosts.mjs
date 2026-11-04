/**
 * Orígenes que acepta el optimizador de imágenes (`/_next/image`) — FUENTE ÚNICA de `images.remotePatterns`.
 *
 * `next.config.mjs` los re-exporta y los aplica al servidor; `CardImage` (cliente) los consulta ANTES de pedir una
 * foto al optimizador: una URL cuyo origen no está aquí recibiría 400 («"url" parameter is not allowed») y la teja
 * caería al respaldo (la original) ⇒ dos peticiones por foto, una inútil. Con la comprobación, esa teja va a nivel B
 * (`<img>` cruda) directamente, sin gastar el 400. Un host nuevo en el catálogo haría exactamente eso en silencio.
 *
 * Este módulo NO importa nada de Node (va al bundle del cliente). Candado de paridad con el matcher de Next:
 * `src/lib/next-image-remote-patterns.test.ts` (bloque «Hosts en el cliente»).
 */
import { imageOptimizerKillSwitchOf } from './image-optimizer-switch.mjs';

/**
 * Lista de orígenes del optimizador (ver el comentario largo en `images` de `next.config.mjs`: procedencia,
 * `port: ''`, PEN-DYN-1). Candado: `src/lib/next-image-remote-patterns.test.ts`.
 * @type {ReadonlyArray<{ protocol: 'https'; hostname: string; port: string; pathname: string; search: string }>}
 */
export const REMOTE_PATTERNS = [
  {
    protocol: 'https',
    hostname: 'images.pokemontcg.io',
    port: '',
    pathname: '/+([a-z0-9])/+([A-Za-z0-9!_-]).png',
    search: '',
  },
  {
    protocol: 'https',
    hostname: 'images.scrydex.com',
    port: '',
    pathname: '/pokemon/+([a-z0-9])-+([A-Za-z0-9])/@(large|small)',
    search: '',
  },
  {
    protocol: 'https',
    hostname: 'images.scrydex.com',
    port: '',
    pathname: '/e2e/+([a-z0-9-])?(_hires).png',
    search: '',
  },
];

/**
 * Interruptor de emergencia, ARCHITECTURE §4.DYN (f) 7 (v1.114.5, residual de PEN-DYN-1): con
 * `NEXT_PUBLIC_IMAGE_OPTIMIZER_KILL_SWITCH=on` en el BUILD, `remotePatterns` queda VACÍO ⇒ `/_next/image` responde 400
 * a todo origen remoto; la otra mitad (líder y tejas a nivel B) la lee `CardImage` vía `leadImageOptimized()` e
 * `imageOptimizerAccepts()`. Apagado por defecto. Valores: `src/lib/image-optimizer-switch.mjs`.
 * @param {Record<string, string | undefined>} [env]
 */
export const remotePatternsFor = (env = process.env) =>
  imageOptimizerKillSwitchOf(env.NEXT_PUBLIC_IMAGE_OPTIMIZER_KILL_SWITCH) === 'on' ? [] : REMOTE_PATTERNS;

/** @param {{ protocol: string; hostname: string; port?: string }} p */
const originOf = (p) => `${p.protocol}://${p.hostname}${p.port ? `:${p.port}` : ''}`;

/**
 * Orígenes (`https://<hostname>[:puerto]`, el `URL.origin` exacto) de `remotePatternsFor(env)`, sin repetir. Vacío
 * con el interruptor encendido. Es lo que el cliente compara: el `pathname` de cada patrón NO se comprueba aquí
 * (haría falta el picomatch de Next en el bundle); una URL de host admitido con otra forma sigue yendo al optimizador
 * y cae al respaldo si responde 400.
 * @param {Record<string, string | undefined>} [env]
 * @returns {string[]}
 */
export function imageOptimizerOrigins(env = process.env) {
  return [...new Set(remotePatternsFor(env).map(originOf))];
}

/**
 * ¿Pediría `CardImage` ESTA `src` a `/_next/image`? `true` solo si el interruptor está apagado y el origen (protocolo,
 * host y puerto exactos) es uno de `REMOTE_PATTERNS`. Un `src` ilegible ⇒ `false` (nivel B).
 * `process.env.NEXT_PUBLIC_IMAGE_OPTIMIZER_KILL_SWITCH` va LITERAL para que el build lo hornee, como en
 * `leadImageOptimized()`.
 * @param {string} src
 * @returns {boolean}
 */
export function imageOptimizerAccepts(src) {
  if (process.env.NEXT_PUBLIC_IMAGE_OPTIMIZER_KILL_SWITCH === 'on') return false;
  let origin;
  try {
    origin = new URL(src).origin;
  } catch {
    return false;
  }
  return REMOTE_PATTERNS.some((p) => originOf(p) === origin);
}
