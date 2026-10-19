#!/usr/bin/env node
/**
 * C-D1 · paso `prebuild` de `npm run build` (ARCHITECTURE §14.1, D-MKT2-0b; rótulo DESIGN_SYSTEM
 * MKT2-UX.12). Encender la medición exige el aviso nuevo: con `NEXT_PUBLIC_MEASUREMENT_MODE=on` corre
 * `measurement-notice.gate.test.ts` sobre el aviso real y, si tiene problemas, el build FALLA (Vercel
 * no publica un build fallido). Con cualquier otro valor imprime `MEASUREMENT_NOTICE_OK mode=off` y
 * sale 0 sin lanzar nada.
 *
 * ⛔ No imprime valores de variables: solo el modo (C-F17).
 * Nota: `npx next build` directo NO pasa por aquí (lo usan los E2E, que no publican).
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const mode = process.env.NEXT_PUBLIC_MEASUREMENT_MODE === 'on' ? 'on' : 'off';
if (mode === 'off') {
  console.log('MEASUREMENT_NOTICE_OK mode=off');
  process.exit(0);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const res = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['vitest', 'run', 'src/content/legal/measurement-notice.gate.test.ts', '--reporter=dot'],
  { cwd: root, stdio: 'inherit', env: { ...process.env, MEASUREMENT_NOTICE_CHECK: '1' } },
);
if (res.status !== 0) {
  console.error('MEASUREMENT_NOTICE_REQUIRED: build detenido (ver el rótulo de arriba).');
  process.exit(res.status ?? 1);
}
