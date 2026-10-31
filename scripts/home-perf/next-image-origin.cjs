/**
 * next-image-origin.cjs — SOLO para el `next start` del arnés de la portada (DYN-D3) · devops
 *
 * El optimizador de Next (`/_next/image`, §DYN.6.6) baja la foto líder DESDE EL SERVIDOR, con el `fetch`
 * global, al host de la URL (`images.scrydex.com` tras la reescritura del proxy del API). En el arnés ese
 * host no puede ser internet: `seed-image-host.py` sirve los bytes de peso real en 127.0.0.1. Este módulo se
 * carga con `NODE_OPTIONS=--require …` SOLO en el `next start` de `run.sh` y desvía al origen local las
 * peticiones del servidor a los dos hosts de `remotePatterns`. Es el equivalente, del lado del servidor, del
 * `--host-resolver-rules` del Chrome de Lighthouse. No toca nada más: ni la validación de `remotePatterns`
 * (que ve la URL original), ni `sharp`, ni la respuesta.
 *
 * ⛔ Fuera del producto por construcción: vive en scripts/, ningún código de frontend/ lo importa (lo
 * vigila scripts/check-home-perf.sh) y se niega a cargar si `HOME_PERF_IMG_ORIGIN` no es http://127.0.0.1:<p>.
 * Cada desvío se anota en `HOME_PERF_IMG_LOG` para que el informe pueda decir que el optimizador fue al origen.
 */
'use strict';
const { appendFileSync } = require('node:fs');

const origen = process.env.HOME_PERF_IMG_ORIGIN || '';
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origen)) {
  throw new Error(`next-image-origin: HOME_PERF_IMG_ORIGIN «${origen}» no es http://127.0.0.1:<puerto>; solo es del arnés`);
}
const HOSTS = new Set(['images.scrydex.com', 'images.pokemontcg.io']);
const registro = process.env.HOME_PERF_IMG_LOG || '';
const original = globalThis.fetch;

globalThis.fetch = function fetchDelArnes(input, init) {
  const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input && input.url;
  let u = null;
  try {
    u = new URL(href);
  } catch {
    u = null;
  }
  if (u && u.protocol === 'https:' && HOSTS.has(u.hostname)) {
    const destino = `${origen}${u.pathname}${u.search}`;
    if (registro) appendFileSync(registro, `${new Date().toISOString()} ${href} -> ${destino}\n`);
    return original.call(this, destino, init);
  }
  return original.call(this, input, init);
};
