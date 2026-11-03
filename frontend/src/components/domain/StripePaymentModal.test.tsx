import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithIntl } from '@/test/render';
import { config } from '@/lib/config';

/**
 * Paquete A (dueño, `HECHOS.md` 2026-11-02 «Checkout con menos captura: paquete A…» (5)): pasar a Stripe el correo
 * y el nombre que ya conocemos, para que el `PaymentElement` (y Link) no los vuelva a pedir. Solo prellenado:
 * ⛔ ni montos ni creación del PaymentIntent. Se prueba la rama REAL con un doble de `@stripe/react-stripe-js`.
 */
const { paymentElementProps } = vi.hoisted(() => ({ paymentElementProps: [] as unknown[] }));
vi.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PaymentElement: (props: unknown) => {
    paymentElementProps.push(props);
    return <div data-testid="payment-element" />;
  },
  useStripe: () => null,
  useElements: () => null,
}));
vi.mock('@stripe/stripe-js', () => ({ loadStripe: () => Promise.resolve(null) }));

import { StripePaymentModal } from './StripePaymentModal';

const lastOptions = () =>
  (paymentElementProps[paymentElementProps.length - 1] as { options?: { defaultValues?: { billingDetails?: unknown } } } | undefined)
    ?.options;

describe('StripePaymentModal · billingDetails conocidos al PaymentElement', () => {
  let useMocks: boolean;
  beforeEach(() => {
    useMocks = config.useMocks;
    (config as { useMocks: boolean }).useMocks = false;
    paymentElementProps.length = 0;
  });
  afterEach(() => {
    (config as { useMocks: boolean }).useMocks = useMocks;
  });

  const base = { open: true, onClose: vi.fn(), clientSecret: 'pi_1_secret', returnUrl: 'https://x/y', onConfirmed: vi.fn() };

  it('correo y nombre ⇒ `defaultValues.billingDetails`', () => {
    renderWithIntl(<StripePaymentModal {...base} billingDetails={{ email: 'ana@example.com', name: 'Ana López' }} />, 'es');
    expect(screen.getByTestId('payment-element')).toBeInTheDocument();
    expect(lastOptions()).toEqual({ defaultValues: { billingDetails: { email: 'ana@example.com', name: 'Ana López' } } });
  });

  it('un valor vacío no viaja (no se le pasa a Stripe un nombre en blanco)', () => {
    renderWithIntl(<StripePaymentModal {...base} billingDetails={{ email: 'ana@example.com', name: '  ' }} />, 'es');
    expect(lastOptions()).toEqual({ defaultValues: { billingDetails: { email: 'ana@example.com' } } });
  });

  it('sin datos conocidos, el PaymentElement se monta como hoy (sin `options`)', () => {
    renderWithIntl(<StripePaymentModal {...base} />, 'es');
    expect(lastOptions()).toBeUndefined();
  });
});
