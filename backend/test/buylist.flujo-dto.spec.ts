/**
 * §BUYLIST-FLUJO F2c — proyecciones puras (`buylist-flujo-dto.ts`) y el neto «si el vendedor acepta» (`buylist-payout.ts`).
 * Datos ficticios, centavos enteros.
 */
import { agreedPriceCentsOf, pickupDTOOf, revisionCutoff, revisionDTOOf, revisionExpiresAt } from '../src/modules/buylist/buylist-flujo-dto';
import { computePayoutNetCents, netIfRevisionAcceptedCents } from '../src/modules/buylist/buylist-payout';

const T = new Date('2026-11-20T12:00:00Z');
const pending = {
  itemStatus: 'ajustada',
  offeredPriceCents: 60000,
  revisedPriceCents: 45000,
  revisionState: 'pending' as const,
  revisionProposedAt: T,
  revisionReasonCode: 'condition_mismatch' as const,
  revisionNote: null,
};

describe('revisionDTOOf', () => {
  it('admin con reasonCode y vencimiento = propuesta + 7 d; vendedor SIN reasonCode, con reasonText en su idioma', () => {
    const a = revisionDTOOf(pending, 'admin') as any;
    expect(a).toMatchObject({ state: 'pending', proposedCents: 45000, previousCents: 60000, reasonCode: 'condition_mismatch' });
    expect(a.expiresAt.getTime() - T.getTime()).toBe(7 * 864e5);
    const c = revisionDTOOf(pending, 'client', { locale: 'en' }) as any;
    expect(c).not.toHaveProperty('reasonCode');
    expect(c.reasonText).toBe('The card arrived in a different condition than declared');
    expect((revisionDTOOf(pending, 'client', { locale: 'es' }) as any).reasonText).toBe('La carta llegó en una condición distinta a la declarada');
  });
  it('sin baja => null; con dinero redactado => cifras null', () => {
    expect(revisionDTOOf({ itemStatus: 'verificacion' }, 'admin')).toBeNull();
    const r = revisionDTOOf(pending, 'client', { redactMoney: true }) as any;
    expect(r.proposedCents).toBeNull();
    expect(r.previousCents).toBeNull();
  });
  it('el corte del barrido y el vencimiento son UNA cuenta: propuesta a exactamente 7 d ya vencio', () => {
    expect(revisionCutoff(revisionExpiresAt(T)).getTime()).toBe(T.getTime());
  });
});

describe('agreedPriceCentsOf / pickupDTOOf', () => {
  it('pactado = approved SOLO con baja aceptada; si no, lo ofertado', () => {
    expect(agreedPriceCentsOf({ itemStatus: 'aprobada', offeredPriceCents: 60000, approvedPriceCents: 45000, revisionState: 'accepted' })).toBe(45000);
    expect(agreedPriceCentsOf({ itemStatus: 'aprobada', offeredPriceCents: 60000, approvedPriceCents: 60000 })).toBe(60000);
    expect(agreedPriceCentsOf({ itemStatus: 'verificacion', offeredPriceCents: null })).toBeNull();
  });
  it('pickup: solo rechazadas, null si not_received, plazos 7/30 desde rejectedAt', () => {
    expect(pickupDTOOf({ itemStatus: 'verificacion' })).toBeNull();
    expect(pickupDTOOf({ itemStatus: 'rechazada', rejectionCode: 'not_received', rejectedAt: T })).toBeNull();
    const p = pickupDTOOf({ itemStatus: 'rechazada', rejectionCode: 'wrong_card', rejectedAt: T, pickupMethod: 'in_person' })!;
    expect(p.method).toBe('in_person');
    expect(p.returnDeadlineAt!.getTime() - T.getTime()).toBe(7 * 864e5);
    expect(p.abandonDeadlineAt!.getTime() - T.getTime()).toBe(30 * 864e5);
  });
});

describe('netIfRevisionAcceptedCents — misma resta que computePayoutNetCents', () => {
  const base = { offerGrossCents: 100000, quotedTotalCents: 110000, offerShippingFeeCents: 18000 };
  it('con otra linea ya aprobada (40 000): bruto = 40 000 + propuesta', () => {
    const net = netIfRevisionAcceptedCents({ ...base, approvedTotalCents: 40000 }, pending)!;
    expect(net).toBe(computePayoutNetCents({ ...base, approvedTotalCents: 85000 }).netCents);
    expect(net).toBe(85000 - 18000);
  });
  it('sin aprobadas: cae a lo ofertado y sustituye la linea (100 000 - 60 000 + 45 000)', () => {
    expect(netIfRevisionAcceptedCents({ ...base, approvedTotalCents: null }, pending)).toBe(85000 - 18000);
  });
  it('nunca negativo; sin propuesta => null', () => {
    expect(netIfRevisionAcceptedCents({ ...base, offerShippingFeeCents: 999999, approvedTotalCents: 0 }, pending)).toBe(0);
    expect(netIfRevisionAcceptedCents(base, { offeredPriceCents: 1, revisedPriceCents: null })).toBeNull();
  });
});
