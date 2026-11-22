/**
 * §BUYLIST-FLUJO F2c — proyecciones puras (`buylist-flujo-dto.ts`) y el neto «si el vendedor acepta» (`buylist-payout.ts`).
 * Datos ficticios, centavos enteros.
 */
import { agreedPriceCentsOf, pickupDTOOf, revisionCutoff, revisionDTOOf, revisionExpiresAt } from '../src/modules/buylist/buylist-flujo-dto';
import { computePayoutNetCents, projectPayoutNetCents } from '../src/modules/buylist/buylist-payout';

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

// §BUYLIST-FLUJO §3.1 — UNA funcion del neto. Escenarios S2/S3/S5/S8 de qa + N aleatorias: vista previa = netIfAcceptedCents = final.
type L = Parameters<typeof projectPayoutNetCents>[0]['lines'][number];
const buy = (id: string, itemStatus: string, offered: number, extra: Partial<L> = {}): L => ({ id, offerDecision: 'buy', itemStatus, offeredPriceCents: offered, ...extra });
const FEE = 18000;
const P = (lines: L[], override?: { itemId: string; priceCents: number }) => projectPayoutNetCents({ lines, offerShippingFeeCents: FEE }, override);

describe('projectPayoutNetCents (§3.1)', () => {
  it('S2 baja pendiente + otra aprobada: la pendiente a su propuesta, aprobada a lo aprobado', () => {
    const lines = [buy('a', 'aprobada', 40000, { approvedPriceCents: 40000 }), buy('b', 'ajustada', 60000, { revisionState: 'pending', revisedPriceCents: 45000 })];
    expect(P(lines)).toMatchObject({ grossCents: 85000, netCents: 85000 - FEE, isFinal: false });
  });
  it('S3 carta SIN decidir cuenta a lo pactado (no se omite) y isFinal=false', () => {
    const lines = [buy('a', 'aprobada', 40000, { approvedPriceCents: 40000 }), buy('b', 'verificacion', 30000)];
    expect(P(lines)).toMatchObject({ grossCents: 70000, isFinal: false });
  });
  it('S5 rechazadas y not_received quedan FUERA; skip tambien', () => {
    const lines = [
      buy('a', 'aprobada', 40000, { approvedPriceCents: 40000 }),
      buy('b', 'rechazada', 50000),
      buy('c', 'rechazada', 20000, { rejectionCode: 'not_received' }),
      { id: 'd', offerDecision: 'skip', itemStatus: 'verificacion', offeredPriceCents: null } as L,
    ];
    expect(P(lines)).toMatchObject({ grossCents: 40000, netCents: 40000 - FEE, isFinal: true });
  });
  it('S8 envio mayor que el bruto => neto 0, nunca negativo', () => {
    expect(P([buy('a', 'aprobada', 5000, { approvedPriceCents: 5000 })])).toMatchObject({ grossCents: 5000, netCents: 0, isFinal: true });
  });
  it('baja HUERFANA (pending con linea ya aprobada) no cuenta como baja viva: se usa lo aprobado y isFinal=true', () => {
    const lines = [buy('a', 'aprobada', 60000, { approvedPriceCents: 60000, revisionState: 'pending', revisedPriceCents: 45000 })];
    expect(P(lines)).toMatchObject({ grossCents: 60000, isFinal: true });
  });
  it('sin lineas buy (pre-ciclo) cae a computePayoutNetCents', () => {
    const r = projectPayoutNetCents({ lines: [], offerShippingFeeCents: FEE, legacy: { approvedTotalCents: 50000 } });
    expect(r).toEqual({ ...computePayoutNetCents({ approvedTotalCents: 50000, offerShippingFeeCents: FEE }), isFinal: true });
  });
  it('N=200 solicitudes aleatorias: vista previa == netIfAccepted == neto final tras aceptar', () => {
    // mulberry32: los bits bajos de un LCG ciclan con periodo corto (un `% 4` repetiria el mismo patron).
    let seed = 7;
    const rnd = (n: number) => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n);
    };
    for (let k = 0; k < 200; k++) {
      const n = 1 + rnd(5);
      const lines: L[] = Array.from({ length: n }, (_, i) => {
        const off = 1000 * (1 + rnd(60));
        const t = rnd(5);
        if (t === 0) return buy(`l${i}`, 'aprobada', off, { approvedPriceCents: off });
        if (t === 1) return buy(`l${i}`, 'rechazada', off, rnd(2) ? { rejectionCode: 'not_received' } : {});
        if (t === 2) return buy(`l${i}`, 'ajustada', off, { revisionState: 'pending', revisedPriceCents: 1 + rnd(off - 1) });
        if (t === 3) return { id: `l${i}`, offerDecision: 'skip', itemStatus: 'verificacion', offeredPriceCents: null };
        return buy(`l${i}`, 'verificacion', off);
      });
      const target = lines.find((l) => l.offerDecision === 'buy' && l.itemStatus !== 'rechazada' && l.itemStatus !== 'aprobada');
      if (!target) continue;
      const revised = 1 + rnd((target.offeredPriceCents as number) - 1 || 1);
      const preview = P(lines, { itemId: target.id, priceCents: revised });
      // la linea queda propuesta (pending) y despues el vendedor acepta: todo lo demas igual.
      const proposed = lines.map((l) => (l.id === target.id ? { ...l, itemStatus: 'ajustada', revisionState: 'pending', revisedPriceCents: revised } : l));
      expect(P(proposed).netCents).toBe(preview.netCents);
      const netIf = P(proposed, { itemId: target.id, priceCents: revised }).netCents;
      expect(netIf).toBe(preview.netCents);
      const accepted = proposed.map((l) => (l.id === target.id ? { ...l, itemStatus: 'aprobada', revisionState: 'accepted', approvedPriceCents: revised } : l));
      expect(P(accepted).netCents).toBe(preview.netCents);
    }
  });
});
