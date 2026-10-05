/**
 * sdx-tl31af.units.spec.ts — las condiciones y deudas «pagar ya» del gate techlead sobre `31af0883` (rama `claude/skydropx-d`).
 * Propiedad: backend. BACKEND_NOTES §71.
 *
 *  - C-TL-1: `?alert=true` = UNIÓN de `carrierAlertShipmentIds` y `labelAlertShipmentIds` (un cuerpo SQL, el del tablero); la
 *    ventana de huérfanas es UNA constante (`ORPHAN_ALERT_TTL_MS`); el tablero recibe reloj y `tUnknownMs` por inyección normal
 *    (`ShippingWorkQueueService`, exportado por `ShipmentsModule`), ⛔ `ModuleRef` con `strict:false`.
 *  - C-TL-2: `AV-6` — rótulo según destino (`ctaLabelOf`, §41.4 fila 19), `next` solo en retiro, asunto sin marca (§41.2 fila 19).
 *  - D-1: `transitionFromProvider` sin `ShipmentPrepService` FALLA (⛔ saltarse la guarda de §M4-SHIP.6).
 *  - D-8: los `catch` de los avisos (`claimAndNotify`, `AV-12`) registran clase/código, ⛔ el mensaje crudo.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { ShipmentRequest } from '@prisma/client';
import * as tpl from '../src/modules/shipments/mail/shipment-notice.templates';
import { alertShipmentIdsOf, carrierAlertShipmentIds, labelAlertShipmentIds } from '../src/modules/shipments/shipping-work-queue';
import { ShippingWorkQueueService } from '../src/modules/shipments/shipping-work-queue.service';
import { ShipmentsModule } from '../src/modules/shipments/shipments.module';
import { ShipmentsService } from '../src/modules/shipments/shipments.service';
import { DashboardShippingService } from '../src/modules/admin/dashboard-shipping.service';
import { RefundLedgerService } from '../src/modules/payments/refunds/refund-ledger.service';
import { safeErrorTag } from '../src/modules/shipments/guest-mail-link';
import { ORPHAN_ALERT_TTL_MS, T_STUCK_MS } from '../src/modules/shipments/label-verify.constants';

const SRC = join(__dirname, '..', 'src', 'modules');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');

// ================================================================================================================ C-TL-1
describe('C-TL-1 — `?alert=true` es la unión de los dos cuerpos del tablero; una ventana de huérfanas; inyección normal', () => {
  const now = new Date('2026-10-05T12:00:00Z');
  const t = now.getTime();
  const tUnknownMs = 15 * 60_000;
  const base = {
    status: 'guia',
    labelSource: 'skydropx',
    providerShipmentId: 'ps',
    providerCanceledAt: null,
    providerCancelConfirmedAt: null,
    labelProcessingSince: null,
    trackingNumber: 'T',
    carrierStatus: null,
    carrierStatusAt: null,
    labelPurchasedAt: null,
    rateChosenAt: null,
  };
  const rows: Record<string, Partial<ShipmentRequest>> = {
    carrier_only: { ...base, carrierStatus: 'exception' } as any,
    label_only: { ...base, trackingNumber: null, labelProcessingSince: new Date(t - T_STUCK_MS) } as any,
    both: { ...base, trackingNumber: null, labelProcessingSince: new Date(t - T_STUCK_MS), carrierStatus: 'retained' } as any,
    // `cancelado` apaga la de transportista pero enciende `label_live_on_cancelled`.
    cancelled_with_exception: { ...base, status: 'cancelado', carrierStatus: 'exception' } as any,
    orphan: { ...base } as any,
    quiet: { ...base } as any,
  };
  const fakeDb = (at: number = t) => {
    const findMany = jest.fn(async () => Object.entries(rows).map(([id, r]) => ({ id, ...r })));
    const audit = jest.fn(async () => [{ entityId: 'orphan', createdAt: new Date(at - 60_000) }]);
    const count = jest.fn(async () => 0);
    return { db: { shipmentRequest: { findMany, count }, auditLog: { findMany: audit } } as any, findMany, audit };
  };
  const EXPECTED = ['both', 'cancelled_with_exception', 'carrier_only', 'label_only', 'orphan'];

  it('`alertShipmentIdsOf` = `carrierAlertShipmentIds` ∪ `labelAlertShipmentIds`, sin duplicados', async () => {
    const { db } = fakeDb();
    const carrier = await carrierAlertShipmentIds(db);
    const label = await labelAlertShipmentIds(db, now, tUnknownMs);
    expect(carrier.sort()).toEqual(['both', 'carrier_only']);
    const union = await alertShipmentIdsOf(db, now, tUnknownMs);
    expect([...union].sort()).toEqual(EXPECTED);
    expect([...union].sort()).toEqual([...new Set([...carrier, ...label])].sort());
    expect(union.length).toBe(new Set(union).size);
  });

  it('`ShipmentsService` (`?alert=true`) devuelve esa unión con SU reloj y SU `tUnknownMs` inyectados', async () => {
    const late = t + 3_600_000; // 1 h por delante: la ventana de huérfanas sale del reloj inyectado, no del sistema
    const { db, audit } = fakeDb(late);
    const clock = { now: () => new Date(late) };
    const svc = new ShipmentsService(db, {} as any, {} as any, undefined, undefined, undefined, undefined, { tUnknownMs } as any, clock as any);
    const ids: string[] = await (svc as any).alertShipmentIds();
    expect([...ids].sort()).toEqual(EXPECTED);
    const arg = (audit.mock.calls[0] as any[])[0];
    expect(arg.where.createdAt.gt.getTime()).toBe(late - ORPHAN_ALERT_TTL_MS);
  });

  it('censo: `shipments.service.ts` no tiene consulta ancha propia ni la ventana de 7 días en literal', () => {
    const svc = read('shipments/shipments.service.ts');
    const body = svc.slice(svc.indexOf('private async alertShipmentIds('), svc.indexOf('private async lastLabelReleaseOf('));
    expect(body).toMatch(/alertShipmentIdsOf\(/);
    expect(body).not.toMatch(/findMany|CARRIER_ALERT_STATUSES|labelProcessingSince/);
    for (const f of ['shipments/shipments.service.ts', 'shipments/shipping-work-queue.ts']) {
      expect(read(f)).not.toMatch(/7 \* 24 \* 60 \* 60 \* 1000/);
      expect(read(f)).toMatch(/ORPHAN_ALERT_TTL_MS/);
    }
    expect(ORPHAN_ALERT_TTL_MS).toBe(7 * 24 * 3_600_000);
  });

  it('`ShippingWorkQueueService` cuenta con el reloj y el `tUnknownMs` que se le INYECTAN', async () => {
    const { db } = fakeDb();
    const tq = new ShippingWorkQueueService(db, { now: () => new Date(t) } as any, { tUnknownMs } as any);
    const base0 = await tq.shipping({ provider: 'off', thresholdCents: 0, readBalance: async () => null });
    // `label_only` y `both` tienen exactamente T_STUCK_MS: con el reloj 1 s ATRÁS dejan de contar.
    const tqEarly = new ShippingWorkQueueService(db, { now: () => new Date(t - 1000) } as any, { tUnknownMs } as any);
    const early = await tqEarly.shipping({ provider: 'off', thresholdCents: 0, readBalance: async () => null });
    expect(base0.withLabelAlert - early.withLabelAlert).toBe(2);
    expect(base0.withCarrierAlert).toBe(2);
    expect(base0.lowBalance).toBeNull();
  });

  it('`ShippingWorkQueueService` usa el `tUnknownMs` INYECTADO, ⛔ uno propio (en vuelo justo a `tUnknownMs` ⇒ cuenta)', async () => {
    const unknown = { ...base, id: 'u', providerShipmentId: null, trackingNumber: null, labelProcessingSince: new Date(t - tUnknownMs) };
    const db = {
      shipmentRequest: { findMany: jest.fn(async () => [unknown]), count: jest.fn(async () => 1) },
      auditLog: { findMany: jest.fn(async () => []) },
    } as any;
    const tq = new ShippingWorkQueueService(db, { now: () => new Date(t) } as any, { tUnknownMs } as any);
    expect((await tq.shipping({ provider: 'off', thresholdCents: 0, readBalance: async () => null })).withLabelAlert).toBe(1);
  });

  it('`ShipmentsModule` exporta `ShippingWorkQueueService` y el tablero lo inyecta (⛔ `ModuleRef`)', async () => {
    const exportsOf = Reflect.getMetadata('exports', ShipmentsModule) as unknown[];
    const providersOf = Reflect.getMetadata('providers', ShipmentsModule) as unknown[];
    expect(exportsOf).toContain(ShippingWorkQueueService);
    expect(providersOf).toContain(ShippingWorkQueueService);
    const dash = read('admin/dashboard-shipping.service.ts');
    expect(dash).not.toMatch(/from '@nestjs\/core'|moduleRef\.get|strict:\s*false|import \{[^}]*(SHIPMENTS_LABEL_CLOCK|LABEL_VERIFY_CONFIG)/);
    const shipping = jest.fn(async () => ({ lowBalance: null, withCarrierAlert: 1, withLabelAlert: 2, labelProcessing: 3 }));
    const settings = { get: jest.fn(async () => 'skydropx'), getNumber: jest.fn(async () => 5000) };
    const balance = { read: jest.fn(async () => 100) };
    const d = new DashboardShippingService({} as any, settings as any, balance as any, { shipping } as any);
    expect(await d.shipping()).toEqual({ lowBalance: null, withCarrierAlert: 1, withLabelAlert: 2, labelProcessing: 3 });
    const deps = (shipping.mock.calls[0] as any[])[0];
    expect(deps.provider).toBe('skydropx');
    expect(deps.thresholdCents).toBe(5000);
    expect(await deps.readBalance()).toBe(100);
  });
});

// ================================================================================================================ C-TL-2
describe('C-TL-2 — `AV-6`: rótulo según destino, `next` solo en retiro, asunto sin marca (§41.2/§41.4 fila 19)', () => {
  const saved = process.env.APP_PUBLIC_URL;
  beforeAll(() => {
    process.env.APP_PUBLIC_URL = 'https://app.test';
  });
  afterAll(() => {
    if (saved === undefined) delete process.env.APP_PUBLIC_URL;
    else process.env.APP_PUBLIC_URL = saved;
  });
  const order = { shipmentId: 'shp-1', orderNumber: 'TCG-000123', orderId: 'ord-1' };
  const vault = { shipmentId: 'shp-1', orderNumber: null };
  const guest = { ...order, customerUrl: 'https://app.test/es/pedido?token=abc' };
  const NEXT = { es: 'volver a solicitarlo desde tu cuenta', en: 'request it again from your account' };

  it.each([
    ['es', order, 'VER MI PEDIDO', false],
    ['en', order, 'SEE MY ORDER', false],
    ['es', guest, 'VER MI PEDIDO', false],
    ['es', vault, 'VER MI ENVÍO', true],
    ['en', vault, 'SEE MY SHIPMENT', true],
  ] as const)('[%s] %j ⇒ %s', (l, p, label, withNext) => {
    const m = tpl.shipmentCancelledTemplate(p as any, l);
    expect(m.text).toMatch(/https:\/\/app\.test\//);
    expect(m.html).toContain(label);
    expect(m.html).not.toMatch(/IR A MI CUENTA|GO TO MY ACCOUNT/);
    expect(m.html.includes(NEXT[l])).toBe(withNext);
    expect(m.text.includes(NEXT[l])).toBe(withNext);
  });

  it.each([
    ['es', 'Tu envío quedó cancelado'],
    ['en', 'Your shipment was cancelled'],
  ] as const)('[%s] asunto exacto, sin prefijo de marca', (l, subject) => {
    expect(tpl.shipmentCancelledTemplate(order as any, l).subject).toBe(subject);
    expect(tpl.shipmentCancelledTemplate(vault as any, l).subject).toBe(subject);
  });
});

// ================================================================================================================ D-1
describe('D-1 — `transitionFromProvider` sin `ShipmentPrepService` falla (⛔ se salta la guarda)', () => {
  it('`guia` → `enviado` sin prep ⇒ lanza y no escribe', async () => {
    const updateMany = jest.fn(async () => ({ count: 1 }));
    const tx = {
      shipmentRequest: { findUniqueOrThrow: jest.fn(async () => ({ status: 'guia', userId: 'u1', orderId: null })), updateMany },
      order: { findUnique: jest.fn(async () => null) },
    } as any;
    const svc = new ShipmentsService({} as any, {} as any, {} as any);
    await expect(svc.transitionFromProvider(tx, 'shp-1', 'enviado', { now: new Date() })).rejects.toThrow(/ShipmentPrepService/);
    expect(updateMany).not.toHaveBeenCalled();
  });
});

// ================================================================================================================ D-8
describe('D-8 — los `catch` de los avisos registran clase/código, ⛔ el mensaje crudo', () => {
  const SECRET = 'https://app.test/es/pedido?token=tok-de-prueba-123';
  const boom = () => Object.assign(new Error(`falló enviando ${SECRET}`), { code: 'E_MAIL' });

  it('`safeErrorTag` = nombre + código, sin mensaje', () => {
    expect(safeErrorTag(boom())).toBe('Error E_MAIL');
    expect(safeErrorTag('cadena con token')).toBe('error');
  });

  it('`ShipmentsService.claimAndNotify` (correo de envío) ⇒ el log no lleva el mensaje', async () => {
    const mail = { send: jest.fn(async () => Promise.reject(boom())) };
    const svc = new ShipmentsService({} as any, {} as any, {} as any, mail as any);
    jest.spyOn(svc as any, 'resolveRecipient').mockResolvedValue({ email: 'c@example.test', locale: 'es', orderNumber: null, orderId: null, link: { kind: 'shipment' } });
    jest.spyOn(svc as any, 'customerUrlFor').mockResolvedValue(SECRET);
    const error = jest.fn();
    (svc as any).logger = { error, warn: jest.fn(), log: jest.fn() };
    await (svc as any).claimAndNotify('shp-1', null, 'AV-6', { id: 'shp-1', userId: 'u1', orderId: null }, () => ({ subject: 's', html: 'h', text: 't' }));
    expect(mail.send).toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
    const line = String((error.mock.calls[0] as any[])[0]);
    expect(line).toContain('Error E_MAIL');
    expect(line).not.toContain('token');
    expect(line).not.toContain('falló enviando');
  });

  it('`RefundLedgerService.notifyCustomer` (`AV-12`) ⇒ el log no lleva el mensaje', async () => {
    const prisma = { paymentRefund: { updateMany: jest.fn(async () => Promise.reject(boom())) } };
    const mail = { send: jest.fn() };
    const svc = new RefundLedgerService(prisma as any, {} as any, {} as any, {} as any, mail as any);
    const error = jest.fn();
    (svc as any).logger = { error, warn: jest.fn(), log: jest.fn() };
    await svc.notifyCustomer(['r1']);
    expect(error).toHaveBeenCalledTimes(1);
    const line = String((error.mock.calls[0] as any[])[0]);
    expect(line).toContain('Error E_MAIL');
    expect(line).not.toContain('token');
    expect(line).not.toContain('falló enviando');
  });
});
