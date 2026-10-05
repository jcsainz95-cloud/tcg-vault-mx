/**
 * sdx-d2d.units.spec.ts — ⭐💰 unitarias y censos de D2d (API_CONTRACT §M4-SHIP.19.3, §19.9, §19.10, §19.18.2, §19.27–§19.30,
 * §19.32). Propiedad: backend. La conducta contra Postgres vive en `test/integration/sdx-d2d-*.e2e-spec.ts`.
 *
 *  - §19.10 + SEC-SDX-2 (PS-72): `carrierEventsOf` — la llave del evento sintético NUNCA lleva `now`; el historial en orden.
 *  - C-19 (PS-130 (d)): `normalizeTracking` — NFKC, mayúsculas, solo alfanumérico.
 *  - §19.10 (PS-80): `adjustmentKindOf` — la lista cerrada de `ShipmentCostAdjustmentKind` (S-GAS-4).
 *  - §19.9 (PS-77): `parseDepartureDate` (día MX por defecto; ida y vuelta), `mxDayEndExclusive`, `parseDepartedBody`.
 *  - §19.10: la llave del cubo de `refresh-tracking` es el ENVÍO.
 *  - Censos: `C-SDX-5` (llamadores de `applyCarrierStatus`/`pollShipment`/`recoverInFlightLabel`), PS-99/PS-117 (los jobs
 *    no compran; la única `cancel` nueva es la de la conciliación), y el fusible bajo su clave (`ORPHAN_FUSE_LOCK_KEY`).
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, sep } from 'path';
import { carrierEventsOf } from '../src/modules/shipments/carrier-status.service';
import { normalizeTracking } from '../src/modules/shipments/orphan-reconcile.service';
import { adjustmentKindOf } from '../src/modules/shipments/extra-charges.job';
import { mxDayEndExclusive, parseDepartedBody, parseDepartureDate } from '../src/modules/shipments/departure.service';
import { shipmentThrottleKey } from '../src/modules/shipments/shipment-throttler.guard';
import { ORPHAN_AUTO_CANCEL_MAX_24H, ORPHAN_FUSE_LOCK_KEY } from '../src/modules/shipments/label-verify.constants';
import { BusinessException } from '../src/common/business.exception';

const SRC = join(__dirname, '..', 'src');
function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') && !p.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}
const rel = (p: string) => relative(join(__dirname, '..'), p).split(sep).join('/');
/** Código sin comentarios (los censos miden código, no prosa). */
const code = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const files = () => walk(SRC).map((p) => ({ path: rel(p), text: code(readFileSync(p, 'utf8')) }));

const URLS = { trackingUrl: null, labelUrl: null };

// ================================================================ §19.10 + SEC-SDX-2 — los eventos de UNA lectura

describe('carrierEventsOf (§19.10, §19.18.2 SEC-SDX-2) — los eventos de una lectura', () => {
  const observed = new Date('2026-10-05T12:00:00Z');

  it('solo estado actual, SIN updated_at ⇒ UN sintético con llave = estado (⛔ nunca `now` en la llave) y occurredAt = now', () => {
    const ev = carrierEventsOf({ events: [], carrierStatus: 'delivery_attempt', statusUpdatedAt: null, trackingNumber: 'T1' }, observed, URLS);
    expect(ev).toEqual([
      expect.objectContaining({ status: 'delivery_attempt', providerEventKey: 'delivery_attempt', synthetic: true, occurredAt: observed, observedAt: observed, trackingNumber: 'T1' }),
    ]);
    // Diez lecturas con el reloj avanzando ⇒ la MISMA llave (el `@@unique` y el paso 2b la paran).
    const keys = new Set(
      Array.from({ length: 10 }, (_, i) => carrierEventsOf({ events: [], carrierStatus: 'delivery_attempt', statusUpdatedAt: null, trackingNumber: null }, new Date(observed.getTime() + i * 3_600_000), URLS)[0].providerEventKey),
    );
    expect([...keys]).toEqual(['delivery_attempt']);
  });

  it('solo estado actual CON updated_at ⇒ llave `estado:updated_at` y occurredAt = updated_at', () => {
    const [e] = carrierEventsOf({ events: [], carrierStatus: 'in_transit', statusUpdatedAt: '2026-10-05T10:00:00Z', trackingNumber: null }, observed, URLS);
    expect(e.providerEventKey).toBe('in_transit:2026-10-05T10:00:00Z');
    expect(e.occurredAt.toISOString()).toBe('2026-10-05T10:00:00.000Z');
    expect(e.synthetic).toBe(true);
  });

  it('con historial ⇒ uno por evento LEGIBLE, en orden occurredAt asc; los desconocidos NO se aplican; id del evento manda en la llave', () => {
    const ev = carrierEventsOf(
      {
        carrierStatus: 'delivered',
        statusUpdatedAt: null,
        trackingNumber: 'T1',
        events: [
          { status: 'delivered', rawStatus: 'delivered', occurredAt: '2026-10-05T09:00:00Z', branchName: null },
          { status: null, rawStatus: 'teleported', occurredAt: '2026-10-05T08:00:00Z' },
          { status: 'in_transit', rawStatus: 'in_transit', occurredAt: '2026-10-04T09:00:00Z', providerEventId: 'ev-7', detail: 'CEDIS' },
        ],
      },
      observed,
      URLS,
    );
    expect(ev.map((e) => [e.status, e.providerEventKey, e.synthetic, e.detail ?? null])).toEqual([
      ['in_transit', 'id:ev-7', false, 'CEDIS'],
      ['delivered', 'delivered:2026-10-05T09:00:00Z', false, null],
    ]);
  });

  it('sin estado ni historial ⇒ ningún evento', () => {
    expect(carrierEventsOf({ events: [], carrierStatus: null, statusUpdatedAt: null, trackingNumber: null }, observed, URLS)).toEqual([]);
  });
});

