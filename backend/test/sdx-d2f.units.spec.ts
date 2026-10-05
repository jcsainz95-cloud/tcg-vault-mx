/**
 * sdx-d2f.units.spec.ts — 💰 D2f (API_CONTRACT §M4-SHIP.19.19.15 fila D2f, §19.31.10 fila 3b, §19.33.6/.10): las piezas PURAS y
 * los cuerpos únicos de «Dinero y tablero». Propiedad: backend. La conducta contra Postgres real vive en
 * `test/integration/sdx-d2f-money.e2e-spec.ts`.
 *
 *  - PS-171 (censo): la lista de estados que encienden la alerta del transportista aparece en UN fichero de `src/`
 *    (`label-view.ts`); `withCarrierAlert` la usa por `carrierAlertActive`, ⛔ ninguna segunda lista.
 *  - P&L (§19.11, §M10-IVA.8): `shippingAdjustmentsCents` (neto, por `chargedAt`), `shippingInsuranceCents`,
 *    `shippingCostMissingCount` sin las guías Skydropx; el CSV con las mismas columnas en el mismo orden (PS-80, PS-81).
 *  - `workQueue.spendControl` / S-GAS-3 (§19.29.9): el predicado único de «sin ver».
 *  - `PUT /admin/shipping/packages` (§19.13, §19.19.6, §19.22.3): la validación del cuerpo.
 *  - `GET …/catalogs/consignment-notes` (§19.22.3): `description` 3..60 y `hasMore` por `meta.next_page`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { AdminService } from '../src/modules/admin/admin.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';
import { withM61Defaults } from './helpers/m61-mock-defaults';
import { stripComments } from './helpers/strip-comments';
import { SPEND_CONTROL_EXCLUDED_KINDS, unseenSpendAlertsWhere } from '../src/modules/spend-alerts/spend-control';
import { parseConsignmentDescription, parsePackagesBody } from '../src/modules/admin/shipping-config';
import { SkydropxClient } from '../src/modules/shipping-provider/http/skydropx-client';
import { SkydropxAdapter } from '../src/modules/shipping-provider/skydropx.adapter';
import { FakeShippingProvider } from '../src/modules/shipping-provider/fake-shipping-provider';
import { CapturedLogger, FAKE_CLIENT_ID, FAKE_SECRET, FakeClock, jsonResponse, RECORDER_ORIGIN, RecorderTransport } from './helpers/skydropx-recorder';

const SRC = join(__dirname, '..', 'src');
const ALERT_SET = ['delivery_attempt', 'destroyed', 'exception', 'in_return', 'retained'];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
  });
}

/** Los literales `[...]` del fichero (sin comentarios) cuyas cadenas son EXACTAMENTE el conjunto de la alerta. */
function alertSetLiterals(source: string): number {
  const code = stripComments(source);
  let n = 0;
  for (const m of code.matchAll(/\[([^\[\]]*)\]/g)) {
    const items = [...m[1].matchAll(/'([a-z_]+)'|"([a-z_]+)"/g)].map((x) => x[1] ?? x[2]);
    if (items.length === 0) continue;
    const uniq = [...new Set(items)].sort();
    if (uniq.length === ALERT_SET.length && uniq.every((v, i) => v === ALERT_SET[i])) n += 1;
  }
  return n;
}

