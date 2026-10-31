import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import { RefundPromiseLine, ShippingFeeHint } from './ShippingFeeHint';

/**
 * T1a / T1b / T8 de la ficha (DESIGN_SYSTEM §CHK-MOVIL.4). ENV-F1: ⛔ ningún importe en i18n ni en el front;
 * salen de `GET /checkout/shipping-rule` (aquí con cifras raras para que un literal no pueda casar).
 */
const RULE = { cardsOnlyFeeCents: 10_101, sealedFeeCents: 17_777, freeFromCents: 412_300, currency: 'MXN' as const, ivaIncluded: true as const };

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('ShippingFeeHint (T1a/T1b) y RefundPromiseLine (T8)', () => {
  it('T1a: carta suelta o gradeada ⇒ envío de solo cartas y umbral del endpoint + comisión SIN importe (ES y EN)', async () => {
    // Dueño 2026-10-25 (HECHOS «Envío gratis desde MX$4,000 para CUALQUIER pedido»): T1a también dice el umbral.
    vi.spyOn(api, 'getPublicShippingRule').mockResolvedValue(RULE);
    const { unmount } = renderWithProviders(<ShippingFeeHint kind="cards" />, 'es');
    expect(await screen.findByTestId('shipping-fee-hint')).toHaveTextContent(
      '+ envío MX$101.01, gratis desde MX$4,123.00 · comisión de plataforma al pagar',
    );
    unmount();
    renderWithProviders(<ShippingFeeHint kind="cards" />, 'en');
    expect(await screen.findByTestId('shipping-fee-hint')).toHaveTextContent(
      '+ shipping MX$101.01, free from MX$4,123.00 · platform fee at checkout',
    );
  });

  it('T1b: sellado ⇒ envío de sellado y umbral del endpoint (ES y EN)', async () => {
    vi.spyOn(api, 'getPublicShippingRule').mockResolvedValue(RULE);
    const { unmount } = renderWithProviders(<ShippingFeeHint kind="sealed" />, 'es');
    expect(await screen.findByTestId('shipping-fee-hint')).toHaveTextContent(
      'Envío MX$177.77, gratis desde MX$4,123.00 · comisión de plataforma al pagar',
    );
    unmount();
    renderWithProviders(<ShippingFeeHint kind="sealed" />, 'en');
    expect(await screen.findByTestId('shipping-fee-hint')).toHaveTextContent(
      'Shipping MX$177.77, free from MX$4,123.00 · platform fee at checkout',
    );
  });

  it('si el endpoint falla no se pinta nada (nunca un importe escrito a mano)', async () => {
    const spy = vi.spyOn(api, 'getPublicShippingRule').mockRejectedValue(new Error('down'));
    renderWithProviders(<ShippingFeeHint kind="cards" />, 'es');
    await vi.waitFor(() => expect(spy).toHaveBeenCalled());
    expect(screen.queryByTestId('shipping-fee-hint')).toBeNull();
    expect(screen.queryByText(/MX\$/)).toBeNull();
  });

  it('T8 en la ficha, SIN «ventas finales» (B4: esa frase sale una vez, en el checkout) (ES y EN)', () => {
    const { unmount } = renderWithProviders(<RefundPromiseLine />, 'es');
    expect(screen.getByTestId('refund-promise-line')).toHaveTextContent(/^Si tu carta llega dañada o equivocada, te reembolsamos\.$/);
    unmount();
    renderWithProviders(<RefundPromiseLine />, 'en');
    expect(screen.getByTestId('refund-promise-line')).toHaveTextContent(/^If your card arrives damaged or wrong, we refund you\.$/);
  });
});
