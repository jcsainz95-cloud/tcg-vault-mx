#!/usr/bin/env node
/**
 * lhci-config.mjs — los umbrales de la portada, UNA sola fuente (PROJECT 936-938, API_CONTRACT §DYN.7) · devops
 *
 *   node lhci-config.mjs <perfil mobile|desktop> <tipo d1|d2> <chromePath> <puerto de imágenes>
 *        imprime el lighthouserc (JSON) de esa medición
 *   node lhci-config.mjs --modo-celular
 *        imprime una línea: `trinquete fcp=<ms> lcp=<ms> sha=<sha> fecha=<fecha>` o `meta fcp=1000 lcp=2500`
 *
 * DYN-D1 (v1.114.2), todas sobre la MEDIANA (`aggregationMethod: "median"`):
 *   bloquean   escritorio FCP ≤ 1.0 s y LCP ≤ 1.5 s · CLS ≤ 0.1 en los dos perfiles
 *              celular: TRINQUETE de FCP y LCP = mediana medida con A + c1, +10 % (`mobile-ratchet.json`).
 *              Mientras el trinquete no esté fijado (null), celular bloquea con la META de 936.
 *   reporte    la meta de 936 en celular (FCP ≤ 1.0 s, LCP ≤ 2.5 s): `run.sh` la escribe en el resumen como
 *              «NO CUMPLIDA, decisión del dueño 2026-10-30» con el número. Caduca: `check-home-perf-mobile-goal-
 *              expiry.sh` (job `home-perf-mobile-goal-expiry`) se pone rojo desde 2027-01-01 si sigue el trinquete.
 * DYN-D2 (937): FCP (el bloqueante del perfil: escritorio 1.0 s; celular el trinquete, o la meta sin él) y
 *   CLS ≤ 0.1; sin LCP (la imagen llega tarde a propósito).
 * Perfiles: celular = el estándar de Lighthouse (sin preset); escritorio = `preset: "desktop"`.
 * Candado: scripts/check-home-perf.sh lee esta salida y exige estos números.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const META_936 = { mobile: { fcp: 1000, lcp: 2500 }, desktop: { fcp: 1000, lcp: 1500 }, cls: 0.1 };
const HERE = dirname(fileURLToPath(import.meta.url));

export function trinquete(file = join(HERE, 'mobile-ratchet.json')) {
  const r = JSON.parse(readFileSync(file, 'utf8'));
  const fijado = Number.isInteger(r.fcpMs) && Number.isInteger(r.lcpMs);
  return { ...r, fijado };
}

/** Los umbrales que BLOQUEAN, por perfil. */
export function limites(t = trinquete()) {
  return {
    mobile: t.fijado ? { fcp: t.fcpMs, lcp: t.lcpMs } : { ...META_936.mobile },
    desktop: { ...META_936.desktop },
    cls: META_936.cls,
  };
}

function cli(args) {
  if (args[0] === '--modo-celular') {
    const t = trinquete();
    process.stdout.write(
      t.fijado
        ? `trinquete fcp=${t.fcpMs} lcp=${t.lcpMs} sha=${t.sha} fecha=${t.fecha}\n`
        : `meta fcp=${META_936.mobile.fcp} lcp=${META_936.mobile.lcp}\n`,
    );
    process.exit(0);
  }
  const [perfil, tipo, chromePath, imgPort] = args;
  const L = limites();
  if (!L[perfil] || !['d1', 'd2'].includes(tipo) || !chromePath || !imgPort) {
    process.stderr.write('uso: lhci-config.mjs <mobile|desktop> <d1|d2> <chromePath> <puerto imágenes> | --modo-celular\n');
    process.exit(2);
  }
  const a = (v) => ['error', { maxNumericValue: v, aggregationMethod: 'median' }];
  const assertions = {
    'first-contentful-paint': a(L[perfil].fcp),
    'cumulative-layout-shift': a(L.cls),
  };
  if (tipo === 'd1') assertions['largest-contentful-paint'] = a(L[perfil].lcp);
  // Los tres hosts de imagen van a `seed-image-host.py` (HTTPS local): el del seed y los dos de `remotePatterns`
  // (el proxy del API reescribe el del seed a images.scrydex.com, DYN-D3). Nada de imagen sale a internet.
  const mapas = ['img.e2e.local', 'images.scrydex.com', 'images.pokemontcg.io'].map((h) => `MAP ${h} 127.0.0.1:${imgPort}`);
  const settings = {
    onlyCategories: ['performance'],
    maxWaitForLoad: 60000,
    // CADENA, no lista: lhci le concatena « --headless=new» (una lista se volvería «a,b,c»: medido, Chrome
    // arrancó sin `--no-sandbox` y murió como root). Lighthouse la parte con yargs, que respeta las comillas.
    // `--no-proxy-server`: con HTTPS_PROXY en el entorno (el contenedor de los agentes) Chrome mandaba
    // el host de imágenes al proxy y la imagen fallaba (-1, medido); en CI no cambia nada.
    chromeFlags: [
      '--no-sandbox',
      '--no-proxy-server',
      '--disable-dev-shm-usage',
      '--ignore-certificate-errors',
      `--host-resolver-rules="${mapas.join(', ')}"`,
    ].join(' '),
  };
  if (perfil === 'desktop') settings.preset = 'desktop';
  process.stdout.write(JSON.stringify({ ci: { collect: { chromePath, settings }, assert: { assertions } } }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) cli(process.argv.slice(2));
