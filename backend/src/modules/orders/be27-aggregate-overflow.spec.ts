import { OrdersService } from './orders.service';
import { BusinessException } from '../../common/business.exception';
import { computeCartBreakdown, StripeFeeConfig } from '../../common/money';

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
      s.representableOrThrow(() => computeCartBreakdown(2_000_000_000, 16, fee));
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