// ================================================================ C-19 — la normalización del rastreo

describe('normalizeTracking (§19.30.6 (1), C-19) — UNA función a los dos lados', () => {
  it.each([
    ['1Z-999-AA1', '1Z999AA1'],
    ['1z 999 aa1', '1Z999AA1'],
    ['１Ｚ９９９ＡＡ１', '1Z999AA1'], // ancho completo (NFKC)
    ['  1Z–999—AA1 ', '1Z999AA1'], // guiones tipográficos
    ['---', ''],
  ])('%s ⇒ %s', (raw, out) => {
    expect(normalizeTracking(raw)).toBe(out);
  });
  it('CANARIO: normalizar solo espacios NO iguala «1Z-999-AA1» con «1Z999AA1» (por eso la regla quita TODO lo no alfanumérico)', () => {
    const onlySpaces = (t: string) => t.toUpperCase().replace(/\s/g, '');
    expect(onlySpaces('1Z-999-AA1')).not.toBe(onlySpaces('1Z999AA1'));
    expect(normalizeTracking('1Z-999-AA1')).toBe(normalizeTracking('1Z999AA1'));
  });
});

// ================================================================ §19.10 — el tipo del cargo extra

describe('adjustmentKindOf (§19.10, S-GAS-4)', () => {
  it.each([
    ['Overweight', 'overweight'],
    ['ExtraCharge::Overweight', 'overweight'],
    ['ExtendedZone', 'extended_zone'],
    ['extended_zone', 'extended_zone'],
    ['Return', 'return'],
    ['Fuel', 'other'],
    [null, 'other'],
  ])('%s ⇒ %s', (raw, kind) => {
    expect(adjustmentKindOf(raw)).toBe(kind);
  });
});

// ================================================================ §19.9 — «Salida de hoy»

describe('«Salida de hoy» (§19.9) — la fecha y el lote', () => {
  it('sin `date` (o en blanco) ⇒ hoy en America/Mexico_City (a las 03:00 UTC aún es AYER en México)', () => {
    expect(parseDepartureDate(undefined, new Date('2026-10-05T03:00:00Z'))).toBe('2026-10-04');
    expect(parseDepartureDate('  ', new Date('2026-10-05T07:00:00Z'))).toBe('2026-10-05');
  });
  it.each(['2026-02-30', '2026-13-01', '05-10-2026', '2026-10-05T00:00:00Z', 'hoy'])('`%s` ⇒ 400 {field:date} (ida y vuelta, §M4-PREP)', (raw) => {
    try {
      parseDepartureDate(raw, new Date());
      throw new Error('no lanzó');
    } catch (e) {
      expect(e).toBeInstanceOf(BusinessException);
      expect((e as BusinessException).getStatus()).toBe(400);
      expect((e as BusinessException).details).toEqual({ field: 'date' });
    }
  });
  it('el día MX termina a las 06:00 UTC del día siguiente (México sin horario de verano desde 2022)', () => {
    expect(mxDayEndExclusive('2026-10-05').toISOString()).toBe('2026-10-06T06:00:00.000Z');
    expect(mxDayEndExclusive('2026-12-31').toISOString()).toBe('2027-01-01T06:00:00.000Z');
  });
  it('`shipmentIds`: 1..200 uuid, repetidos una vez; fuera ⇒ 400 {field:shipmentIds}', () => {
    const a = '11111111-1111-4111-8111-111111111111';
    expect(parseDepartedBody({ shipmentIds: [a, a] })).toEqual([a]);
    for (const bad of [{}, { shipmentIds: [] }, { shipmentIds: ['x'] }, { shipmentIds: Array(201).fill(a) }, null]) {
      expect(() => parseDepartedBody(bad)).toThrow(BusinessException);
    }
  });
});

