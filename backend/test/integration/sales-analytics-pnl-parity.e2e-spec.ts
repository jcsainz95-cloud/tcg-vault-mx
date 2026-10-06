/**
 * 💰 AN-B-13 (API_CONTRACT §15.6, criterio 613) — **paridad de M7 tras `pnl-core`.** `pnl()`, `ivaReport()`,
 * `exportCsv('pnl')` y `launchMetrics()` dan EXACTAMENTE lo mismo antes y después de partir `pnl()` en cubos, sobre la
 * misma fixture (`helpers/sales-db.ts`, ventana 2021 propia).
 *
 * La instantánea `fixtures/an-b-13-pnl-snapshot.json` se ESCRIBIÓ con el código ANTERIOR al refactor (commit propio,
 * previo al de `pnl-core`: `AN_PARITY_WRITE=1`) y ⛔ no se regenera para hacer pasar esto. Si M7 cambia a propósito
 * (§W 277/278), se regenera EN EL MISMO commit que lo cambia y se dice por qué.
 *
 * Rangos: los que M7/M9 reciben de verdad — fechas crudas `YYYY-MM-DD` (D-AN-2: `range()` las toma como medianoche UTC con
 * `lte`), instantes ISO y un rango que cubre toda la ventana. ⛔ Sin el «sin rango»: barrería las filas de otras suites.
 * Determinista (Postgres real, fixture fija): N=1 por corrida, dicho así.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { E2EHarness } from './helpers/e2e-app';
import { cleanupSales, seedSales } from './helpers/sales-db';
import { AdminService } from '../../src/modules/admin/admin.service';

const SNAPSHOT = join(__dirname, 'fixtures', 'an-b-13-pnl-snapshot.json');
const RANGES: Array<[string, string]> = [
  ['2021-02-01', '2021-03-31'],
  ['2021-03-01', '2021-03-07'],
  ['2021-03-02', '2021-03-02'],
  ['2021-03-01T06:00:00.000Z', '2021-03-08T05:59:59.999Z'],
  ['2021-03-02T06:00:00.000Z', '2021-03-03T05:59:59.999Z'],
  ['2021-02-22T06:00:00.000Z', '2021-03-01T05:59:59.999Z'],
];

describe('AN-B-13 💰 — M7 da lo mismo antes y después de pnl-core (Postgres real)', () => {
  let h: E2EHarness;
  let admin: AdminService;

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedSales(h.prisma);
    admin = h.app.get(AdminService);
  }, 120000);

  afterAll(async () => {
    if (h) await cleanupSales(h.prisma);
    await h?.close();
  });

  async function measure() {
    const out: Record<string, unknown> = {};
    for (const [from, to] of RANGES) {
      const iva = await admin.ivaReport(from, to);
      out[`${from}..${to}`] = {
        pnl: await admin.pnl(from, to),
        iva: { ...iva, byOrder: [...iva.byOrder].sort((a, b) => a.orderId.localeCompare(b.orderId)) },
        csv: await admin.exportCsv('pnl', from, to),
        launch: await admin.launchMetrics(from, to),
      };
    }
    return JSON.parse(JSON.stringify(out));
  }

  it('instantánea idéntica (pnl, ivaReport, exportCsv pnl, launchMetrics) en 6 rangos', async () => {
    const now = await measure();
    if (process.env.AN_PARITY_WRITE === '1') {
      mkdirSync(join(__dirname, 'fixtures'), { recursive: true });
      writeFileSync(SNAPSHOT, `${JSON.stringify(now, null, 2)}\n`);
    }
    expect(existsSync(SNAPSHOT)).toBe(true);
    expect(now).toEqual(JSON.parse(readFileSync(SNAPSHOT, 'utf8')));
  });

  it('CONTROL: la fixture mueve las cifras (una instantánea de ceros no probaría nada)', async () => {
    const p = await admin.pnl('2021-02-01', '2021-03-31');
    expect(p.incomeCents).toBeGreaterThan(0);
    expect(p.shippingAdjustmentsCents).toBe(2000);
    expect(p.refundsCents).toBeGreaterThan(0);
    expect(p.shippingCostMissingCount).toBe(1);
  });
});
