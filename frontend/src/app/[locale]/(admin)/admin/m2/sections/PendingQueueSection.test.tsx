import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import type {
  InventoryItemDTO,
  PendingPriceEntryDTO,
  PendingPriceQueueResponse,
  SealedProductListResponse,
} from '@/types/contract';
import es from '../../../../../../../messages/es.json';
import { PendingQueueSection } from './PendingQueueSection';

/**
 * # PendingQueueSection.test.tsx — la mitad de FRONTEND de `API_CONTRACT §M2-SK`
 *
 * La tabla «Qué ofrece M2 en la fila de un pendiente de sellado» (§M2-SK) es normativa para esta
 * pantalla: una fila de sellado **sin mapear** (`productType='sealed' ∧ gradeKey==='sealed'`) ofrece
 * DOS salidas reales —«Ligar a su presentación» (mapeo, cura de raíz) y «Fijar el precio de esta
 * pieza» (`listPriceCents` de la pieza, precedencia #1 de §K)— y ⛔ NO ofrece el «Fijar precio» de
 * mercado, porque el servidor lo rechaza con `422 SEALED_MARKET_KEY_REQUIRED` (SK-3). Una fila de
 * sellado **mapeado** (`sealed:tcg:<id>`) y una raw siguen con «Fijar precio», como hoy.
 *
 * Los rótulos se leen del catálogo i18n, nunca se teclean.
 */

const T = es.admin.m2.pending;

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: unknown; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}));

const RAW_ROW: PendingPriceEntryDTO = {
  id: 'ppe-raw',
  cardId: 'c-zapdos',
  productType: 'raw',
  gradeKey: 'raw:NM',
  finish: 'holofoil',
  context: 'inventory',
  status: 'open',
  reason: 'no_market',
  createdAt: '2026-09-01T00:00:00Z',
  cardName: 'Zapdos',
  card: { id: 'c-zapdos', name: 'Zapdos', number: '16', setName: 'Base Set' },
};

const SEALED_MAPPED_ROW: PendingPriceEntryDTO = {
  id: 'ppe-sealed-mapped',
  cardId: 'c-sealed-sv08-box',
  productType: 'sealed',
  gradeKey: 'sealed:tcg:590413',
  finish: 'normal',
  context: 'inventory',
  status: 'open',
  reason: 'no_market',
  createdAt: '2026-09-01T00:00:00Z',
  sealedProductId: 'sp-sv08-bundle',
  sealedProductName: 'Surging Sparks Booster Bundle',
  sealedSubtype: 'bundle',
  card: { id: 'c-sealed-sv08-box', name: 'Surging Sparks', number: '', setName: 'Surging Sparks' },
};

const SEALED_UNMAPPED_ROW: PendingPriceEntryDTO = {
  id: 'ppe-sealed-unmapped',
  cardId: 'c-sealed-sv06-etb',
  productType: 'sealed',
  // ⭐ §M2-SK: `'sealed'` es clave de COLA, nunca de precio ⇒ esta fila NO tiene clave de mercado.
  gradeKey: 'sealed',
  finish: 'normal',
  context: 'inventory',
  status: 'open',
  reason: 'no_market',
  createdAt: '2026-09-01T00:00:00Z',
  sealedProductId: null,
  sealedProductName: 'Twilight Masquerade ETB',
  sealedSubtype: 'etb',
  card: { id: 'c-sealed-sv06-etb', name: 'Twilight Masquerade ETB', number: '', setName: 'Twilight Masquerade' },
};

function queue(rows: PendingPriceEntryDTO[]): PendingPriceQueueResponse {
  return { data: rows, counts: { no_market: rows.length, premium_at_floor: 0, unknown: 0 } };
}

function sealedPiece(id: string, over: Partial<InventoryItemDTO> = {}): InventoryItemDTO {
  return {
    id,
    folio: `INV-${id}`,
    card: {
      id: 'c-sealed-sv06-etb',
      setId: 'sv06',
      name: 'Twilight Masquerade ETB',
      number: '',
      setName: 'Twilight Masquerade',
      rarity: 'Sealed',
      availableFinishes: ['normal'],
    } as InventoryItemDTO['card'],
    productType: 'sealed',
    sealedSubtype: 'etb',
    finish: 'normal',
    status: 'in_stock',
    ownerType: 'platform',
    referenceValue: { status: 'pending' },
    ...over,
  };
}

const SEALED_PRODUCTS: SealedProductListResponse = {
  set: { id: 'sv06', name: 'Twilight Masquerade', series: 'Scarlet & Violet', releaseDate: '2024-05-24' },
  needsSync: false,
  groups: [],
  sealedPriceSource: 'tcgcsv',
  data: [
    {
      id: 'sp-sv06-etb',
      setId: 'sv06',
      tcgplayerProductId: 570123,
      tcgplayerGroupId: 23821,
      name: 'Twilight Masquerade Elite Trainer Box',
      subtype: 'etb',
      subtypeInferred: false,
      isPrincipal: true,
      origin: 'set_main',
      imageUrl: null,
      marketRef: null,
      effectiveMarketCents: null,
    },
  ],
};

