import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { SealedTab } from './SealedTab';
import * as api from '@/lib/api';
import type {
  CardDTO,
  InventoryItemDTO,
  Paginated,
  SealedSetDetailResponse,
  SealedSetsResponse,
} from '@/types/contract';

const roleState = vi.hoisted(() => ({ role: 'super_admin' }));
vi.mock('@/lib/role', () => ({
  useRole: () => ({
    role: roleState.role,
    setRole: () => {},
    isSuperAdmin: roleState.role === 'super_admin',
    canSwitchRole: false,
  }),
}));

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}));

beforeEach(() => {
  vi.restoreAllMocks();
  roleState.role = 'super_admin';
});

// ---------------------------------------------------------------------------
// Fixtures locales: un set con UN grupo sellado grande (para paginado + troceo).
// ---------------------------------------------------------------------------

function mkSealedItem(n: number, status: InventoryItemDTO['status'] = 'in_stock'): InventoryItemDTO {
  return {
    id: `inv-s-${n}`,
    folio: `INV-9${String(n).padStart(4, '0')}`,
    card: { id: 'c-sealed-box', name: 'Surging Sparks Booster Box' } as CardDTO,
    productType: 'sealed',
    sealedSubtype: 'box',
    sealedCondition: 'mint',
    finish: 'normal',
    status,
    ownerType: 'platform',
  };
}

const setsRes: SealedSetsResponse = {
  data: [
    {
      set: { id: 'sv08', name: 'Surging Sparks' },
      pieceCount: 250,
      listedCount: 0,
      unmappedCount: 0,
      marketValueMxnCents: null,
    },
  ],
  page: 1,
  pageSize: 20,
  total: 1,
  unmappedTotal: 0,
};

const detailRes: SealedSetDetailResponse = {
  set: { id: 'sv08', name: 'Surging Sparks' },
  groups: [
    {
      cardId: 'c-sealed-box',
      productName: 'Surging Sparks Booster Box',
      sealedSubtype: 'box',
      sealedCondition: 'mint',
      tcgplayerProductId: 42,
      mapped: true,
      counts: { inStock: 250, listed: 0, other: 0 },
      sealedMarketRef: { status: 'priced', referenceMxnCents: 250_000 },
      totalCostCents: null,
    },
  ],
};

/** Pagina `items` server-side como lo haría el backend (pageSize máx 100). */
function pageOf(items: InventoryItemDTO[], page: number, pageSize: number): Paginated<InventoryItemDTO> {
  const start = (page - 1) * pageSize;
  return { data: items.slice(start, start + pageSize), page, pageSize, total: items.length };
}

async function openSetDetail() {
  // El DataTable pinta tabla (md+) y lista móvil: el botón del set existe 2 veces.
  fireEvent.click((await screen.findAllByRole('button', { name: /Surging Sparks/ }))[0]);
  return screen.findByRole('button', { name: 'Publicar' });
}

