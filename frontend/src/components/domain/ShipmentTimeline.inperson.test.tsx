import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { ShipmentTimeline } from './ShipmentTrackingExtras';

describe('§PERSONA · línea de tiempo del cliente', () => {
  it('pinta «Entregado en persona» / «Delivered in person»', () => {
    const ev = [{ kind: 'delivered_in_person' as const, at: '2026-11-18T18:00:00Z' }];
    const { unmount } = renderWithProviders(<ShipmentTimeline events={ev} />, 'es');
    expect(screen.getByTestId('shipment-timeline')).toHaveTextContent('Entregado en persona');
    unmount();
    renderWithProviders(<ShipmentTimeline events={ev} />, 'en');
    expect(screen.getByTestId('shipment-timeline')).toHaveTextContent('Delivered in person');
  });
});
