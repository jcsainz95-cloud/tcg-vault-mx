import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import type { CardDTO, ShipmentDTO, ShipmentStatus } from '@/types/contract';
import { WithdrawalsList, addressSummary } from './WithdrawalsList';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

beforeEach(() => {
  vi.restoreAllMocks();
});

function card(id: string, name: string): CardDTO {
  return {
    id,
    externalId: `ext-${id}`,
    name,
    number: '1',
    rarity: 'Rare',
    supertype: 'Pokémon',
    subtypes: [],
    setId: 'base1',
    setName: 'Base Set', setPtcgoCode: null,
    imageSmallUrl: `https://images.pokemontcg.io/base1/1.png`,
    imageLargeUrl: `https://images.pokemontcg.io/base1/1_hires.png`,
    availableFinishes: ['normal'],
  };
}

const deliveredRecent = (): ShipmentDTO => ({
  id: 'shp-del',
  status: 'entregado',
  carrier: 'Estafeta',
  trackingNumber: '999',
  createdAt: '2026-08-10T10:00:00Z',
  deliveredAt: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString(),
  items: [
    { inventoryItemId: 'inv-raw', folio: 'INV-RAW', card: card('c-raw', 'Bulbasaur'), productType: 'raw' },
    { inventoryItemId: 'inv-grd', folio: 'INV-GRD', card: card('c-grd', 'Mewtwo'), productType: 'graded' },
  ],
});

/**
 * §33.4 — la lista de retiros (+ disputas) EXTRAÍDA de /shipments a la pestaña «Retiros» de la
 * bóveda, sin cambio funcional. CTA «Solicitar retiro» arriba y en el vacío.
 */
