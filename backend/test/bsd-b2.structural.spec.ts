/**
 * bsd-b2.structural.spec.ts — 💰 BSD-B25 (c) (errata BSD-1.3 punto 5, paso B-2): **los estados del motor salen de la política
 * de la clase**. Hermano de `bsd.structural.spec.ts` (B25 (a)/(b)), en fichero propio para no pisar el censo que comparten
 * B-1/B-3.
 *
 * En `shipments/label-*.ts`, `shipment-address.service.ts`, `label-processing.job.ts` (y `carrier-status.service.ts`, el
 * `setTrackingFromProvider` de la misma lista de CAS) no aparece el literal `'picking'` fuera de `label-subject.ts`: el estado
 * «abierta sin guía» es `OPEN_FOR_LABEL_STATUS[kind]` / `labelSubjectOf(row).openStatus` / `openForLabelWhere()`.
 * Mutación: devolver `status: 'picking'` al job de «en proceso» ⇒ rojo aquí (y BSD-B10, de integración, también).
 */
import { join } from 'node:path';
import { sourcesWithoutComments } from './helpers/bsd-census';

const BACKEND = join(__dirname, '..');
const SUBJECT_FILE = 'src/modules/shipments/label-subject.ts';
const ENGINE = /^src\/modules\/shipments\/(label-[^/]+\.ts|shipment-address\.service\.ts|label-processing\.job\.ts|carrier-status\.service\.ts)$/;
const PICKING = /['"`]picking['"`]/;
const norm = (f: string) => f.replace(/\\/g, '/');

describe('💰 BSD-B25 (c) — ningún literal `picking` en un estado del motor fuera de `label-subject.ts`', () => {
  it('CONTROL: el candado ve el motor (≥ 8 ficheros) y ve el literal donde vive (label-subject.ts)', () => {
    const engine = sourcesWithoutComments(BACKEND).filter((s) => ENGINE.test(norm(s.file)));
    expect(engine.length).toBeGreaterThanOrEqual(8);
    expect(PICKING.test(engine.find((s) => norm(s.file) === SUBJECT_FILE)?.code ?? '')).toBe(true);
  });

  it('ningún fichero del motor (salvo `label-subject.ts`) escribe `picking`', () => {
    const offenders = sourcesWithoutComments(BACKEND)
      .filter((s) => ENGINE.test(norm(s.file)) && norm(s.file) !== SUBJECT_FILE && PICKING.test(s.code))
      .map((s) => s.file);
    expect(offenders).toEqual([]);
  });
});