describe('`refresh-tracking` — el cubo de 6/min cuelga del ENVÍO (§19.10)', () => {
  it('`shipment:<id>` de la ruta; dos actores sobre el mismo envío comparten cubo', () => {
    expect(shipmentThrottleKey({ params: { id: 'abc' }, user: { id: 'u1' } })).toBe('shipment:abc');
    expect(shipmentThrottleKey({ params: { id: 'abc' }, user: { id: 'u2' } })).toBe('shipment:abc');
    expect(shipmentThrottleKey({})).toBe('shipment:anon');
  });
});

// ================================================================ censos

describe('C-SDX-5 (§19.16, §19.18.4) — los llamadores exactos', () => {
  it('`applyCarrierStatus(` se llama SOLO desde `pollShipment` (carrier-status.service.ts); un webhook futuro se añade AQUÍ', () => {
    const callers = files().filter((f) => /\.applyCarrierStatus\(/.test(f.text)).map((f) => f.path);
    expect(callers).toEqual(['src/modules/shipments/carrier-status.service.ts']);
  });
  it('`pollShipment(` lo llaman los dos jobs (sondeo y guía en proceso) — `refresh-tracking` va por el job del sondeo', () => {
    const callers = files().filter((f) => /\.pollShipment\(/.test(f.text)).map((f) => f.path).sort();
    expect(callers).toEqual(['src/modules/shipments/label-processing.job.ts', 'src/modules/shipments/tracking-poll.job.ts']);
  });
  it('`recoverInFlightLabel(` tiene DOS llamadores: el job `shipment-label-processing` y `label/release`', () => {
    const callers = files().filter((f) => /\.recoverInFlightLabel\(/.test(f.text)).map((f) => f.path).sort();
    expect(callers).toEqual(['src/modules/shipments/label-processing.job.ts', 'src/modules/shipments/label-recovery.service.ts']);
  });
});

describe('PS-99 / PS-117 (§19.27.5, §19.28.7) — los jobs de D2d no compran; la única `cancel` nueva exige folio', () => {
  const D2D = [
    'src/modules/shipments/carrier-status.service.ts',
    'src/modules/shipments/tracking-poll.job.ts',
    'src/modules/shipments/label-processing.job.ts',
    'src/modules/shipments/extra-charges.job.ts',
    'src/modules/shipments/orphan-reconcile.service.ts',
    'src/modules/shipments/departure.service.ts',
    'src/jobs/scheduler.service.ts',
    'src/jobs/admin-jobs.controller.ts',
  ];
  it('cero `.purchase(` y cero `.protect(` en los ficheros de D2d', () => {
    const all = files();
    for (const p of D2D) {
      const f = all.find((x) => x.path === p);
      expect({ p, existe: !!f }).toEqual({ p, existe: true });
      expect({ p, compra: /\.purchase\(|\.protect\(/.test(f!.text) }).toEqual({ p, compra: false });
    }
  });
  it('la llamada `port.cancel(` de D2d vive SOLO en la conciliación de huérfanas (y es una)', () => {
    const all = files();
    const hits = D2D.flatMap((p) => [...(all.find((x) => x.path === p)!.text.matchAll(/port\.cancel\(/g))].map(() => p));
    expect(hits).toEqual(['src/modules/shipments/orphan-reconcile.service.ts']);
  });
  it('la conciliación: el fusible bajo `ORPHAN_FUSE_LOCK_KEY` (65 310 703, §19.30.6) y su tope = 3; la intención ANTES de `cancel`', () => {
    expect(ORPHAN_FUSE_LOCK_KEY).toBe(65_310_703);
    expect(ORPHAN_AUTO_CANCEL_MAX_24H).toBe(3);
    const t = files().find((f) => f.path === 'src/modules/shipments/orphan-reconcile.service.ts')!.text;
    expect(t).toMatch(/pg_advisory_xact_lock\(\$\{ORPHAN_FUSE_LOCK_KEY\}/);
    const intent = t.indexOf('autoCancelIntentAt: now');
    const cancel = t.indexOf('port.cancel(');
    expect(intent).toBeGreaterThan(0);
    expect(cancel).toBeGreaterThan(intent);
  });
});