describe('WithdrawalsList · retiros del cliente (§33.4)', () => {
  it('lista los retiros del fixture con el CTA «Solicitar retiro» → /shipments', async () => {
    renderWithProviders(<WithdrawalsList />, 'es');
    expect(await screen.findByRole('link', { name: 'shp-7001' })).toHaveAttribute('href', '/shipments/shp-7001');
    expect(screen.getByRole('heading', { name: 'Mis retiros' })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Solicitar retiro' })[0]).toHaveAttribute('href', '/shipments');
  });

  it('vacío: «Aún no tienes retiros.» + el mismo CTA', async () => {
    vi.spyOn(api, 'getShipments').mockResolvedValue([]);
    vi.spyOn(api, 'getDisputes').mockResolvedValue([]);
    renderWithProviders(<WithdrawalsList />, 'es');
    expect(await screen.findByText('Aún no tienes retiros.')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Solicitar retiro' }).length).toBe(2);
  });

  it('§33.10c: el resumen de dirección antepone el destinatario; un snapshot viejo sin nombre, solo ciudad y estado', async () => {
    expect(
      addressSummary({ recipientName: 'Misty Waterflower', city: 'Guadalajara', state: 'JAL' }),
    ).toBe('Misty Waterflower · Guadalajara, JAL');
    expect(addressSummary({ city: 'Guadalajara', state: 'JAL' })).toBe('Guadalajara, JAL');
    expect(addressSummary({ recipientName: '  ', city: 'Guadalajara', state: 'JAL' })).toBe('Guadalajara, JAL');
    expect(addressSummary(undefined)).toBe('');

    const s = deliveredRecent();
    s.addressSnapshot = { recipientName: 'Misty Waterflower', city: 'Guadalajara', state: 'JAL' };
    vi.spyOn(api, 'getShipments').mockResolvedValue([s]);
    vi.spyOn(api, 'getDisputes').mockResolvedValue([]);
    renderWithProviders(<WithdrawalsList />, 'es');
    expect(await screen.findByText('Misty Waterflower · Guadalajara, JAL')).toBeInTheDocument();
  });
});

const ALL_SHIPMENT_STATUSES: ShipmentStatus[] = [
  'solicitado',
  'picking',
  'guia',
  'enviado',
  'entregado',
  'cancelado',
];

/**
 * DESIGN_SYSTEM §60.1 · contrato v1.82 §PNL.1 — la disputa sale de la tienda; «Escríbenos» entra.
 */
describe('WithdrawalsList · «Escríbenos» sustituye a la disputa (§60.1)', () => {
  // SC-1 = FE-DSC-1. Canario: devolver el botón «Abrir disputa» ⇒ rojo.
  it.each(ALL_SHIPMENT_STATUSES)('SC-1 · retiro en «%s»: ningún botón ni texto «disputa»', async (status) => {
    const s = deliveredRecent();
    s.status = status;
    vi.spyOn(api, 'getShipments').mockResolvedValue([s]);
    vi.spyOn(api, 'getDisputes').mockResolvedValue([]);
    vi.spyOn(api, 'getSupportContact').mockResolvedValue({ contact: 'otro@x' });
    const { container } = renderWithProviders(<WithdrawalsList />, 'es');
    await screen.findByText('Bulbasaur');
    expect(screen.queryByRole('button', { name: /disputa/i })).not.toBeInTheDocument();
    expect(container.textContent ?? '').not.toMatch(/disputa/i);
  });

  // SC-3 = FE-DSC-3 (lado retiro) + SC-4 (asunto). Canario: pintar el fallback siempre ⇒ rojo.
  it('SC-3 · retiro ENTREGADO ⇒ una sección «Escríbenos» con el correo del endpoint y el folio en el asunto', async () => {
    vi.spyOn(api, 'getShipments').mockResolvedValue([deliveredRecent()]);
    vi.spyOn(api, 'getDisputes').mockResolvedValue([]);
    vi.spyOn(api, 'getSupportContact').mockResolvedValue({ contact: 'otro@x' });
    renderWithProviders(<WithdrawalsList />, 'es');
    const email = await screen.findByTestId('support-email');
    expect(email).toHaveTextContent('otro@x');
    expect(screen.getAllByTestId('support-contact')).toHaveLength(1);
    expect(screen.getByRole('heading', { name: '¿PROBLEMA CON TU RETIRO?' })).toBeInTheDocument();
    const href = email.closest('a')!.getAttribute('href')!;
    expect(href.startsWith('mailto:otro@x?subject=')).toBe(true);
    expect(decodeURIComponent(href.split('subject=')[1])).toBe('Problema con mi retiro shp-del');
  });

  it.each(ALL_SHIPMENT_STATUSES.filter((x) => x !== 'entregado'))(
    'SC-3 · retiro en «%s» (antes de la entrega) ⇒ sin sección',
    async (status) => {
      const s = deliveredRecent();
      s.status = status;
      vi.spyOn(api, 'getShipments').mockResolvedValue([s]);
      vi.spyOn(api, 'getDisputes').mockResolvedValue([]);
      vi.spyOn(api, 'getSupportContact').mockResolvedValue({ contact: 'otro@x' });
      renderWithProviders(<WithdrawalsList />, 'es');
      await screen.findByText('Bulbasaur');
      expect(screen.queryByTestId('support-contact')).not.toBeInTheDocument();
    },
  );

  // SC-5. Canario: pintar el `EmptyState` / el título con cero ⇒ rojo.
  it('SC-5 · con getDisputes() = [] no existe «Mis disputas»; con una, sí (lectura)', async () => {
    vi.spyOn(api, 'getShipments').mockResolvedValue([deliveredRecent()]);
    const spy = vi.spyOn(api, 'getDisputes').mockResolvedValue([]);
    vi.spyOn(api, 'getSupportContact').mockResolvedValue({ contact: 'otro@x' });
    const { unmount } = renderWithProviders(<WithdrawalsList />, 'es');
    await screen.findByText('Bulbasaur');
    expect(screen.queryByRole('heading', { name: 'Mis disputas' })).not.toBeInTheDocument();
    expect(screen.queryByText('No tienes disputas.')).not.toBeInTheDocument();
    unmount();

    spy.mockResolvedValue([
      {
        id: 'dsp-1',
        inventoryItemId: 'inv-raw',
        type: 'condition_raw',
        status: 'abierta',
        description: 'x',
        deadlineAt: '2026-08-24T00:00:00Z',
        createdAt: '2026-08-17T00:00:00Z',
      },
    ]);
    renderWithProviders(<WithdrawalsList />, 'es');
    const heading = await screen.findByRole('heading', { name: 'Mis disputas' });
    expect(within(heading.closest('section')!).getByText('dsp-1')).toBeInTheDocument();
  });
});
