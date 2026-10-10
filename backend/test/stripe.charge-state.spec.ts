import Stripe from 'stripe';
import { ConfigService } from '@nestjs/config';
import { StripeService } from '../src/modules/payments/stripe.service';
import { BusinessException } from '../src/common/business.exception';

/**
 * 💰 v1.84 LIVE-5 · C2 (API_CONTRACT §14.5) — `StripeService.chargeState`: la lectura fresca del cobro que sustituye a
 * la lista NO MEDIDA de códigos de disputa como puerta del SPEI. Aquí, el mapeo de la respuesta del SDK (doble del
 * cliente). Las decisiones de cada verbo (CS-1…CS-6) viven en `test/integration/replacement-cases.e2e-spec.ts`.
 *
 * ⛔ NO MEDIDO contra Stripe real: en este entorno no hay claves de prueba. Lo que fija esta prueba es la forma
 * documentada del SDK (`latest_charge.disputed`, `amount_refunded`, `StripeInvalidRequestError.code ===
 * 'resource_missing'`).
 */
function build(retrieve: jest.Mock) {
  const svc = new StripeService({ get: () => 'sk_test_unit' } as unknown as ConfigService);
  (svc as unknown as { client: unknown }).client = { paymentIntents: { retrieve } };
  return svc;
}

const invalid = (code: string) =>
  new Stripe.errors.StripeInvalidRequestError({ message: code, type: 'invalid_request_error', code } as never);

describe('StripeService.chargeState — LIVE-5', () => {
  it('pide el PI con `expand: [latest_charge]`', async () => {
    const retrieve = jest.fn(async () => ({ id: 'pi_1', latest_charge: { disputed: false, amount_refunded: 0 } }));
    await build(retrieve).chargeState('pi_1');
    expect(retrieve).toHaveBeenCalledWith('pi_1', { expand: ['latest_charge'] });
  });

  it('cargo disputado ⇒ `{ mode: current, disputed: true }` con lo reembolsado', async () => {
    const retrieve = jest.fn(async () => ({ id: 'pi_1', latest_charge: { disputed: true, amount_refunded: 1500 } }));
    expect(await build(retrieve).chargeState('pi_1')).toEqual({ mode: 'current', disputed: true, amountRefundedCents: 1500 });
  });

  it('cargo limpio ⇒ `disputed: false`; sin cargo (o sin expandir) ⇒ `false`, `0`', async () => {
    expect(
      await build(jest.fn(async () => ({ latest_charge: { disputed: false, amount_refunded: 0 } }))).chargeState('pi_1'),
    ).toEqual({ mode: 'current', disputed: false, amountRefundedCents: 0 });
    expect(await build(jest.fn(async () => ({ latest_charge: null }))).chargeState('pi_1')).toEqual({
      mode: 'current',
      disputed: false,
      amountRefundedCents: 0,
    });
    expect(await build(jest.fn(async () => ({ latest_charge: 'ch_1' }))).chargeState('pi_1')).toEqual({
      mode: 'current',
      disputed: false,
      amountRefundedCents: 0,
    });
  });

  it('`resource_missing` ⇒ `{ mode: other }` (el PI vive en el OTRO modo) — CS-2', async () => {
    const retrieve = jest.fn(async () => {
      throw invalid('resource_missing');
    });
    expect(await build(retrieve).chargeState('pi_1')).toEqual({ mode: 'other' });
  });

  it.each([
    ['otro error de petición', () => invalid('parameter_invalid_empty')],
    ['error de conexión', () => new Stripe.errors.StripeConnectionError({ message: 'down' } as never)],
    ['error de API (5xx)', () => new Stripe.errors.StripeAPIError({ message: '500' } as never)],
    ['error cualquiera', () => new Error('boom')],
  ])('%s ⇒ lanza 503 PAYMENT_PROVIDER_UNAVAILABLE (⛔ nunca «no disputado») — CS-3', async (_n, mk) => {
    const retrieve = jest.fn(async () => {
      throw mk();
    });
    const err = await build(retrieve)
      .chargeState('pi_1')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BusinessException);
    expect((err as BusinessException).getStatus()).toBe(503);
    expect((err as BusinessException).getResponse()).toMatchObject({ code: 'PAYMENT_PROVIDER_UNAVAILABLE' });
  });
});
