// @vitest-environment node
/**
 * C-D1 · puerta de BUILD de la medición (ARCHITECTURE §14.1, D-MKT2-0b). La corre
 * `scripts/measurement-notice-gate.mjs` (paso `prebuild` de `npm run build`) SOLO con
 * `NEXT_PUBLIC_MEASUREMENT_MODE=on`; en la suite normal se salta y lo dice.
 *
 *     MEASUREMENT_NOTICE_CHECK=1 NEXT_PUBLIC_MEASUREMENT_MODE=on npx vitest run src/content/legal/measurement-notice.gate.test.ts
 *
 * Imprime el rótulo de MKT2-UX.12 (`MEASUREMENT_NOTICE_REQUIRED` / `MEASUREMENT_NOTICE_OK`) y queda
 * ROJO si el aviso que se va a publicar no declara la medición. Las reglas están en
 * `measurement-gate.ts` (probadas en `measurement-gate.test.ts`); aquí se les pasa el aviso REAL.
 */
import { describe, expect, it } from 'vitest';
import { privacyNoticeEs } from './privacidad.es';
import { formatMeasurementNoticeReport, measurementGateProblems } from './measurement-gate';
import { parseMeasurementMode } from '@/lib/measurement/mode';

const enabled = process.env.MEASUREMENT_NOTICE_CHECK === '1';

describe.runIf(enabled)('C-D1 · el aviso declara la medición antes de encenderla', () => {
  it('measurementGateProblems = [] para el modo del build', () => {
    const mode = parseMeasurementMode(process.env.NEXT_PUBLIC_MEASUREMENT_MODE);
    const problems = measurementGateProblems(mode, privacyNoticeEs);
    const report = formatMeasurementNoticeReport(mode, problems, privacyNoticeEs.measurementDisclosure?.version ?? null);
    process.stdout.write(`${report.join('\n')}\n`);
    expect(problems).toEqual([]);
  });
});

describe.skipIf(enabled)('C-D1 · puerta de build de la medición', () => {
  it.skip('se mide con `MEASUREMENT_NOTICE_CHECK=1` (lo lanza `npm run build` vía prebuild cuando el modo es on)', () => {});
});
