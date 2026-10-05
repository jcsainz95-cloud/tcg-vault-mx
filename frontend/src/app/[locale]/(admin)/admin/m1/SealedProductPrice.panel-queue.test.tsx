import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import { mockInventory } from '@/lib/mock/fixtures';
import type { InventoryItemDTO, PendingPublishRowDTO, SealedPriceSheetRowDTO } from '@/types/contract';
import { PendingPublishQueue } from './PendingPublishQueue';
import { VariantDrawer } from './VariantDrawer';

/**
 * 💰 El precio del PRODUCTO en el panel de la presentación y en «Listas para publicar» (`DESIGN_SYSTEM §70.3 (a)(b)`,
 * `API_CONTRACT §M11-SP.12.7`, `§M11-SP.13.5` y `§M11-SP.13.7`). Candados UX-SP-9, UX-SP-15, UX-SP-21, UX-SP-22.
 */

const roleState = vi.hoisted(() => ({ role: 'super_admin' }));
vi.mock('@/lib/role', () => ({
  useRole: () => ({ role: roleState.role, setRole: () => {}, isSuperAdmin: roleState.role === 'super_admin', canSwitchRole: false }),
}));
vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/admin/m11',
  useRouter: () => ({ push: vi.fn() }),
  Link: ({ href, children, ...rest }: { href: unknown; children: React.ReactNode }) => (
    <a
      href={typeof href === 'string' ? href : `${(href as { pathname: string }).pathname}?${new URLSearchParams((href as { query?: Record<string, string> }).query ?? {}).toString()}`}
      {...rest}
    >
      {children}
    </a>
  ),
}));

beforeEach(() => {
  vi.restoreAllMocks();
  roleState.role = 'super_admin';
});

function piece(over: Partial<InventoryItemDTO>): InventoryItemDTO {
  const base = mockInventory.find((i) => i.productType === 'sealed') ?? mockInventory[0]!;
  return { ...base, productType: 'sealed', ownerType: 'platform', ...over } as InventoryItemDTO;
}

const SHEET_ROW: SealedPriceSheetRowDTO = {
  sealedProductId: 'sp-ssp-etb',
  name: 'Surging Sparks Elite Trainer Box',
  subtype: 'etb',
  imageUrl: null,
  active: true,
  set: { id: 'sv08', name: 'Surging Sparks' },
  pieces: { inStock: 3, listed: 1, reserved: 1 },
  cost: { avgCents: null, minCents: null, maxCents: null, withoutCost: 5 },
  ownerDisplayPriceCents: 150000,
  automaticListPriceCents: null,
  automaticDisplayPriceCents: null,
  automaticSource: null,
  appliedSpreadPct: null,
  effectiveOrigin: 'product',
  displayPriceCents: 150000,
  netPriceCents: 129310,
  market: null,
  legacyPiecePrices: { count: 0, minDisplayCents: null, maxDisplayCents: null, shadowed: true },
  margin: null,
};

function linked(over: Partial<InventoryItemDTO> = {}): InventoryItemDTO {
  return piece({
    id: 'p-1',
    folio: 'INV-002001',
    status: 'in_stock',
    sealedProductId: 'sp-ssp-etb',
    sealedProductPieces: { inStock: 3, listed: 1, reserved: 1 },
    sealedPriceOrigin: 'product',
    sealedProductDisplayPriceCents: 145000,
    resolvedSalePriceCents: 125000,
    resolvedDisplayPriceCents: 145000,
    listPriceCents: undefined,
    ...over,
  });
}

function drawer(rows: InventoryItemDTO[]) {
  vi.spyOn(api, 'getAdminInventory').mockResolvedValue({ data: rows, page: 1, pageSize: 100, total: rows.length });
  return renderWithProviders(
    <VariantDrawer cardId="c-s" cardName="Surging Sparks Elite Trainer Box" cardNumber="" finish="normal" productType="sealed" onClose={() => {}} />,
    'es',
  );
}

