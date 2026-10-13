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

/**
 * v1.94.1⟨sellado-display⟩ — el rastreo del cliente (GET /shipments/:id, ClientShipmentItemDTO).
 * El backend resuelve `name`/`imageSmallUrl` server-side (§5); el único trabajo del front es
 * OCULTAR `card.number` para `productType='sealed'` (el number es del single ancla). Una carta
 * suelta (`raw`/`graded`) sigue mostrando su número.
 */
const withItems = (items: ShipmentDTO['items']): ShipmentDTO => ({
  id: 'shp-SEAL',
  status: 'enviado',
  carrier: 'Estafeta',
  trackingNumber: '999',
  createdAt: '2026-08-10T10:00:00Z',
  items,
});

describe('ShipmentDetailView · identidad de sellado (§5, v1.94.1)', () => {
  it('línea SELLADA: muestra el nombre resuelto y el set, OCULTA el número del ancla', async () => {
    vi.spyOn(api, 'getShipment').mockResolvedValue(
      withItems([
        {
          inventoryItemId: 'inv-sealed',
          folio: 'INV-000001',
          productType: 'sealed',
          card: {
            id: 'card-anchor',
            name: 'Surging Sparks Booster Box',
            setName: 'Surging Sparks',
            number: '191', // del ancla «Exeggcute»: NO debe pintarse
            imageSmallUrl: 'https://img/sealed.png',
          },
        },
      ]),
    );
    renderWithProviders(<ShipmentDetailView shipmentId="shp-SEAL" />, 'es');

    const name = await screen.findByTestId('shipment-item-name');
    expect(name).toHaveTextContent('Surging Sparks Booster Box');

    const meta = screen.getByTestId('shipment-item-meta');
    expect(meta).toHaveTextContent('Surging Sparks');
    // El número del ancla NO aparece en ninguna parte de la línea.
    expect(meta).not.toHaveTextContent('191');
    expect(meta.textContent).not.toContain('·');
  });

  it('carta SUELTA (raw): sigue mostrando set · número', async () => {
    vi.spyOn(api, 'getShipment').mockResolvedValue(
      withItems([
        {
          inventoryItemId: 'inv-raw',
          folio: 'INV-000002',
          productType: 'raw',
          card: {
            id: 'card-raw',
            name: 'Pikachu',
            setName: 'Surging Sparks',
            number: '238',
            imageSmallUrl: 'https://img/pikachu.png',
          },
        },
      ]),
    );
    renderWithProviders(<ShipmentDetailView shipmentId="shp-SEAL" />, 'es');

    const meta = await screen.findByTestId('shipment-item-meta');
    expect(meta).toHaveTextContent('Surging Sparks · 238');
  });
});
