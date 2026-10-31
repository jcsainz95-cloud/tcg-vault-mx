/**
 * Interruptor de emergencia del optimizador de imágenes — ARCHITECTURE §4.DYN (f) 7, residual de PEN-DYN-1 (v1.114.5).
 *
 * scrydex responde 200 con una imagen genérica a CUALQUIER id con la forma (`/pokemon/me3-99999/large`), así que
 * `remotePatterns` acota la forma de las URLs pero no su cuenta. Si la alerta de gasto salta o la lectura de 7 días
 * de devops pasa de ~1 000 transformaciones/día, se enciende ESTO en el despliegue:
 *
 *   NEXT_PUBLIC_IMAGE_OPTIMIZER_KILL_SWITCH=on   (en el entorno del despliegue, build Y arranque; redesplegar)
 *
 * Build y arranque, las dos: la líder se hornea en el build, y `next start` RELEE `next.config.mjs` al arrancar
 * (medido 2026-10-31: build con `on` + `next start` sin la variable ⇒ `/_next/image` 200); `standalone` usa la config
 * del build.
 *
 * y hace DOS cosas a la vez (⛔ una sola no basta, dice el arquitecto):
 *  1. `next.config.mjs` deja `images.remotePatterns` vacío ⇒ `/_next/image` responde 400 a todo origen remoto
 *     (`"url" parameter is not allowed`), lo pida nuestra página o un tercero.
 *  2. la foto de la teja líder vuelve a nivel B (`CardImage` sin `optimized`): `<img>` crudo con la URL original,
 *     sin `/_next/image` y sin `srcset` — pesa como antes de v1.114.2, pero no queda rota.
 *
 * Valores: `on` | `off` | vacío (= `off`). Cualquier otro valor (`ON`, `true`, `1`…) hace FALLAR el build: en una
 * emergencia, un error tipográfico que dejara el interruptor apagado en silencio sería peor que un build rojo.
 * Por defecto APAGADO. Candado: `src/lib/next-image-remote-patterns.test.ts` (bloque «Interruptor»).
 */

export const IMAGE_OPTIMIZER_KILL_SWITCH_ENV = 'NEXT_PUBLIC_IMAGE_OPTIMIZER_KILL_SWITCH';

/**
 * Normaliza el valor de la variable a `'on'` | `'off'`; lanza con cualquier otro.
 * @param {string | undefined} value
 * @returns {'on' | 'off'}
 */
export function imageOptimizerKillSwitchOf(value) {
  if (value === undefined || value === '' || value === 'off') return 'off';
  if (value === 'on') return 'on';
  throw new Error(
    `${IMAGE_OPTIMIZER_KILL_SWITCH_ENV} solo admite "on" u "off" (o vacía); se recibió otro valor. Corrígelo y vuelve a construir.`,
  );
}

/**
 * ¿La teja líder pide su foto a `/_next/image`? `false` con el interruptor encendido.
 * `process.env.NEXT_PUBLIC_IMAGE_OPTIMIZER_KILL_SWITCH` va LITERAL para que el build lo hornee (`next.config.mjs`
 * lo fija siempre a `on`|`off` en `env`), igual en servidor y cliente.
 * @returns {boolean}
 */
export function leadImageOptimized() {
  return process.env.NEXT_PUBLIC_IMAGE_OPTIMIZER_KILL_SWITCH !== 'on';
}