describe('UX-SP-22 · bloque «Precio del producto · N piezas» del panel', () => {
  it('cifra con IVA del producto, N del agregado del producto (no de las filas), y ⛔ nunca la L', async () => {
    drawer([linked(), linked({ id: 'p-2', folio: 'INV-002002', status: 'listed' })]);
    const block = await screen.findByTestId('sealed-product-block-sp-ssp-etb');
    expect(block).toHaveTextContent('Precio del producto · 5 piezas');
    expect(block).toHaveTextContent('MX$1,450.00 · tuyo · con IVA');
    expect(block.textContent).not.toContain('MX$1,250.00');
    // Una sola vez, aunque haya dos filas del producto.
    expect(screen.getAllByTestId(/^sealed-product-block-/)).toHaveLength(1);
    // Las filas ligadas, en solo lectura con el P de la pieza.
    expect(screen.getByTestId('sealed-piece-price-p-1')).toHaveTextContent('MX$1,450.00 · precio del producto');
    expect(screen.queryByRole('button', { name: /precio de INV-002001/ })).toBeNull();
  });

  it('sin precio del dueño ⇒ el P de una pieza automática + «automático»', async () => {
    drawer([
      linked({ sealedProductDisplayPriceCents: null, sealedPriceOrigin: 'automatic', resolvedDisplayPriceCents: 137251 }),
    ]);
    expect(await screen.findByTestId('sealed-product-block-sp-ssp-etb')).toHaveTextContent('MX$1,372.51 · automático · con IVA');
    expect(screen.getByTestId('sealed-piece-price-p-1')).toHaveTextContent('MX$1,372.51 · automático');
  });

  it('precio propio antiguo y pendiente: sus rótulos', async () => {
    drawer([
      linked({ sealedProductDisplayPriceCents: null, sealedPriceOrigin: 'piece', resolvedDisplayPriceCents: 127600 }),
      linked({ id: 'p-2', folio: 'INV-002002', sealedProductDisplayPriceCents: null, sealedPriceOrigin: 'pending', resolvedDisplayPriceCents: null }),
    ]);
    expect(await screen.findByTestId('sealed-piece-price-p-1')).toHaveTextContent('MX$1,276.00 · precio propio antiguo');
    expect(screen.getByTestId('sealed-piece-price-p-2')).toHaveTextContent('— · sin precio');
  });

  it('sin sealedProductPieces ⇒ «todas sus piezas» (no cuenta la lista del panel)', async () => {
    drawer([linked({ sealedProductPieces: undefined })]);
    expect(await screen.findByTestId('sealed-product-block-sp-ssp-etb')).toHaveTextContent('Precio del producto · todas sus piezas');
  });

  it('personal ⇒ sin botón; «Lo pone el dueño en «Precios del sellado»» enlaza a la hoja', async () => {
    roleState.role = 'vault_operator';
    drawer([linked()]);
    const block = await screen.findByTestId('sealed-product-block-sp-ssp-etb');
    expect(within(block).queryByRole('button')).toBeNull();
    expect(within(block).getByRole('link', { name: 'Lo pone el dueño en «Precios del sellado».' })).toHaveAttribute(
      'href',
      '/admin/m11#precios-sellado',
    );
  });

  it('§M11-SP.13.7 · ninguna fila trae el expected (p. ej. todas reserved) ⇒ ⛔ sin editor: enlace a la hoja', async () => {
    drawer([linked({ status: 'reserved', sealedProductDisplayPriceCents: undefined, sealedProductPieces: undefined })]);
    const block = await screen.findByTestId('sealed-product-block-sp-ssp-etb');
    expect(within(block).queryByRole('button')).toBeNull();
    expect(within(block).getByRole('link', { name: 'Ir a «Precios del sellado»' })).toBeInTheDocument();
  });
});