describe('PS-171 (censo) — la lista de la alerta del transportista vive en UN fichero de src/', () => {
  it('solo `shipments/label-view.ts` declara {delivery_attempt, exception, retained, in_return, destroyed}', () => {
    const hits = walk(SRC)
      .filter((f) => alertSetLiterals(readFileSync(f, 'utf8')) > 0)
      .map((f) => relative(SRC, f).split('\\').join('/'));
    expect(hits).toEqual(['modules/shipments/label-view.ts']);
  });

  it('canario: el detector SÍ ve una segunda lista (en cualquier orden y con comillas dobles)', () => {
    expect(alertSetLiterals(`const X = ["retained", 'exception', 'delivery_attempt', 'destroyed', 'in_return'];`)).toBe(1);
    expect(alertSetLiterals(`// ['retained','exception','delivery_attempt','destroyed','in_return']`)).toBe(0);
    expect(alertSetLiterals(`const Y = ['exception', 'retained', 'delivery_attempt'];`)).toBe(0);
  });

  it('el tablero cuenta con `carrierAlertActive` (importado de label-view), no con una lista propia', () => {
    const src = readFileSync(join(SRC, 'modules/shipments/shipping-work-queue.ts'), 'utf8');
    expect(stripComments(src)).toMatch(/carrierAlertActive\(/);
    expect(src).toMatch(/from '\.\/label-view'/);
  });
});

// ======================================================================================== P&L

describe('💰 P&L (§19.11, §M10-IVA.8) — ajustes por `chargedAt`, seguro informativo, faltantes sin Skydropx (PS-80, PS-81)', () => {
  let prisma: any;
  let service: AdminService;
  const sh = (over: Record<string, unknown>) => ({
    shippingFeeCents: 0,
    shippingCostCents: 0,
    shippingCostIvaCents: 0,
    insuranceCostCents: 0,
    processingFeeCents: 0,
    ivaCents: 0,
    priceConvention: 'IVA_EXCLUSIVE',
    labelSource: null,
    ...over,
  });

  beforeEach(() => {
    prisma = {
      order: { findMany: jest.fn().mockResolvedValue([]) },
      shipmentRequest: {
        findMany: jest.fn().mockResolvedValue([
          // PS-81: la guía normativa de §19.19.11 (total 5125 + seguro 2500 = 7625; IVA 690) ⇒ neto 6935.
          sh({ labelSource: 'skydropx', shippingCostCents: 7625, shippingCostIvaCents: 690, insuranceCostCents: 2500 }),
          // Skydropx con costo 0 (no debería pasar, pero el contador NO la cuenta: su costo vino solo).
          sh({ labelSource: 'skydropx', shippingCostCents: 0 }),
          // Guía manual sin captura ⇒ SÍ cuenta.
          sh({ labelSource: 'manual', shippingCostCents: 0 }),
          // Guía manual legada (labelSource NULL) sin captura ⇒ SÍ cuenta.
          sh({ labelSource: null, shippingCostCents: 0 }),
          // Guía manual con costo y sin IVA ⇒ neto 9000.
          sh({ labelSource: 'manual', shippingCostCents: 9000 }),
        ]),
      },
      shipmentCostAdjustment: {
        findMany: jest.fn().mockResolvedValue([
          { amountCents: 11600, ivaCents: 1600 },
          { amountCents: 5800, ivaCents: 800 },
        ]),
      },
    };
    service = new AdminService(withM61Defaults(prisma) as unknown as PrismaService, {} as PricingService, new PiiCryptoService(new ConfigService({})), {} as any);
  });

  it('shippingCostCents = Σ neto de envíos + Σ neto de ajustes; las dos cifras nuevas; faltantes sin Skydropx', async () => {
    const p: Record<string, number> = await service.pnl('2031-02-01', '2031-02-28');
    expect(p.shippingAdjustmentsCents).toBe(10000 + 5000);
    expect(p.shippingInsuranceCents).toBe(2500);
    expect(p.shippingCostCents).toBe(6935 + 9000 + 15000);
    expect(p.shippingCostMissingCount).toBe(2);
    expect(p.profitCents).toBe(-(6935 + 9000 + 15000));
  });

  it('los ajustes se acotan por `chargedAt` (⛔ `observedAt`, ⛔ el `pickingAt` del envío)', async () => {
    await service.pnl('2031-02-01', '2031-02-28');
    const where = prisma.shipmentCostAdjustment.findMany.mock.calls[0][0].where;
    expect(Object.keys(where)).toEqual(['chargedAt']);
    expect(where.chargedAt).toEqual(expect.objectContaining({ gte: expect.any(Date) }));
  });

  it('sin rango ⇒ todos los ajustes (como los envíos)', async () => {
    await service.pnl();
    expect(prisma.shipmentCostAdjustment.findMany.mock.calls[0][0].where).toEqual({});
  });

  it('CSV: las dos columnas nuevas en el MISMO orden que el objeto', async () => {
    const csv = await service.exportCsv('pnl', '2031-02-01', '2031-02-28');
    const [head, row] = csv.trim().split('\n');
    const p = await service.pnl('2031-02-01', '2031-02-28');
    expect(head.split(',')).toEqual(['report', ...Object.keys(p)]);
    expect(row.split(',')).toEqual(['pnl', ...Object.values(p).map(String)]);
  });
});

// ============================================================================ spendControl / S-GAS-3

describe('💰 `workQueue.spendControl` y S-GAS-3 (§19.29.9, §19.30.8) — UN predicado de «sin ver»', () => {
  it('🔴/🟡, `seenAt NULL`, sin silenciados y sin AG-7/AG-11/AG-12 (los cuenta `workQueue.shipping`)', () => {
    expect([...SPEND_CONTROL_EXCLUDED_KINDS].sort()).toEqual(['parcel_problem', 'parcel_returned', 'provider_balance_low']);
    expect(unseenSpendAlertsWhere('immediate')).toEqual({
      severity: 'immediate',
      seenAt: null,
      muted: false,
      kind: { notIn: [...SPEND_CONTROL_EXCLUDED_KINDS] },
    });
    expect(unseenSpendAlertsWhere('digest').severity).toBe('digest');
  });

  it('S-GAS-3 y el tablero leen el MISMO cuerpo (un solo sitio construye el `where`)', () => {
    const prep = readFileSync(join(SRC, 'modules/shipments/shipment-prep.service.ts'), 'utf8');
    const ctl = readFileSync(join(SRC, 'modules/spend-alerts/spend-control.ts'), 'utf8');
    expect(prep).toMatch(/countUnseenImmediate\(/);
    expect(stripComments(prep)).not.toMatch(/seenAt:\s*null/);
    expect(stripComments(ctl).match(/seenAt:\s*null/g)).toHaveLength(1);
  });
});

// ============================================================================ empaques

describe('`PUT /admin/shipping/packages` — el cuerpo (§19.13, §19.19.6, §19.22.3)', () => {
  const pkg = (over: Record<string, unknown> = {}) => ({
    code: 'box',
    label: 'Caja',
    lengthCm: 49,
    widthCm: 23,
    heightCm: 21,
    weightKg: 5,
    providerPackageType: '4G',
    active: true,
    sortOrder: 1,
    ...over,
  });
  const fails = (body: unknown) => {
    try {
      parsePackagesBody(body);
    } catch (e: any) {
      const r = e.getResponse();
      return { status: e.getStatus(), code: r.error?.code ?? r.code, details: r.error?.details ?? r.details };
    }
    return null;
  };

  it('válido ⇒ la lista normalizada (strings recortados)', () => {
    expect(parsePackagesBody({ packages: [pkg({ label: '  Caja  ' }), pkg({ code: 'envelope', active: false, providerPackageType: '' })] })).toEqual([
      pkg(),
      pkg({ code: 'envelope', active: false, providerPackageType: '' }),
    ]);
  });

  it.each([
    ['weightKg decimal', { weightKg: 1.5 }, 'weightKg'],
    ['weightKg 0', { weightKg: 0 }, 'weightKg'],
    ['lengthCm 0', { lengthCm: 0 }, 'lengthCm'],
    ['widthCm negativo', { widthCm: -1 }, 'widthCm'],
    ['heightCm texto', { heightCm: '21' }, 'heightCm'],
    ['code vacío', { code: '  ' }, 'code'],
    ['label vacío', { label: '' }, 'label'],
    ['active no booleano', { active: 'yes' }, 'active'],
    ['sortOrder decimal', { sortOrder: 1.2 }, 'sortOrder'],
    ['providerPackageType número', { providerPackageType: 4 }, 'providerPackageType'],
  ])('%s ⇒ 400 VALIDATION_ERROR {field}', (_n, over, field) => {
    expect(fails({ packages: [pkg(over)] })).toEqual({ status: 400, code: 'VALIDATION_ERROR', details: { field, index: 0 } });
  });

  it('`code` repetido ⇒ 400 {field:"code"}', () => {
    expect(fails({ packages: [pkg(), pkg({ label: 'Otra' })] })).toEqual({ status: 400, code: 'VALIDATION_ERROR', details: { field: 'code', index: 1 } });
  });

  it('sin ningún activo con código de proveedor ⇒ 400 {field:"packages", reason:"no_active_package"} (⛔ 422)', () => {
    const r = fails({ packages: [pkg({ active: false }), pkg({ code: 'envelope', providerPackageType: '  ' })] });
    expect(r).toEqual({ status: 400, code: 'VALIDATION_ERROR', details: { field: 'packages', reason: 'no_active_package' } });
  });

  it('forma: sin `packages`, no arreglo o vacío ⇒ 400 {field:"packages"}', () => {
    for (const body of [{}, { packages: 'x' }, null, { packages: [null] }]) {
      expect(fails(body)?.details?.field).toBe('packages');
    }
    expect(fails({ packages: [] })).toEqual({ status: 400, code: 'VALIDATION_ERROR', details: { field: 'packages', reason: 'no_active_package' } });
  });
});

// ============================================================================ catálogos

describe('`GET …/catalogs/consignment-notes` (§19.22.3)', () => {
  it('`description` 3..60 tras trim; si no ⇒ 400 {field:"description"}', () => {
    expect(parseConsignmentDescription('  colecc  ')).toBe('colecc');
    for (const bad of [undefined, '', '  ab ', 'x'.repeat(61), ['abc', 'def']]) {
      let got: any = null;
      try {
        parseConsignmentDescription(bad as any);
      } catch (e: any) {
        got = e.getResponse();
      }
      expect(got?.error?.details ?? got?.details).toEqual({ field: 'description' });
    }
    expect(parseConsignmentDescription('x'.repeat(60))).toHaveLength(60);
  });

  function setup() {
    const clock = new FakeClock();
    const rec = new RecorderTransport(clock);
    const logger = new CapturedLogger();
    const client = new SkydropxClient({ baseUrl: `${RECORDER_ORIGIN}/api/v1`, clientId: FAKE_CLIENT_ID, clientSecret: FAKE_SECRET, transport: rec.transport, clock, logger, random: () => 0 });
    return { rec, adapter: new SkydropxAdapter({ client, clock, logger }) };
  }

  it('adaptador: UNA página; `hasMore` ⇔ `meta.next_page ≠ null`; meta ilegible ⇒ false; filas sin código fuera', async () => {
    const { rec, adapter } = setup();
    rec.on('GET', '/api/v1/shipments/consignment_notes?description=naipes', () =>
      jsonResponse(200, { data: [{ consignment_note: '60141103', description: 'Naipes' }, { description: 'sin código' }], meta: { next_page: 2 } }),
    );
    rec.on('GET', '/api/v1/shipments/consignment_notes?description=coleccionables', () =>
      jsonResponse(200, { data: [{ consignment_note: '49101600', description: 'Coleccionables' }], meta: { next_page: null } }),
    );
    rec.on('GET', '/api/v1/shipments/consignment_notes?description=raro', () => jsonResponse(200, { data: [], meta: 'x' }));
    expect(await adapter.searchConsignmentNotes('naipes')).toEqual({ consignmentNotes: [{ code: '60141103', description: 'Naipes' }], hasMore: true });
    expect(await adapter.searchConsignmentNotes('coleccionables')).toEqual({ consignmentNotes: [{ code: '49101600', description: 'Coleccionables' }], hasMore: false });
    expect(await adapter.searchConsignmentNotes('raro')).toEqual({ consignmentNotes: [], hasMore: false });
    expect(rec.calls.filter((c) => c.path.includes('consignment_notes'))).toHaveLength(3);
  });

  it('el doble responde con la misma forma', async () => {
    const fake = new FakeShippingProvider();
    expect(await fake.searchConsignmentNotes('colecc')).toEqual({ consignmentNotes: [{ code: '49101600', description: 'Coleccionables' }], hasMore: false });
  });
});
