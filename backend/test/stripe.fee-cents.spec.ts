import { ConfigService } from '@nestjs/config';
import { StripeService } from '../src/modules/payments/stripe.service';

/**
 * D9 (docs/specs/D9_COMISION.md §3) — `StripeService.getStripeFeeCents`: el costo REAL de Stripe (`balance_transaction.fee`).
 * Doble del cliente del SDK; la forma documentada es `latest_charge.balance_transaction.{fee,currency}`.
 * ⛔ NO MEDIDO contra Stripe real (sin claves de prueba aquí). Nunca 0 silencioso: todo lo dudoso ⇒ `null` (el P&L estima).
 */
function build(retrieve: jest.Mock) {
  const svc = new StripeService({ get: () => 'sk_test_unit' } as unknown as ConfigService);
  (svc as unknown as { client: unknown }).client = { paymentIntents: { retrieve } };
  return svc;
}
const pi = (bt: unknown) => jest.fn(async () => ({ id: 'pi_1', latest_charge: { balance_transaction: bt } }));

describe('StripeService.getStripeFeeCents — D9', () => {
  it('expande latest_charge.balance_transaction y devuelve el fee en centavos MXN', async () => {
    const retrieve = pi({ fee: 1204, currency: 'mxn' });
    expect(await build(retrieve).getStripeFeeCents('pi_1')).toBe(1204);
    expect(retrieve).toHaveBeenCalledWith('pi_1', { expand: ['latest_charge.balance_transaction'] });
  });
  it('fee 0 real es 0 (no se confunde con «sin dato»)', async () => {
    expect(await build(pi({ fee: 0, currency: 'mxn' })).getStripeFeeCents('pi_1')).toBe(0);
  });
  it.each([
    ['sin balance_transaction (aún no disponible)', null],
    ['balance_transaction sin expandir (string)', 'txn_1'],
    ['moneda distinta de MXN', { fee: 80, currency: 'usd' }],
    ['fee no entero', { fee: 12.5, currency: 'mxn' }],
    ['fee negativo', { fee: -1, currency: 'mxn' }],
  ])('%s ⇒ null (nunca un 0 inventado)', async (_n, bt) => {
    expect(await build(pi(bt)).getStripeFeeCents('pi_1')).toBeNull();
  });
  it('sin cargo ⇒ null; la lectura que falla ⇒ null (best-effort, no tumba el webhook)', async () => {
    expect(await build(jest.fn(async () => ({ latest_charge: null }))).getStripeFeeCents('pi_1')).toBeNull();
    expect(await build(jest.fn(async () => { throw new Error('red'); })).getStripeFeeCents('pi_1')).toBeNull();
  });
});