describe('💰 UX-SP-9 = F-SP-3 · pieza ligada ⇒ el PUT del producto, cero PATCH con listPriceCents', () => {
  it('panel: guardar desde el bloque', async () => {
    drawer([linked()]);
    const patch = vi.spyOn(api, 'updateInventoryItem');
    const put = vi.spyOn(api, 'setSealedProductSalePrice').mockResolvedValue({
      data: SHEET_ROW,
      autoPublish: { published: 3, missingLocation: 0, notPublished: 0 },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Cambiar precio de Surging Sparks Elite Trainer Box' }));
    const input = await screen.findByLabelText('Tu precio, con IVA (MXN)');
    // Panel: sin margen en vivo (no trae avg ni r) y «Se aplica a sus 5 piezas».
    expect(screen.queryByTestId('sealed-product-price-margin-preview')).toBeNull();
    expect(screen.getByText('Se aplica a sus 5 piezas.')).toBeInTheDocument();
    fireEvent.change(input, { target: { value: '1500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    fireEvent.click(await screen.findByTestId('sealed-product-price-confirm'));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put).toHaveBeenCalledWith('sp-ssp-etb', { displayPriceCents: 150000, expectedDisplayPriceCents: 145000 });
    expect(patch).not.toHaveBeenCalled();
    expect(await screen.findByTestId('sealed-price-saved-notice')).toHaveTextContent('Se pusieron a la venta solas: 3.');
  });

  it('cola: el editor del producto en la fila ligada; expected = sealedProductDisplayPriceCents de la fila', async () => {
    stubQueue([queueRow()]);
    const patch = vi.spyOn(api, 'updateInventoryItem');
    const put = vi.spyOn(api, 'setSealedProductSalePrice').mockResolvedValue({
      data: SHEET_ROW,
      autoPublish: { published: 1, missingLocation: 0, notPublished: 0 },
    });
    renderWithProviders(<PendingPublishQueue productType="sealed" />, 'es');
    expect(await screen.findByTestId('sealed-piece-price-inv-s1')).toHaveTextContent('— · sin precio');
    fireEvent.click(screen.getByRole('button', { name: 'Poner precio de Surging Sparks Elite Trainer Box' }));
    fireEvent.change(await screen.findByLabelText('Tu precio, con IVA (MXN)'), { target: { value: '1500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryAllByRole('checkbox')).toHaveLength(0);
    fireEvent.click(screen.getByTestId('sealed-product-price-confirm'));
    await waitFor(() => expect(put).toHaveBeenCalledWith('sp-ssp-etb', { displayPriceCents: 150000, expectedDisplayPriceCents: null }));
    expect(patch).not.toHaveBeenCalled();
    expect(await screen.findByTestId('sealed-price-saved-notice')).toHaveTextContent('Se puso a la venta sola: 1.');
  });
});

function queueRow(over: Partial<PendingPublishRowDTO> = {}): PendingPublishRowDTO {
  return {
    inventoryItemId: 'inv-s1',
    folio: 'INV-001950',
    card: mockInventory[0]!.card,
    productType: 'sealed',
    finish: 'normal',
    cardProductId: null,
    sealedProductName: 'Surging Sparks Elite Trainer Box',
    locationId: 'loc-1',
    listPriceCents: null,
    resolvedSalePriceCents: null,
    priceBasis: 'pending',
    pendingPriceEntryId: 'ppe-7',
    missing: ['price'],
    acquisitionType: 'compra',
    sourceSellRequestItemId: null,
    createdAt: '2026-10-05T10:00:00.000Z',
    sealedProductId: 'sp-ssp-etb',
    sealedProductPieces: { inStock: 3, listed: 1, reserved: 1 },
    sealedPriceOrigin: 'pending',
    sealedProductDisplayPriceCents: null,
    resolvedDisplayPriceCents: null,
    ...over,
  };
}
function stubQueue(rows: PendingPublishRowDTO[]) {
  vi.spyOn(api, 'getPendingPublish').mockResolvedValue({ data: rows, page: 1, pageSize: 20, total: rows.length });
}

describe('UX-SP-15 · cola: la ligada sin precio va a la HOJA, ⛔ no a la cola de M2', () => {
  it('personal ⇒ enlace a /admin/m11#precios-sellado y cero enlaces a /admin/m2?pendingPrice=', async () => {
    roleState.role = 'vault_operator';
    stubQueue([queueRow()]);
    const { container } = renderWithProviders(<PendingPublishQueue productType="sealed" />, 'es');
    expect(await screen.findByRole('link', { name: 'Ponle precio en «Precios del sellado»' })).toHaveAttribute(
      'href',
      '/admin/m11#precios-sellado',
    );
    expect(container.querySelector('a[href*="pendingPrice="]')).toBeNull();
    expect(screen.queryByRole('button', { name: /^(Poner|Cambiar) precio/ })).toBeNull();
    expect(screen.getByTestId('publish-reason-inv-s1')).toHaveTextContent(
      'Sin mercado ni precio del dueño: se pone en «Precios del sellado».',
    );
  });

  it('pieza SIN producto (`null`) ⇒ conserva el enlace a M2', async () => {
    roleState.role = 'vault_operator';
    stubQueue([queueRow({ sealedProductId: null, sealedProductPieces: undefined })]);
    const { container } = renderWithProviders(<PendingPublishQueue productType="sealed" />, 'es');
    await screen.findByTestId('sealed-final-price-inv-s1');
    expect(container.querySelector('a[href*="pendingPrice=ppe-7"]')).not.toBeNull();
    // Personal: solo lectura + «Sin producto: su precio lo pone el dueño.»
    expect(screen.queryByRole('button', { name: /precio de INV-001950/ })).toBeNull();
    expect(screen.getByText('Sin producto: su precio lo pone el dueño.')).toBeInTheDocument();
  });
});

describe('UX-SP-21 (D-SP-4) · pieza SIN producto: «antes de IVA» y «En la tienda» del servidor', () => {
  it.each([
    [116000, 'MX$1,160.00'],
    // Canario: con 115000 tiene que pintar 1,150 — un ×1.16 en el cliente daría 1,160.
    [115000, 'MX$1,150.00'],
  ])('resolvedDisplayPriceCents %i ⇒ «En la tienda: %s»', async (p, text) => {
    drawer([
      piece({
        id: 'p-9',
        folio: 'INV-002009',
        status: 'in_stock',
        sealedProductId: null,
        listPriceCents: 100000,
        resolvedSalePriceCents: 100000,
        resolvedDisplayPriceCents: p,
        priceBasis: 'override',
      }),
    ]);
    const reading = await screen.findByTestId('sealed-final-price-p-9');
    expect(reading).toHaveTextContent('Antes de IVA: MX$1,000.00 a mano');
    expect(screen.getByTestId('sealed-store-price-p-9')).toHaveTextContent(`En la tienda: ${text}`);
    expect(screen.queryAllByTestId(/^sealed-product-block-/)).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar precio de INV-002009' }));
    expect(await screen.findByLabelText('Precio antes de IVA (MXN)')).toBeInTheDocument();
  });

  it('sin resolvedDisplayPriceCents ⇒ no hay «En la tienda»', async () => {
    drawer([piece({ id: 'p-9', folio: 'INV-002009', status: 'in_stock', sealedProductId: null, listPriceCents: 100000, resolvedSalePriceCents: 100000, priceBasis: 'override' })]);
    await screen.findByTestId('sealed-final-price-p-9');
    expect(screen.queryByTestId('sealed-store-price-p-9')).toBeNull();
  });

  it('personal ⇒ solo lectura + «Sin producto: su precio lo pone el dueño.»', async () => {
    roleState.role = 'vault_operator';
    drawer([piece({ id: 'p-9', folio: 'INV-002009', status: 'in_stock', sealedProductId: null, listPriceCents: 100000, resolvedSalePriceCents: 100000, priceBasis: 'override' })]);
    await screen.findByTestId('sealed-final-price-p-9');
    expect(screen.queryByRole('button', { name: /precio de INV-002009/ })).toBeNull();
    expect(screen.getByText('Sin producto: su precio lo pone el dueño.')).toBeInTheDocument();
  });
});

/**
 * 💰 F-SP-10 (`API_CONTRACT §M11-SP.13.5.1`, C-2 del techlead) — fila sellada SIN la clave `sealedProductId`: solo
 * lectura en ambos roles (ni editor por pieza ni de producto); el precio se lee.
 */
describe('💰 F-SP-10 · clave `sealedProductId` AUSENTE ⇒ falla cerrado: sin editor, en ambos roles', () => {
  it.each(['vault_operator', 'super_admin'])('cola, %s ⇒ ningún botón de precio en la fila', async (role) => {
    roleState.role = role;
    const row = queueRow({ sealedProductPieces: undefined, sealedPriceOrigin: undefined, sealedProductDisplayPriceCents: undefined });
    delete (row as Partial<PendingPublishRowDTO>).sealedProductId;
    stubQueue([row]);
    renderWithProviders(<PendingPublishQueue productType="sealed" />, 'es');
    expect(await screen.findByTestId('sealed-final-price-inv-s1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^(Poner|Cambiar) precio/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Guardar/ })).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByTestId(/^sealed-product-block-/)).toBeNull();
  });

  it.each(['vault_operator', 'super_admin'])('panel, %s ⇒ ningún botón de precio en la pieza', async (role) => {
    roleState.role = role;
    const p = piece({ id: 'p-9', folio: 'INV-002009', status: 'in_stock', listPriceCents: 100000, resolvedSalePriceCents: 100000, priceBasis: 'override' });
    delete (p as Partial<InventoryItemDTO>).sealedProductId;
    drawer([p]);
    expect(await screen.findByTestId('sealed-final-price-p-9')).toHaveTextContent('MX$1,000.00');
    expect(screen.queryByRole('button', { name: /precio de INV-002009/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Guardar/ })).toBeNull();
    expect(screen.queryAllByTestId(/^sealed-product-block-/)).toHaveLength(0);
    // Ni la nota del personal: con la clave ausente no se sabe si es «sin producto».
    expect(screen.queryByText('Sin producto: su precio lo pone el dueño.')).toBeNull();
  });
});

describe('Techlead D-6 · cola: la línea «Ahora» no se contradice', () => {
  it('ligada sin precio del dueño y con precio propio antiguo ⇒ «Ahora: sin precio», ⛔ nunca «(tuyo)»', async () => {
    stubQueue([queueRow({ sealedPriceOrigin: 'piece', resolvedDisplayPriceCents: 127600, missing: [] })]);
    renderWithProviders(<PendingPublishQueue productType="sealed" />, 'es');
    fireEvent.click(await screen.findByRole('button', { name: 'Poner precio de Surging Sparks Elite Trainer Box' }));
    fireEvent.change(await screen.findByLabelText('Tu precio, con IVA (MXN)'), { target: { value: '1500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Ahora: sin precio');
    expect(dialog.textContent).not.toContain('se vende a');
  });
});
