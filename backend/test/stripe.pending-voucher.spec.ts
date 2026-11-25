import { ConfigService } from '@nestjs/config';
import { StripeService } from '../src/modules/payments/stripe.service';

/**
 * §BOVEDA-COBRADA-SIN-PIEZAS (punto 2) — `getPendingVoucherExpiry`: el vencimiento de un voucher/transferencia pendiente se LEE DE
 * STRIPE (`requires_action` + `next_action`), nunca de tabla. Cualquier otro estado, o un fallo de lectura ⇒ `null` (el barrido ya
 * trata «no se pudo cancelar» como «no liberar»).
 */
function svc(retrieve: jest.Mock) {
  const s = new StripeService(new ConfigService({}));
  Object.defineProperty(s, 'stripe', { get: () => ({ paymentIntents: { retrieve } }) });
  return s;
}

describe('StripeService.getPendingVoucherExpiry', () => {
  const at = 1_900_000_000;
  it('requires_action con voucher OXXO ⇒ su vencimiento', async () => {
    const r = jest.fn(async () => ({ status: 'requires_action', next_action: { oxxo_display_details: { expires_after: at } } }));
    expect((await svc(r).getPendingVoucherExpiry('pi_x'))!.getTime()).toBe(at * 1000);
  });
  it('transferencia bancaria pendiente ⇒ su vencimiento', async () => {
    const r = jest.fn(async () => ({ status: 'requires_action', next_action: { display_bank_transfer_instructions: { expires_at: at } } }));
    expect((await svc(r).getPendingVoucherExpiry('pi_x'))!.getTime()).toBe(at * 1000);
  });
  it('tarjeta (requires_payment_method / 3DS sin voucher) o cualquier otro estado ⇒ null', async () => {
    for (const status of ['requires_payment_method', 'processing', 'succeeded', 'canceled']) {
      expect(await svc(jest.fn(async () => ({ status, next_action: null }))).getPendingVoucherExpiry('pi_x')).toBeNull();
    }
    expect(await svc(jest.fn(async () => ({ status: 'requires_action', next_action: { use_stripe_sdk: {} } }))).getPendingVoucherExpiry('pi_x')).toBeNull();
  });
  it('un fallo de lectura ⇒ null (no inventa un plazo)', async () => {
    expect(await svc(jest.fn(async () => { throw new Error('network'); })).getPendingVoucherExpiry('pi_x')).toBeNull();
  });
});
