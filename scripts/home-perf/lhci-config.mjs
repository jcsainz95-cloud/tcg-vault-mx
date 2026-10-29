#!/usr/bin/env node
/**
 * lhci-config.mjs <perfil mobile|desktop> <tipo d1|d2> <chromePath> <puerto de imágenes> — imprime el
 * lighthouserc (JSON) de una medición de la portada · devops
 *
 * UNA sola fuente para los umbrales (PROJECT criterios 936-938, API_CONTRACT §DYN.7 DYN-D1/DYN-D2):
 *   d1  móvil FCP ≤ 1.0 s, LCP ≤ 2.5 s · escritorio FCP ≤ 1.0 s, LCP ≤ 1.5 s · CLS ≤ 0.1
 *   d2  FCP ≤ 1.0 s y CLS ≤ 0.1 (937: con Destacadas y la vitrina retrasadas o en 503, el primer pintado
 *       sigue cumpliendo 936 y al llegar los datos no se mueve nada; el LCP no se exige: es la imagen que
 *       llega tarde a propósito)
 * Todas sobre la MEDIANA de las corridas (`aggregationMethod: "median"`). Perfiles: el móvil es el
 * estándar de Lighthouse (sin preset); el escritorio, `preset: "desktop"`.
 * Candado: scripts/check-home-perf.sh lee esta salida y exige estos números.
 */
const [perfil, tipo, chromePath, imgPort] = process.argv.slice(2);
export const LIMITES = { mobile: { fcp: 1000, lcp: 2500 }, desktop: { fcp: 1000, lcp: 1500 }, cls: 0.1 };
if (!LIMITES[perfil] || !['d1', 'd2'].includes(tipo) || !chromePath || !imgPort) {
  process.stderr.write('uso: lhci-config.mjs <mobile|desktop> <d1|d2> <chromePath> <puerto imágenes>\n');
  process.exit(2);
}
const a = (v) => ['error', { maxNumericValue: v, aggregationMethod: 'median' }];
const assertions = {
  'first-contentful-paint': a(LIMITES[perfil].fcp),
  'cumulative-layout-shift': a(LIMITES.cls),
};
if (tipo === 'd1') assertions['largest-contentful-paint'] = a(LIMITES[perfil].lcp);
const settings = {
  onlyCategories: ['performance'],
  maxWaitForLoad: 60000,
  // CADENA, no lista: lhci le concatena « --headless=new» (una lista se volvería «a,b,c»: medido, Chrome
  // arrancó sin `--no-sandbox` y murió como root). Lighthouse la parte con yargs, que respeta las comillas.
  // `--no-proxy-server`: con HTTPS_PROXY en el entorno (el contenedor de los agentes) Chrome mandaba
  // img.e2e.local al proxy y la imagen fallaba (-1, medido); en CI no cambia nada.
  chromeFlags: [
    '--no-sandbox',
    '--no-proxy-server',
    '--disable-dev-shm-usage',
    '--ignore-certificate-errors',
    `--host-resolver-rules="MAP img.e2e.local 127.0.0.1:${imgPort}"`,
  ].join(' '),
};
if (perfil === 'desktop') settings.preset = 'desktop';
process.stdout.write(JSON.stringify({ ci: { collect: { chromePath, settings }, assert: { assertions } } }, null, 2));
