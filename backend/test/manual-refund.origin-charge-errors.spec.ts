import { HttpStatus } from '@nestjs/common';
import { ManualRefundService } from '../src/modules/payments/refunds/manual-refund.service';
import { BusinessException } from '../src/common/business.exception';
import type { PrismaService } from '../src/prisma/prisma.service';
import type { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';
import type { StripeService } from '../src/modules/payments/stripe.service';

/**
 * 💰 v1.84 LIVE-5 · C2 — condición C-2 (c) del techlead (D-7): `originChargeOf` traduce a `{ kind: 'unavailable' }`
 * SOLO el `503 PAYMENT_PROVIDER_UNAVAILABLE` con el que `StripeService.chargeState` dice «Stripe no respondió»
 * (API_CONTRACT §14.5). Cualquier otro error es un defecto NUESTRO (un `TypeError`, un doble mal cableado, otro código):
 * ⛔ no se disfraza de «Stripe caído» — en `paid` eso registraría la transferencia sin la confirmación de origen no
 * liquidado, y en `reveal-clabe` pintaría el aviso equivocado. Se propaga (500 del filtro global, antes de toda tx).
 *
 * Mutación que esto caza: volver al `catch (e) { return { kind: 'unavailable' } }` sin condición.
 */
function build(chargeState: jest.Mock) {
  const prisma = {
    order: { findUnique: jest.fn(async () => ({ stripePaymentIntentId: 'pi_1' })) },
  } as unknown as PrismaService;
  const svc = new ManualRefundService(prisma, {} as PiiCryptoService, { chargeState } as unknown as StripeService);
  const originChargeOf = (id: string | null) =>
    (svc as unknown as { originChargeOf: (id: string | null) => Promise<unknown> }).originChargeOf(id);
  return { originChargeOf };
}

describe('LIVE-5 · originChargeOf — solo el 503 del proveedor es «unavailable»', () => {
  it('503 PAYMENT_PROVIDER_UNAVAILABLE (Stripe caído) ⇒ { kind: "unavailable" }', async () => {
    const { originChargeOf } = build(
      jest.fn(async () => {
        throw BusinessException.retriable('PAYMENT_PROVIDER_UNAVAILABLE', 'down');
      }),
    );
    await expect(originChargeOf('o1')).resolves.toEqual({ kind: 'unavailable' });
  });

  it('un error de programación (TypeError) se PROPAGA, no se lee como Stripe caído', async () => {
    const boom = new TypeError("Cannot read properties of undefined (reading 'disputed')");
    const { originChargeOf } = build(
      jest.fn(async () => {
        throw boom;
      }),
    );
    await expect(originChargeOf('o1')).rejects.toBe(boom);
  });

  it('otra BusinessException (otro código, aunque sea 503) se PROPAGA', async () => {
    const other = BusinessException.retriable('SHIPPING_PROVIDER_BUSY', 'otro');
    const { originChargeOf } = build(
      jest.fn(async () => {
        throw other;
      }),
    );
    await expect(originChargeOf('o1')).rejects.toBe(other);
  });

  it('PAYMENT_PROVIDER_UNAVAILABLE con un status que no es 503 se PROPAGA (no es la forma de chargeState)', async () => {
    const odd = new BusinessException('PAYMENT_PROVIDER_UNAVAILABLE', HttpStatus.CONFLICT, 'raro');
    const { originChargeOf } = build(
      jest.fn(async () => {
        throw odd;
      }),
    );
    await expect(originChargeOf('o1')).rejects.toBe(odd);
  });

  it('control: cobro limpio y «otro modo» siguen igual', async () => {
    const st = jest.fn();
    const { originChargeOf } = build(st);
    st.mockResolvedValueOnce({ mode: 'current', disputed: true, amountRefundedCents: 0 });
    await expect(originChargeOf('o1')).resolves.toEqual({ kind: 'current', disputed: true });
    st.mockResolvedValueOnce({ mode: 'other' });
    await expect(originChargeOf('o1')).resolves.toEqual({ kind: 'other' });
    await expect(originChargeOf(null)).resolves.toEqual({ kind: 'none' });
  });
});