async function rowOf(name: string): Promise<HTMLElement> {
  // DataTable pinta cada fila dos veces (tabla + tarjeta móvil): se toma la de la tabla (`tr`).
  const cells = await screen.findAllByText(name);
  const row = cells.map((c) => c.closest('tr')).find((r): r is HTMLTableRowElement => r != null);
  if (!row) throw new Error(`no hay fila para ${name}`);
  return row;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('§M2-SK · acciones por fila de la cola VENTA', () => {
  it('sellado SIN mapear (gradeKey "sealed"): NO ofrece «Fijar precio» de mercado; SÍ las dos salidas', async () => {
    vi.spyOn(api, 'getPendingPrices').mockResolvedValue(queue([SEALED_UNMAPPED_ROW]));
    renderWithProviders(<PendingQueueSection />, 'es');

    const row = await rowOf('Twilight Masquerade ETB');
    await waitFor(() => expect(within(row).getByRole('button', { name: T.sealedUnmapped.link })).toBeInTheDocument());
    expect(within(row).getByRole('button', { name: T.sealedUnmapped.pricePiece })).toBeInTheDocument();
    // ⛔ El «Fijar precio» de mercado terminaría en 422 SEALED_MARKET_KEY_REQUIRED (SK-3).
    expect(within(row).queryByRole('button', { name: T.setPrice })).toBeNull();
  });

  it('sellado MAPEADO (sealed:tcg:<id>) y raw: «Fijar precio» de mercado como hoy, sin las dos salidas', async () => {
    vi.spyOn(api, 'getPendingPrices').mockResolvedValue(queue([RAW_ROW, SEALED_MAPPED_ROW]));
    renderWithProviders(<PendingQueueSection />, 'es');

    const mapped = await rowOf('Surging Sparks Booster Bundle');
    await waitFor(() => expect(within(mapped).getByRole('button', { name: T.setPrice })).toBeInTheDocument());
    expect(within(mapped).queryByRole('button', { name: T.sealedUnmapped.link })).toBeNull();
    expect(within(mapped).queryByRole('button', { name: T.sealedUnmapped.pricePiece })).toBeNull();

    const raw = await rowOf('Zapdos');
    expect(within(raw).getByRole('button', { name: T.setPrice })).toBeInTheDocument();
    expect(within(raw).queryByRole('button', { name: T.sealedUnmapped.link })).toBeNull();
  });
});

describe('§M2-SK · «Ligar a su presentación» → PUT /admin/pricing/sealed/items/:itemId/mapping', () => {
  it('liga la primera pieza sin mapeo con applyToSiblings:true y los ids del producto elegido', async () => {
    vi.spyOn(api, 'getPendingPrices').mockResolvedValue(queue([SEALED_UNMAPPED_ROW]));
    vi.spyOn(api, 'getAdminInventory').mockResolvedValue({
      data: [
        sealedPiece('a'),
        sealedPiece('b'),
        // Ya mapeada: NO cuenta como pieza sin mapeo aunque comparta carta y presentación.
        sealedPiece('c', { tcgplayerProductId: 570123, tcgplayerGroupId: 23821 }),
        // Otra presentación del mismo set ancla: fuera del alcance de esta fila.
        sealedPiece('d', { sealedSubtype: 'box' }),
      ],
      page: 1,
      pageSize: 100,
      total: 4,
    });
    vi.spyOn(api, 'listSealedProducts').mockResolvedValue(SEALED_PRODUCTS);
    const mapping = vi.spyOn(api, 'updateSealedItemMapping').mockResolvedValue({
      inventoryItemId: 'a',
      tcgplayerProductId: 570123,
      tcgplayerGroupId: 23821,
      siblingsUpdated: 1,
    });
    renderWithProviders(<PendingQueueSection />, 'es');

    const row = await rowOf('Twilight Masquerade ETB');
    fireEvent.click(await within(row).findByRole('button', { name: T.sealedUnmapped.link }));

    const dialog = await screen.findByRole('dialog');
    // El paso de elegir presentación reusa el picker del alta: una teja `option` por producto.
    fireEvent.click(await within(dialog).findByRole('option', { name: /Elite Trainer Box/ }));
    // Dos piezas sin mapeo de esta presentación (a, b): el botón lo dice.
    fireEvent.click(within(dialog).getByRole('button', { name: /Ligar 2 piezas/ }));

    await waitFor(() => expect(mapping).toHaveBeenCalledTimes(1));
    expect(mapping).toHaveBeenCalledWith('a', {
      tcgplayerProductId: 570123,
      tcgplayerGroupId: 23821,
      applyToSiblings: true,
    });
    // 1 + siblingsUpdated = 2 piezas ligadas, y se dice.
    expect(await within(dialog).findByRole('status')).toHaveTextContent(/2 piezas/);
  });

  it('sin piezas sin mapeo (fila legada): lo dice y NO llama al endpoint de mapeo', async () => {
    vi.spyOn(api, 'getPendingPrices').mockResolvedValue(queue([SEALED_UNMAPPED_ROW]));
    vi.spyOn(api, 'getAdminInventory').mockResolvedValue({
      data: [sealedPiece('c', { tcgplayerProductId: 570123, tcgplayerGroupId: 23821 })],
      page: 1,
      pageSize: 100,
      total: 1,
    });
    const products = vi.spyOn(api, 'listSealedProducts').mockResolvedValue(SEALED_PRODUCTS);
    const mapping = vi.spyOn(api, 'updateSealedItemMapping');
    renderWithProviders(<PendingQueueSection />, 'es');

    fireEvent.click(await within(await rowOf('Twilight Masquerade ETB')).findByRole('button', { name: T.sealedUnmapped.link }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText(T.sealedUnmapped.noPieces)).toBeInTheDocument();
    expect(within(dialog).queryByRole('option')).toBeNull();
    expect(products).not.toHaveBeenCalled();
    expect(mapping).not.toHaveBeenCalled();
  });
});

describe('§M2-SK · «Fijar el precio de esta pieza» → PATCH /admin/inventory/items/:id { listPriceCents }', () => {
  it('escribe listPriceCents en CADA pieza sin mapeo de la fila; nunca llama a overridePrice', async () => {
    vi.spyOn(api, 'getPendingPrices').mockResolvedValue(queue([SEALED_UNMAPPED_ROW]));
    vi.spyOn(api, 'getAdminInventory').mockResolvedValue({
      data: [sealedPiece('a'), sealedPiece('b'), sealedPiece('c', { tcgplayerProductId: 570123 })],
      page: 1,
      pageSize: 100,
      total: 3,
    });
    const patch = vi
      .spyOn(api, 'updateInventoryItem')
      .mockImplementation(async (id, input) => sealedPiece(id, { listPriceCents: input.listPriceCents }));
    const override = vi.spyOn(api, 'overridePrice');
    renderWithProviders(<PendingQueueSection />, 'es');

    fireEvent.click(
      await within(await rowOf('Twilight Masquerade ETB')).findByRole('button', { name: T.sealedUnmapped.pricePiece }),
    );
    const dialog = await screen.findByRole('dialog');
    // Las piezas se listan por folio; la mapeada (c) no está.
    expect(await within(dialog).findByText(/INV-a/)).toBeInTheDocument();
    expect(within(dialog).getByText(/INV-b/)).toBeInTheDocument();
    expect(within(dialog).queryByText(/INV-c/)).toBeNull();

    const input = within(dialog).getByLabelText(T.sealedUnmapped.priceLabel);
    // S-L1 money-safe: vacío ⇒ bloqueado.
    const confirm = within(dialog).getByRole('button', { name: /Fijar en 2 piezas/ });
    expect(confirm).toBeDisabled();
    fireEvent.change(input, { target: { value: '1800' } });
    expect(confirm).not.toBeDisabled();
    fireEvent.click(confirm);

    await waitFor(() => expect(patch).toHaveBeenCalledTimes(2));
    expect(patch).toHaveBeenCalledWith('a', { listPriceCents: 180000 });
    expect(patch).toHaveBeenCalledWith('b', { listPriceCents: 180000 });
    expect(override).not.toHaveBeenCalled();
    expect(await within(dialog).findByRole('status')).toHaveTextContent('MX$1,800.00');
  });

  it('S-L1: "." (mal formado) queda bloqueado con aviso; "1.2.3" se sanea a 1.23 y nunca castea a MX$0', async () => {
    vi.spyOn(api, 'getPendingPrices').mockResolvedValue(queue([SEALED_UNMAPPED_ROW]));
    vi.spyOn(api, 'getAdminInventory').mockResolvedValue({
      data: [sealedPiece('a')],
      page: 1,
      pageSize: 100,
      total: 1,
    });
    const patch = vi.spyOn(api, 'updateInventoryItem');
    renderWithProviders(<PendingQueueSection />, 'es');

    fireEvent.click(
      await within(await rowOf('Twilight Masquerade ETB')).findByRole('button', { name: T.sealedUnmapped.pricePiece }),
    );
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText(/INV-a/);
    const input = within(dialog).getByLabelText(T.sealedUnmapped.priceLabel);
    const confirm = within(dialog).getByRole('button', { name: /Fijar en 1 pieza/ });
    // "." no es vacío y NO parsea a número finito: bloqueado, y se explica por qué.
    fireEvent.change(input, { target: { value: '.' } });
    expect(confirm).toBeDisabled();
    expect(within(dialog).getByText(T.overrideInvalidValue)).toBeInTheDocument();
    // "1.2.3" se sanea a "1.23" (solo el PRIMER punto sobrevive): fijable, y a MX$1.23 — nunca 0.
    fireEvent.change(input, { target: { value: '1.2.3' } });
    expect((input as HTMLInputElement).value).toBe('1.23');
    expect(confirm).not.toBeDisabled();
    expect(within(dialog).getByText('= MX$1.23')).toBeInTheDocument();
    expect(patch).not.toHaveBeenCalled();
  });
});