describe('SealedTab (P-25) · «Publicar grupo» honesto (M-2)', () => {
  it('pagina hasta AGOTAR el grupo y trocea el bulk-publish al cap 200 (nada de publicar 100 y cantar victoria)', async () => {
    vi.spyOn(api, 'getSealedInventorySets').mockResolvedValue(setsRes);
    vi.spyOn(api, 'getSealedInventorySet').mockResolvedValue(detailRes);
    const items = Array.from({ length: 250 }, (_, n) => mkSealedItem(n));
    const invSpy = vi
      .spyOn(api, 'getAdminInventory')
      .mockImplementation((filters = {}) =>
        Promise.resolve(pageOf(items, filters.page ?? 1, filters.pageSize ?? 20)),
      );
    const bulkSpy = vi.spyOn(api, 'bulkPublishItems').mockImplementation((payload) =>
      Promise.resolve({
        summary: {
          requested: payload.items.length,
          published: payload.items.length,
          failedLines: 0,
        },
        results: [],
      }),
    );
    const onToast = vi.fn();
    renderWithProviders(<SealedTab onOpenGroup={() => {}} onToast={onToast} />, 'es');

    fireEvent.click(await openSetDetail());

    // 250 piezas → 3 páginas de inventario (100+100+50)…
    await waitFor(() => expect(bulkSpy).toHaveBeenCalledTimes(2));
    const invPages = invSpy.mock.calls.map(([f]) => f?.page);
    expect(invPages).toEqual([1, 2, 3]);
    // …y 2 requests de bulk-publish (cap 200 del contrato) con sufijo determinista por trozo.
    expect(bulkSpy.mock.calls[0][0].items).toHaveLength(200);
    expect(bulkSpy.mock.calls[1][0].items).toHaveLength(50);
    const [key0, key1] = bulkSpy.mock.calls.map(([p]) => p.batchKey as string);
    expect(key0.endsWith('-0')).toBe(true);
    expect(key1.endsWith('-1')).toBe(true);
    expect(key0.replace(/-0$/, '')).toBe(key1.replace(/-1$/, ''));
    // El resultado reportado es el AGREGADO real, no el de una página.
    await waitFor(() => expect(onToast).toHaveBeenCalledWith('250 publicadas · 0 con error.'));
  });

  it('reintento tras fallo REUSA el mismo batchKey (useRef real → replay idempotente del backend)', async () => {
    vi.spyOn(api, 'getSealedInventorySets').mockResolvedValue(setsRes);
    vi.spyOn(api, 'getSealedInventorySet').mockResolvedValue(detailRes);
    const items = Array.from({ length: 30 }, (_, n) => mkSealedItem(n));
    vi.spyOn(api, 'getAdminInventory').mockImplementation((filters = {}) =>
      Promise.resolve(pageOf(items, filters.page ?? 1, filters.pageSize ?? 20)),
    );
    const bulkSpy = vi
      .spyOn(api, 'bulkPublishItems')
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValue({
        summary: { requested: 30, published: 30, failedLines: 0 },
        results: [],
      });
    renderWithProviders(<SealedTab onOpenGroup={() => {}} onToast={() => {}} />, 'es');

    const publishBtn = await openSetDetail();
    fireEvent.click(publishBtn);
    await waitFor(() => expect(bulkSpy).toHaveBeenCalledTimes(1));
    // El fallo se pinta (banner) y el botón vuelve a estar disponible.
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Publicar' })).not.toBeDisabled(),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Publicar' }));
    await waitFor(() => expect(bulkSpy).toHaveBeenCalledTimes(2));
    expect(bulkSpy.mock.calls[1][0].batchKey).toBe(bulkSpy.mock.calls[0][0].batchKey);
  });

  it('grupo sin piezas in_stock elegibles: avisa y NO dispara bulk-publish', async () => {
    vi.spyOn(api, 'getSealedInventorySets').mockResolvedValue(setsRes);
    vi.spyOn(api, 'getSealedInventorySet').mockResolvedValue(detailRes);
    // Todas listadas ya: el filtro de elegibles queda vacío.
    const items = Array.from({ length: 5 }, (_, n) => mkSealedItem(n, 'listed'));
    vi.spyOn(api, 'getAdminInventory').mockImplementation((filters = {}) =>
      Promise.resolve(pageOf(items, filters.page ?? 1, filters.pageSize ?? 20)),
    );
    const bulkSpy = vi.spyOn(api, 'bulkPublishItems');
    const onToast = vi.fn();
    renderWithProviders(<SealedTab onOpenGroup={() => {}} onToast={onToast} />, 'es');

    fireEvent.click(await openSetDetail());

    await waitFor(() =>
      expect(onToast).toHaveBeenCalledWith('Sin piezas en stock que publicar.'),
    );
    expect(bulkSpy).not.toHaveBeenCalled();
  });
});
