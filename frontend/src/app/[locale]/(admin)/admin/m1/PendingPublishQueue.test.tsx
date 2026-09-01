import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { PendingPublishQueue } from './PendingPublishQueue';
import * as api from '@/lib/api';
import type { PendingPublishRowDTO } from '@/types/contract';

vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/admin/m1',
  useRouter: () => ({ push: vi.fn() }),
  Link: ({ children, ...props }: { children: React.ReactNode }) => <a {...props}>{children}</a>,
}));

const CARD = {
  id: 'c-1',
  externalId: 'x',
  name: 'Charizard VMAX',
  number: '020/189',
  rarity: 'Rare Holo',
  supertype: 'Pokémon',
  subtypes: [],
  setId: 's',
  setName: 'Darkness Ablaze',
  imageSmallUrl: '',
  imageLargeUrl: '',
  availableFinishes: ['holofoil' as const],
};

function row(over: Partial<PendingPublishRowDTO> = {}): PendingPublishRowDTO {
  return {
    inventoryItemId: 'inv-1',
    folio: 'INV-004201',
    card: CARD,
    productType: 'raw',
    finish: 'holofoil',
    cardProductId: null,
    locationId: null,
    listPriceCents: null,
    resolvedSalePriceCents: 120000,
    priceBasis: 'market',
    pendingPriceEntryId: null,
    missing: ['location'],
    acquisitionType: 'buylist',
    sourceSellRequestItemId: 'sri-1',
    createdAt: '2026-08-30T18:00:00.000Z',
    ...over,
  };
}

function stub(rows: PendingPublishRowDTO[]) {
  vi.spyOn(api, 'getPendingPublish').mockResolvedValue({
    data: rows,
    page: 1,
    pageSize: 20,
    total: rows.length,
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('Cola «listas para publicar» — la red que cierra el ciclo', () => {
  it('cada fila dice QUÉ LE FALTA y DE DÓNDE viene la pieza', async () => {
    stub([row(), row({ inventoryItemId: 'inv-2', folio: 'INV-004202', missing: ['location', 'price'], resolvedSalePriceCents: null, priceBasis: null, pendingPriceEntryId: 'ppe-1' })]);
    renderWithProviders(<PendingPublishQueue />, 'es');

    expect(await screen.findByText('INV-004201')).toBeInTheDocument();
    expect(screen.getAllByText('Ubicación').length).toBe(2);
    expect(screen.getAllByText('Precio').length).toBe(1);
    expect(screen.getAllByText('Compra a vendedor').length).toBe(2);
  });

  it('sin precio resoluble NO pinta MX$0.00 y enlaza a la cola de precio pendiente', async () => {
    stub([
      row({ missing: ['price'], resolvedSalePriceCents: null, priceBasis: null, pendingPriceEntryId: 'ppe-77' }),
    ]);
    renderWithProviders(<PendingPublishQueue />, 'es');

    expect(await screen.findByText('Sin precio resoluble')).toBeInTheDocument();
    expect(screen.queryByText('MX$0.00')).not.toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Ver en la cola de precio pendiente' }),
    ).toBeInTheDocument();
  });

  /**
   * ⚠️ **La regla que el orquestador subrayó.** Una fila sin `missing` legible **no se pinta como
   * «ya está lista»**: si la pintáramos así, la pieza **saldría de la única pantalla donde alguien
   * la encontraría**. Un «no sé» que se ve como un valor bueno es peor que no mostrar nada.
   */
  it('`missing` vacío o ausente se pinta POR REVISAR, nunca como «nada le falta»', async () => {
    stub([row({ missing: [] })]);
    renderWithProviders(<PendingPublishQueue />, 'es');
    expect(await screen.findByTestId('publish-missing-unknown')).toHaveTextContent('Por revisar');
  });

  it('`missing` ausente del DTO (backend anterior) se lee igual: POR REVISAR', async () => {
    const { missing: _drop, ...withoutMissing } = row();
    stub([withoutMissing as PendingPublishRowDTO]);
    renderWithProviders(<PendingPublishQueue />, 'es');
    expect(await screen.findByTestId('publish-missing-unknown')).toBeInTheDocument();
  });

  it('declara su alcance: aquí no se capturan precios de venta', async () => {
    stub([row()]);
    renderWithProviders(<PendingPublishQueue />, 'es');
    expect(
      await screen.findByText(/no se capturan precios de venta aquí ni se heredan del costo de compra/),
    ).toBeInTheDocument();
    // Y no hay ningún botón de «publicar»: la pieza sale sola (criterio 125).
    expect(screen.queryByRole('button', { name: /publicar/i })).not.toBeInTheDocument();
  });

  it('vacío: mensaje propio, no una tabla en blanco', async () => {
    stub([]);
    renderWithProviders(<PendingPublishQueue />, 'es');
    expect(await screen.findByText('Ninguna pieza pendiente de publicar.')).toBeInTheDocument();
  });

  it('EN: existe entera en inglés (paridad)', async () => {
    stub([row()]);
    renderWithProviders(<PendingPublishQueue />, 'en');
    expect(await screen.findByText('Ready to publish')).toBeInTheDocument();
    // La fila llega por red: se espera al contenido, no al encabezado estático.
    expect(await screen.findByText('Location')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/admin\.m1\.publishQueue/);
  });
});
