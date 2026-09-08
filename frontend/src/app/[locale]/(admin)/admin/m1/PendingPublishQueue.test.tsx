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

/**
 * `total` es OVERRIDEABLE a propósito: el caso que importa es justamente aquel en que **no** coincide
 * con `rows.length` (la respuesta viene paginada). Un stub que lo derivara siempre de las filas no
 * podría distinguir «pinté el conteo del servidor» de «conté las filas que tengo delante».
 */
function stub(rows: PendingPublishRowDTO[], total: number = rows.length) {
  vi.spyOn(api, 'getPendingPublish').mockResolvedValue({ data: rows, page: 1, pageSize: 20, total });
}

/**
 * Respuesta **sin la clave `total`** — un backend anterior a la cola paginada. Va aparte de `stub`
 * a propósito: `stub(rows, undefined)` dispararía el valor por defecto del parámetro y mediría el
 * caso contrario al que dice medir.
 */
function stubWithoutTotal(rows: PendingPublishRowDTO[]) {
  vi.spyOn(api, 'getPendingPublish').mockResolvedValue({ data: rows, page: 1, pageSize: 20 } as
    Awaited<ReturnType<typeof api.getPendingPublish>>);
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

  /**
   * **D5 (techlead) — una cola existe para decir el TAMAÑO del trabajo pendiente.**
   * El servidor paga un barrido completo del inventario para calcular este `total` (`BLC-D1`) y el
   * único consumidor lo tiraba. El assert que lo demuestra es el desacuerdo: 3 filas en la página,
   * **47** en la cola.
   */
  it('pinta el TOTAL del servidor, no el número de filas de la página', async () => {
    stub([row(), row({ inventoryItemId: 'inv-2' }), row({ inventoryItemId: 'inv-3' })], 47);
    renderWithProviders(<PendingPublishQueue />, 'es');
    expect(await screen.findByTestId('publish-queue-total')).toHaveTextContent('47 pendientes');
  });

  it('una sola pendiente se dice en singular, y cero se dice con palabras', async () => {
    stub([row()], 1);
    const { unmount } = renderWithProviders(<PendingPublishQueue />, 'es');
    expect(await screen.findByTestId('publish-queue-total')).toHaveTextContent('1 pendiente');
    unmount();

    stub([], 0);
    renderWithProviders(<PendingPublishQueue />, 'es');
    // ⛔ Nunca «0 pendientes»: el cero de una cola vacía se dice, no se numera.
    expect(await screen.findByTestId('publish-queue-total')).toHaveTextContent('Ninguna pendiente');
  });

  /**
   * ⚠️ Misma doctrina que `MissingCell`: ante un «no sé» **no se pinta un valor que parezca bueno**.
   * Degradar a `data.length` daría un número del tamaño de la página —creíble y **corto**— justo
   * cuando la cola es grande, que es cuando el número importa.
   */
  it('`total` ausente (backend anterior) NO se degrada a las filas de la página: no se pinta', async () => {
    stubWithoutTotal([row(), row({ inventoryItemId: 'inv-2', folio: 'INV-004202' })]);
    renderWithProviders(<PendingPublishQueue />, 'es');
    // Las filas se listan igual: lo que falta es el contador, no la cola.
    expect(await screen.findByText('INV-004202')).toBeInTheDocument();
    expect(screen.queryByTestId('publish-queue-total')).not.toBeInTheDocument();
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
