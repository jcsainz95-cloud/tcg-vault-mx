import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import type { ShipmentDTO } from '@/types/contract';
import { ShipmentDetailView } from './ShipmentDetailView';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

beforeEach(() => vi.restoreAllMocks());

const shipment = (status: ShipmentDTO['status']): ShipmentDTO => ({
  id: 'shp-77',
  status,
  carrier: 'Estafeta',
  trackingNumber: '999',
  createdAt: '2026-08-10T10:00:00Z',
  items: [],
});

/** §60.1 b (F-7): el detalle del retiro lleva «Escríbenos» solo ENTREGADO. */
describe('ShipmentDetailView · «Escríbenos» (§60.1 b)', () => {
  it('ENTREGADO ⇒ sección con el correo del endpoint y el id del retiro en el asunto', async () => {
    vi.spyOn(api, 'getShipment').mockResolvedValue(shipment('entregado'));
    vi.spyOn(api, 'getSupportContact').mockResolvedValue({ contact: 'otro@x' });
    renderWithProviders(<ShipmentDetailView shipmentId="shp-77" />, 'es');
    const email = await screen.findByTestId('support-email');
    expect(email).toHaveTextContent('otro@x');
    expect(decodeURIComponent(email.closest('a')!.getAttribute('href')!.split('subject=')[1])).toBe(
      'Problema con mi retiro shp-77',
    );
  });

  it('ENVIADO ⇒ sin sección', async () => {
    vi.spyOn(api, 'getShipment').mockResolvedValue(shipment('enviado'));
    vi.spyOn(api, 'getSupportContact').mockResolvedValue({ contact: 'otro@x' });
    renderWithProviders(<ShipmentDetailView shipmentId="shp-77" />, 'es');
    await screen.findByText('Dirección de envío');
    expect(screen.queryByTestId('support-contact')).not.toBeInTheDocument();
  });
});
