import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithIntl } from '@/test/render';
import { OrderItemStatusLine } from './OrderItemStatusLine';

/** SC-6 (DESIGN_SYSTEM §60.2 a): la línea se elige por `refund.kind`, ⛔ nunca por `reason`. */
describe('SC-6 · OrderItemStatusLine por refund.kind', () => {
  it('after_delivery + arrived_damaged ⇒ «Reembolsada · …» y «llegó en mala condición»; ⛔ sin «No salió»', () => {
    const { container } = renderWithIntl(
      <OrderItemStatusLine
        refund={{ kind: 'after_delivery', reason: 'arrived_damaged', amountCents: 31458, refundedAt: '2026-10-05T00:00:00Z' }}
      />,
      'es',
    );
    const line = screen.getByTestId('item-refund-after-delivery');
    expect(line).toHaveTextContent(/^Reembolsada · te devolvimos/);
    expect(line).toHaveTextContent('llegó en mala condición');
    expect(container.textContent).not.toMatch(/No salió/);
  });

  it('after_delivery + not_arrived (EN) ⇒ “Refunded …” · “didn’t arrive”', () => {
    renderWithIntl(
      <OrderItemStatusLine
        refund={{ kind: 'after_delivery', reason: 'not_arrived', amountCents: 100, refundedAt: '2026-10-05T00:00:00Z' }}
      />,
      'en',
    );
    expect(screen.getByTestId('item-refund-after-delivery')).toHaveTextContent("Refunded · we refunded you");
    expect(screen.getByTestId('item-refund-after-delivery')).toHaveTextContent("didn't arrive");
  });

  it.each([undefined, 'missing_at_prep'] as const)('kind %s (backend anterior o al preparar) ⇒ «No salió» (sin cambio)', (kind) => {
    renderWithIntl(
      <OrderItemStatusLine refund={{ kind, reason: 'damaged', amountCents: 100, refundedAt: '2026-10-05T00:00:00Z' }} />,
      'es',
    );
    expect(screen.getByTestId('item-refund')).toHaveTextContent(/^No salió · te devolvimos/);
    expect(screen.getByTestId('item-refund')).toHaveTextContent('llegó dañada');
  });
});
