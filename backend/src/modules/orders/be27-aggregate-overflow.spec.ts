import { OrdersService } from './orders.service';
import { BusinessException } from '../../common/business.exception';
import { computeCartBreakdown, MAX_CENTS, StripeFeeConfig } from '../../common/money';
import { GuestCheckoutService } from './guest-checkout.service';
import { SettingKey } from '../settings/settings.constants';

/**
 * MS-2 (BE-27) — capa de negocio: `representableOrThrow` es la FUENTE ÚNICA que traduce el throw de
 * overflow de agregado (`grossUpTotal`, `money.ts`) a `AMOUNT_TOO_LARGE` (422), para las dos rutas
 * que PERSISTEN una Order. Un agregado nunca se clampa (recortar = subcobro): se RECHAZA.
 */
function svc(): OrdersService {
  return new OrdersService({} as never, {} as never, {} as never, {} as never, {} as never);
}

const fee: StripeFeeConfig = { stripePct: 0.036, stripeFixedCents: 300, stripeFeeIvaPct: 0.16 };

describe('MS-2 — OrdersService.representableOrThrow', () => {
  it('traduce el overflow de agregado (throw MAX_CENTS) a AMOUNT_TOO_LARGE (422)', () => {
    const s = svc();
    let caught: unknown;
    try {
      // D56: `G = S` (el IVA va dentro) ⇒ el umbral de no-representable subió. Ver la nota en
      // `common/be27-aggregate-overflow.spec.ts`.
      s.representableOrThrow(() => computeCartBreakdown(2_100_000_000, 16, fee));
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(BusinessException);
    expect((caught as BusinessException).code).toBe('AMOUNT_TOO_LARGE');
    expect((caught as BusinessException).getStatus()).toBe(422);
  });

  it('deja pasar un breakdown normal sin tocarlo', () => {
    const s = svc();
    const b = s.representableOrThrow(() => computeCartBreakdown(100000, 16, fee));
    expect(b.subtotalCents).toBe(100000);
    expect(b.totalCents).toBeGreaterThan(0);
  });

  it('NO enmascara otros Error (mala config de fee se propaga como 500 crudo, no AMOUNT_TOO_LARGE)', () => {
    const s = svc();
    const badFee: StripeFeeConfig = { stripePct: 2, stripeFixedCents: 300, stripeFeeIvaPct: 0.16 };
    // effectivePct >= 1 → grossUpTotal lanza un Error de config (sin 'MAX_CENTS' en el mensaje).
    expect(() => s.representableOrThrow(() => computeCartBreakdown(100000, 16, badFee))).toThrow(
      /effective stripe pct/,
    );
  });
});

/**
 * 💰 TL-ENV-4 — el `quote` de invitado (read-only) con un dial de envío directo en el tope (`MAX_CENTS`, el máximo que
 * admite el validador) da `S + E` no representable: ⇒ 422 `AMOUNT_TOO_LARGE` por la fuente única, ⛔ nunca el `Error`
 * pelado de `grossUpTotal` (500). Determinista (N=1 dicho como tal).
 */
describe('TL-ENV-4 — GuestCheckoutService.quoteBreakdowns pasa por representableOrThrow', () => {
  const dials: Record<string, number> = {
    [SettingKey.DIRECT_SHIP_CARDS_FEE_CENTS]: MAX_CENTS,
    [SettingKey.DIRECT_SHIP_SEALED_FEE_CENTS]: 17500,
    [SettingKey.DIRECT_SHIP_FREE_FROM_CENTS]: 400000,
  };
  const settings = { getStripeFee: async () => fee, getNumber: async (k: string) => dials[k] };
  const guest = () =>
    new GuestCheckoutService({} as never, svc(), settings as never, {} as never, {} as never, {} as never);
  type QB = (S: number, itemsS: number, empty: boolean, itemsEmpty: boolean, iva: { ivaRatePct: number }, choice: null, kind: string) => Promise<{ breakdown: { totalCents: number; shippingFeeCents: number } }>;
  const quoteBreakdowns = (g: GuestCheckoutService): QB => (g as unknown as { quoteBreakdowns: QB }).quoteBreakdowns.bind(g);

  it('solo cartas con `direct_ship_cards_fee_cents = MAX_CENTS` ⇒ 422 AMOUNT_TOO_LARGE', async () => {
    const caught = await quoteBreakdowns(guest())(50000, 50000, false, false, { ivaRatePct: 16 }, null, 'cards_only').catch((e: unknown) => e);
    expect(caught).toBeInstanceOf(BusinessException);
    expect((caught as BusinessException).code).toBe('AMOUNT_TOO_LARGE');
    expect((caught as BusinessException).getStatus()).toBe(422);
  });

  it('el mismo quote con el dial sellado (17500) sigue cotizando', async () => {
    const r = await quoteBreakdowns(guest())(50000, 50000, false, false, { ivaRatePct: 16 }, null, 'sealed');
    expect(r.breakdown.shippingFeeCents).toBe(17500);
    expect(r.breakdown.totalCents).toBeGreaterThan(67500);
  });
});
