import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { ShippingQuoteLine } from './ShippingQuoteLine';
import type { ShippingQuoteState } from './use-shipping-quote';

const state = (fee: number): ShippingQuoteState => ({
  status: 'ready',
  quote: { quoteId: 'q', shippingFeeCents: fee, service: 'FedEx', etaDays: 1, expiresAt: '' },
  retry: vi.fn(),
  adopt: vi.fn(),
});

describe('§ENV3 · umbral medido DESPUÉS del descuento', () => {
  it('cotización 0 pero el desglose con descuento cobra envío ⇒ NO dice «Gratis», muestra lo cobrado', () => {
    renderWithProviders(<ShippingQuoteLine state={state(0)} chargedCents={21000} />, 'es');
    expect(screen.getByTestId('shipping-quote-amount')).toHaveTextContent('MX$210.00');
    expect(screen.queryByText('Gratis')).toBeNull();
  });
  it('sin descuento que lo cambie, manda la cotización; con envío 0 cobrado dice «Gratis»', () => {
    const { unmount } = renderWithProviders(<ShippingQuoteLine state={state(0)} />, 'es');
    expect(screen.getByTestId('shipping-quote-amount')).toHaveTextContent('Gratis');
    unmount();
    renderWithProviders(<ShippingQuoteLine state={state(21000)} chargedCents={0} />, 'en');
    expect(screen.getByTestId('shipping-quote-amount')).toHaveTextContent('Free');
  });
});
