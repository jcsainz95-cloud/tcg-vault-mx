/** §BUYLIST-FLUJO F1 — funciones puras `computePayoutNetCents`, `payoutDTOOf`, `statusClockOf` (datos ficticios). */
import { computePayoutNetCents, payoutDTOOf, statusClockOf } from '../src/modules/buylist/buylist-payout';

const DAY = 86_400_000;

describe('computePayoutNetCents', () => {
  it('neto = bruto aprobado - envio', () => {
    expect(computePayoutNetCents({ approvedTotalCents: 50_000, offerGrossCents: 60_000, quotedTotalCents: 70_000, offerShippingFeeCents: 18_000 })).toEqual({
      grossCents: 50_000, shippingFeeCents: 18_000, netCents: 32_000,
    });
  });
  it('cascada: approved null => ofertado; ambos null => cotizado; todo null => 0', () => {
    expect(computePayoutNetCents({ approvedTotalCents: null, offerGrossCents: 60_000, quotedTotalCents: 70_000, offerShippingFeeCents: 0 }).grossCents).toBe(60_000);
    expect(computePayoutNetCents({ approvedTotalCents: null, offerGrossCents: null, quotedTotalCents: 70_000, offerShippingFeeCents: null }).grossCents).toBe(70_000);
    expect(computePayoutNetCents({})).toEqual({ grossCents: 0, shippingFeeCents: 0, netCents: 0 });
  });
  it('approvedTotalCents = 0 NO cae al ofertado (cero es un valor)', () => {
    expect(computePayoutNetCents({ approvedTotalCents: 0, offerGrossCents: 60_000, quotedTotalCents: 70_000, offerShippingFeeCents: 0 }).grossCents).toBe(0);
  });
  it('fila pre-M-46 (envio null) => envio 0; neto nunca negativo; enteros', () => {
    expect(computePayoutNetCents({ approvedTotalCents: 5_000, offerShippingFeeCents: null }).netCents).toBe(5_000);
    expect(computePayoutNetCents({ approvedTotalCents: 5_000, offerShippingFeeCents: 18_000 }).netCents).toBe(0);
    for (const g of [0, 1, 999, 18_000, 123_457]) {
      const n = computePayoutNetCents({ approvedTotalCents: g, offerShippingFeeCents: 18_000 }).netCents;
      expect(Number.isInteger(n) && n >= 0).toBe(true);
    }
  });
});

describe('payoutDTOOf', () => {
  const base = { approvedTotalCents: 50_000, offerGrossCents: 60_000, quotedTotalCents: 70_000, offerShippingFeeCents: 18_000 };
  it('verificacion/aprobada: proyeccion; isFinal=false con lineas sin decidir', () => {
    for (const status of ['verificacion', 'aprobada']) {
      expect(payoutDTOOf({ ...base, status }, { lines: [], clabeOnFile: true })).toEqual({
        grossCents: 50_000, shippingFeeCents: 18_000, netCents: 32_000, isFinal: true, clabeOnFile: true,
      });
      // con lineas `buy` sin decidir: proyeccion §3.1 (al pactado), isFinal=false.
      const lines = [
        { id: 'a', offerDecision: 'buy', itemStatus: 'aprobada', offeredPriceCents: 30_000, approvedPriceCents: 30_000 },
        { id: 'b', offerDecision: 'buy', itemStatus: 'verificacion', offeredPriceCents: 20_000 },
      ];
      expect(payoutDTOOf({ ...base, status }, { lines, clabeOnFile: false })).toEqual({
        grossCents: 50_000, shippingFeeCents: 18_000, netCents: 32_000, isFinal: false, clabeOnFile: false,
      });
    }
  });
  it('pagada: lo SELLADO; resto de estados: null', () => {
    expect(payoutDTOOf({ ...base, status: 'pagada', payoutNetCents: 31_000 }, { lines: [], clabeOnFile: true })?.netCents).toBe(31_000);
    for (const status of ['cotizada', 'ofertada', 'aceptada', 'en_transito', 'recibida', 'rechazada', 'abandonada', 'expirada']) {
      expect(payoutDTOOf({ ...base, status }, { lines: [], clabeOnFile: true })).toBeNull();
    }
  });
});

describe('statusClockOf', () => {
  const now = new Date('2026-11-22T12:00:00Z');
  const d = (days: number) => new Date(now.getTime() - days * DAY);
  it('ofertada: since = offerSentAt, dueAt = plazo de aceptacion, overdue solo si vencio', () => {
    const r = { status: 'ofertada', createdAt: d(9), offerSentAt: d(3), offerAcceptDeadlineAt: new Date(now.getTime() + DAY) };
    expect(statusClockOf(r, now)).toEqual({ since: d(3).toISOString(), waitingDays: 3, dueAt: r.offerAcceptDeadlineAt.toISOString(), overdue: false });
    expect(statusClockOf({ ...r, offerAcceptDeadlineAt: d(1) }, now).overdue).toBe(true);
  });
  it('cotizada sin plazo: dueAt null y overdue false; ancla en createdAt', () => {
    expect(statusClockOf({ status: 'cotizada', createdAt: d(2) }, now)).toEqual({ since: d(2).toISOString(), waitingDays: 2, dueAt: null, overdue: false });
  });
  it('aprobada: abandono = receivedAt + 30 d', () => {
    const r = { status: 'aprobada', createdAt: d(40), receivedAt: d(31), approvedAt: d(1) };
    const c = statusClockOf(r, now);
    expect(c.since).toBe(d(1).toISOString());
    expect(c.dueAt).toBe(new Date(d(31).getTime() + 30 * DAY).toISOString());
    expect(c.overdue).toBe(true);
  });
  it('aceptada: shipDeadlineAt, o guideDueAt si no hay', () => {
    expect(statusClockOf({ status: 'aceptada', createdAt: d(5), acceptedAt: d(2), shipDeadlineAt: d(-3) }, now).dueAt).toBe(d(-3).toISOString());
    expect(statusClockOf({ status: 'aceptada', createdAt: d(5), acceptedAt: d(2), guideDueAt: d(-1) }, now).dueAt).toBe(d(-1).toISOString());
  });
  it('waitingDays entero y >= 0 (marca futura => 0)', () => {
    expect(statusClockOf({ status: 'cotizada', createdAt: new Date(now.getTime() + DAY) }, now).waitingDays).toBe(0);
    expect(Number.isInteger(statusClockOf({ status: 'cotizada', createdAt: new Date(now.getTime() - 2.7 * DAY) }, now).waitingDays)).toBe(true);
  });
});
