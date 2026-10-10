import { notFound } from 'next/navigation';

/**
 * CSP · la 404 con nonce (FRONTEND_NOTES §113, medido 2026-10-10).
 *
 * Sin esta ruta, una URL desconocida bajo `/{locale}/…` no casa con ningún segmento y Next sirve su
 * `_not-found` ESTÁTICO (prerenderizado en el build, `○ /_not-found`): HTML horneado cuyos `<script>`
 * no llevan nonce. El middleware sí pone la CSP con nonce en esa respuesta ⇒ en `report-only`, una
 * violación por script (`script-src-elem inline` y `script-src-elem <origen propio>`); en `enforce`,
 * la 404 sin JS.
 *
 * El catch-all hace que la URL SÍ case dentro de `[locale]`: `notFound()` se lanza durante un render
 * POR PETICIÓN (el layout lee `headers()`), así que la 404 sale con el layout de `[locale]` y con el
 * nonce de su respuesta, y conserva el estado 404. Las rutas concretas tienen prioridad sobre el
 * catch-all; este solo recoge lo que nadie más reclama.
 *
 * Candado: `e2e/csp.spec.ts` CSP-2 (tres rutas 404). Borrar este fichero la pone roja.
 */
export default function CatchAllNotFound(): never {
  notFound();
}
