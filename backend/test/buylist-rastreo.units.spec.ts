import { inboundCarrierOf, sweepHoldReason, InboundCarrierRow, InboundCarrierCtx } from '../src/modules/shipments/inbound-carrier';

// §BUYLIST-RASTREO criterio 5 con reloj inyectado + forma del DTO `inboundCarrier`.
const H = 3_600_000;
const NOW = new Date('2026-11-25T08:00:00.000Z');
const live = (over: Partial<InboundCarrierRow> = {}): InboundCarrierRow => ({
  labelSource: 'skydropx',
  providerShipmentId: 'p1',
  providerCanceledAt: null,
  carrierStatus: null,
  carrierStatusAt: null,
  carrierPolledAt: new Date(NOW.getTime() - H),
  requestedAt: new Date(NOW.getTime() - 100 * H),
  ...over,
});
const deadline = (hoursAgo: number) => new Date(NOW.getTime() - hoursAgo * H);

describe('sweepHoldReason (regla 2, reloj inyectado)', () => {
  it('sondeo reciente y sin movimiento ⇒ no pospone (cierra como siempre)', () => expect(sweepHoldReason(live(), deadline(24), NOW)).toBeNull());
  it('movimiento ⇒ nunca cierra', () => expect(sweepHoldReason(live({ carrierStatus: 'in_transit' }), deadline(500), NOW)).toBe('moving'));
  it('proveedor caído 25 h, plazo vencido hace 24 h ⇒ pospone', () =>
    expect(sweepHoldReason(live({ carrierPolledAt: new Date(NOW.getTime() - 25 * H) }), deadline(24), NOW)).toBe('provider_stale'));
  it('a las 48 h del plazo ya NO pospone', () =>
    expect(sweepHoldReason(live({ carrierPolledAt: new Date(NOW.getTime() - 25 * H) }), deadline(48), NOW)).toBeNull());
  it('guía manual / cancelada / proveedor apagado ⇒ sin cinturón de rastreo', () => {
    expect(sweepHoldReason(live({ labelSource: 'manual', providerShipmentId: null }), deadline(1), NOW)).toBeNull();
    expect(sweepHoldReason(live({ providerCanceledAt: NOW }), deadline(1), NOW)).toBeNull();
    expect(sweepHoldReason(live({ carrierPolledAt: null }), deadline(1), NOW, false)).toBeNull();
  });
});

const ctx = (over: Partial<InboundCarrierCtx> = {}): InboundCarrierCtx => ({ requestStatus: 'en_transito', providerOn: true, pollMinutes: 60, stalledDays: 10, ...over });

describe('inboundCarrierOf (forma del DTO)', () => {
  it('sin guía viva ⇒ null', () => expect(inboundCarrierOf(live({ labelSource: 'manual' }), NOW, ctx())).toBeNull());
  it('entregado ⇒ deliveredAt = statusAt; estimatedDeliveryAt siempre null; sin alertas', () => {
    const at = new Date('2026-11-24T10:00:00.000Z');
    expect(inboundCarrierOf(live({ carrierStatus: 'delivered', carrierStatusAt: at }), NOW, ctx())).toEqual({
      status: 'delivered', statusAt: at.toISOString(), estimatedDeliveryAt: null, polledAt: live().carrierPolledAt!.toISOString(), deliveredAt: at.toISOString(), pollError: false, stalledDays: null,
    });
  });
  it('pollError tras 3 ciclos sin sondeo exitoso', () => {
    expect(inboundCarrierOf(live({ carrierPolledAt: new Date(NOW.getTime() - 2 * H) }), NOW, ctx())?.pollError).toBe(false);
    expect(inboundCarrierOf(live({ carrierPolledAt: new Date(NOW.getTime() - 3 * H) }), NOW, ctx())?.pollError).toBe(true);
  });
  it('I-7: pollError es false en `recibida` o posteriores y con el proveedor apagado', () => {
    const old = live({ carrierPolledAt: new Date(NOW.getTime() - 30 * H) });
    expect(inboundCarrierOf(old, NOW, ctx())?.pollError).toBe(true);
    for (const st of ['recibida', 'verificacion', 'aprobada', 'pagada', 'expirada']) expect(inboundCarrierOf(old, NOW, ctx({ requestStatus: st }))?.pollError).toBe(false);
    // B-3: con el proveedor APAGADO no hay bloque de rastreo (como la guía del vendedor): la pantalla dice «Sin rastreo automático».
    expect(inboundCarrierOf(old, NOW, ctx({ providerOn: false }))).toBeNull();
  });
  it('G3-3: en_transito sin escaneo nuevo hace ≥ N días ⇒ stalledDays; antes o con otro estado ⇒ null', () => {
    const scan = (days: number) => live({ carrierStatus: 'in_transit', carrierStatusAt: new Date(NOW.getTime() - days * 24 * H), carrierPolledAt: new Date(NOW.getTime() - H) });
    expect(inboundCarrierOf(scan(10), NOW, ctx())?.stalledDays).toBe(10);
    expect(inboundCarrierOf(scan(9), NOW, ctx())?.stalledDays).toBeNull();
    expect(inboundCarrierOf(scan(30), NOW, ctx({ requestStatus: 'aceptada' }))?.stalledDays).toBeNull();
    expect(inboundCarrierOf(scan(30), NOW, ctx({ providerOn: false }))).toBeNull();
  });
});
