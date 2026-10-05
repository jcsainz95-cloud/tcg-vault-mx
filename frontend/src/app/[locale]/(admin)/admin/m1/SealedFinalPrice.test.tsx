import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import type { InventoryItemDTO, PendingPublishRowDTO } from '@/types/contract';
import { PendingPublishQueue } from './PendingPublishQueue';
import { VariantDrawer } from './VariantDrawer';
import { parseFinalPrice } from './SealedFinalPrice';
import { SEALED_FINAL_PRICE_INVALIDATES } from './sealed-final-price';

/**
 * 💰 `DESIGN_SYSTEM §39.2/§39.3` — precio final a mano SOLO para sellado (criterio 255, `HECHOS.md` 2026-10-04 (b);
 * P-PRE-1: sueltas y gradeadas «se conserva como está»). Candados FP-1…FP-5 y LP-1 (§39.6 N-13), más el motivo por
 * fila de `pendingReason` (`API_CONTRACT §M1 «v1.80.8.7»` punto 2).
 */

const roleState = vi.hoisted(() => ({ role: 'super_admin' }));
vi.mock('@/lib/role', () => ({
  useRole: () => ({ role: roleState.role, setRole: () => {}, isSuperAdmin: roleState.role === 'super_admin', canSwitchRole: false }),
}));
vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/admin/m1',
  useRouter: () => ({ push: vi.fn() }),
  Link: ({ href, children, ...rest }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}));

const CARD = {
  id: 'c-1',
  externalId: 'x',
  name: 'Charizard ex',
  number: '199/165',
  rarity: 'Special Illustration Rare',
  supertype: 'Pokémon',
  subtypes: [],
  setId: 's',
  setName: '151',
  setPtcgoCode: null,
  imageSmallUrl: '',
  imageLargeUrl: '',
  availableFinishes: ['holofoil' as const],
};

function row(over: Partial<PendingPublishRowDTO> = {}): PendingPublishRowDTO {
  return {
    inventoryItemId: 'inv-1',
    folio: 'INV-001944',
    card: CARD,
    productType: 'raw',
    finish: 'holofoil',
    cardProductId: null,
    locationId: 'loc-1',
    listPriceCents: null,
    resolvedSalePriceCents: null,
    priceBasis: 'pending',
    pendingPriceEntryId: null,
    missing: ['price'],
    acquisitionType: 'buylist',
    sourceSellRequestItemId: null,
    createdAt: '2026-10-01T18:00:00.000Z',
    ...over,
  };
}
const sealedRow = (over: Partial<PendingPublishRowDTO> = {}) =>
  row({ inventoryItemId: 'inv-s1', folio: 'INV-001950', productType: 'sealed', finish: 'normal', sealedProductName: 'Surging Sparks Booster Box', ...over });

function stub(rows: PendingPublishRowDTO[]) {
  vi.spyOn(api, 'getPendingPublish').mockResolvedValue({ data: rows, page: 1, pageSize: 20, total: rows.length });
}

beforeEach(() => {
  vi.restoreAllMocks();
  roleState.role = 'super_admin';
});

async function openEditorAndType(folio: string, value: string) {
  fireEvent.click(await screen.findByRole('button', { name: `Poner precio de ${folio}` }));
  const input = await screen.findByLabelText('Precio antes de IVA (MXN)');
  fireEvent.change(input, { target: { value } });
  return input as HTMLInputElement;
}

describe('parseFinalPrice — pesos a centavos, sin coma flotante', () => {
  it.each([
    ['1250', { cents: 125_000 }],
    ['1,250.5', { cents: 125_050 }],
    ['0.10', { cents: 10 }],
    ['19.99', { cents: 1_999 }],
    ['0', { error: 'errPositive' }],
    ['-5', { error: 'errPositive' }],
    ['abc', { error: 'errPositive' }],
    ['1.234', { error: 'errDecimals' }],
    ['1000000.01', { error: 'errMax' }],
    ['1000000', { cents: 100_000_000 }],
    ['', null],
  ])('%s', (text, expected) => {
    expect(parseFinalPrice(text)).toEqual(expected);
  });
});

describe('§39.2 · SealedFinalPrice en «Listas para publicar»', () => {
  it('FP-1 · las filas raw y graded NO tienen botón de precio final (criterio 255 por ausencia)', async () => {
    stub([
      row({ inventoryItemId: 'inv-raw', folio: 'INV-000001', productType: 'raw' }),
      row({ inventoryItemId: 'inv-gr', folio: 'INV-000002', productType: 'graded', finish: 'normal' }),
    ]);
    renderWithProviders(<PendingPublishQueue />, 'es');
    await screen.findByRole('button', { name: 'Abrir la pieza INV-000002' });
    expect(screen.queryByRole('button', { name: /^(Poner|Cambiar) precio de /i })).toBeNull();
    expect(screen.queryByLabelText('Precio antes de IVA (MXN)')).toBeNull();
  });

  it('FP-2 · sellado in_stock CON ubicación ⇒ el único botón del editor es «Guardar y publicar» y el PATCH lleva `status:"listed"` en la MISMA llamada', async () => {
    stub([sealedRow({ locationId: 'loc-1', missing: ['price'] })]);
    const patch = vi.spyOn(api, 'updateInventoryItem').mockResolvedValue({} as InventoryItemDTO);
    renderWithProviders(<PendingPublishQueue />, 'es');

    // Sin precio: «—», ⛔ nunca MX$0.00.
    expect(await screen.findByTestId('sealed-final-price-inv-s1')).toHaveTextContent('— · sin precio');
    expect(screen.getByTestId('publish-reason-inv-s1')).toHaveTextContent('El sellado no tiene precio automático: ponle precio final.');
    await openEditorAndType('INV-001950', '1250');
    const editor = screen.getByTestId('sealed-final-price-editor-inv-s1');
    expect(within(editor).getByRole('button', { name: 'Guardar y publicar' })).toBeEnabled();
    expect(within(editor).queryByRole('button', { name: 'Guardar precio' })).toBeNull();

    fireEvent.click(within(editor).getByRole('button', { name: 'Guardar y publicar' }));
    const dialog = await screen.findByRole('dialog', { name: '¿Fijar el precio de Surging Sparks Booster Box?' });
    expect(dialog).toHaveTextContent('Ahora: sin precio');
    expect(dialog).toHaveTextContent('Nuevo: MX$1,250.00 antes de IVA, fijo a mano');
    expect(dialog).toHaveTextContent('Se publica en la tienda al confirmar. El cliente verá MX$1,250.00 más el IVA que se traslada.');
    // Foco inicial en «Cancelar».
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Cancelar' })).toHaveFocus());
    fireEvent.click(within(dialog).getByRole('button', { name: 'Publicar · MX$1,250.00 antes de IVA' }));

    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch.mock.calls[0]).toEqual(['inv-s1', { listPriceCents: 125_000, status: 'listed' }]);
    expect(await screen.findByRole('status')).toHaveTextContent('INV-001950 publicada: MX$1,250.00 antes de IVA.');
  });

  it('FP-3 · sellado SIN ubicación ⇒ «Guardar precio» y el cuerpo NO lleva `status`', async () => {
    stub([sealedRow({ locationId: null, missing: ['location', 'price'] })]);
    const patch = vi.spyOn(api, 'updateInventoryItem').mockResolvedValue({} as InventoryItemDTO);
    renderWithProviders(<PendingPublishQueue />, 'es');
    await openEditorAndType('INV-001950', '980.5');
    const editor = screen.getByTestId('sealed-final-price-editor-inv-s1');
    expect(within(editor).queryByRole('button', { name: 'Guardar y publicar' })).toBeNull();
    expect(editor).toHaveTextContent('Se publicará sola en cuanto le pongas ubicación.');
    fireEvent.click(within(editor).getByRole('button', { name: 'Guardar precio' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('No se publica todavía: le falta ubicación.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar · MX$980.50 antes de IVA' }));
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch.mock.calls[0][1]).toEqual({ listPriceCents: 98_050 });
    expect(Object.keys(patch.mock.calls[0][1])).not.toContain('status');
  });

  it('FP-4 · `422 ITEM_NOT_ADJUSTABLE {status:"reserved"}` ⇒ el texto de «apartada» y el input CONSERVA lo tecleado', async () => {
    stub([sealedRow()]);
    vi.spyOn(api, 'updateInventoryItem').mockRejectedValue(
      new ApiClientError(422, { code: 'ITEM_NOT_ADJUSTABLE', message: 'x', details: { status: 'reserved' } }),
    );
    renderWithProviders(<PendingPublishQueue />, 'es');
    const input = await openEditorAndType('INV-001950', '1250');
    fireEvent.click(screen.getByRole('button', { name: 'Guardar y publicar' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Publicar · MX$1,250.00 antes de IVA' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Está apartada en un pedido en curso.');
    expect(alert).toHaveTextContent('No se guardó nada.');
    expect(within(alert).getByRole('button', { name: 'Recargar' })).toBeInTheDocument();
    expect(screen.getByLabelText('Precio antes de IVA (MXN)')).toBe(input);
    expect(input.value).toBe('1250');
  });

  it('otros errores: 409 CONFLICT y 422 ITEM_NOT_PUBLISHABLE con el estado TRADUCIDO (⛔ crudo)', async () => {
    stub([sealedRow()]);
    const spy = vi.spyOn(api, 'updateInventoryItem').mockRejectedValueOnce(new ApiClientError(409, { code: 'CONFLICT', message: 'x' }));
    renderWithProviders(<PendingPublishQueue />, 'es');
    await openEditorAndType('INV-001950', '1250');
    fireEvent.click(screen.getByRole('button', { name: 'Guardar y publicar' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Publicar · MX$1,250.00 antes de IVA' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('La pieza cambió mientras la editabas.');

    spy.mockRejectedValueOnce(new ApiClientError(422, { code: 'ITEM_NOT_PUBLISHABLE', message: 'x', details: { status: 'lost' } }));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar y publicar' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Publicar · MX$1,250.00 antes de IVA' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('No se pudo publicar: está «'));
    expect(screen.getByRole('alert').textContent).not.toMatch(/«lost»/);
  });

  it('validación al escribir: cero, decimales de más y el máximo; vacío apaga el botón SIN error', async () => {
    stub([sealedRow()]);
    renderWithProviders(<PendingPublishQueue />, 'es');
    const input = await openEditorAndType('INV-001950', '');
    const btn = () => screen.getByRole('button', { name: 'Guardar y publicar' });
    expect(btn()).toBeDisabled();
    fireEvent.change(input, { target: { value: '0' } });
    expect(screen.getByText('Escribe un precio mayor que cero.')).toBeInTheDocument();
    expect(btn()).toBeDisabled();
    fireEvent.change(input, { target: { value: '10.555' } });
    expect(screen.getByText('Máximo dos decimales.')).toBeInTheDocument();
    fireEvent.change(input, { target: { value: '1000000.01' } });
    expect(screen.getByText('El precio máximo es MX$1,000,000.00.')).toBeInTheDocument();
    expect(btn()).toBeDisabled();
  });

  it('Esc cancela y devuelve el foco al botón de la fila; una sola fila editando a la vez', async () => {
    stub([sealedRow(), sealedRow({ inventoryItemId: 'inv-s2', folio: 'INV-001951' })]);
    renderWithProviders(<PendingPublishQueue />, 'es');
    const input = await openEditorAndType('INV-001950', '12');
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Poner precio de INV-001950' })).toHaveFocus());

    await openEditorAndType('INV-001950', '12');
    fireEvent.click(screen.getByRole('button', { name: 'Poner precio de INV-001951' }));
    expect(screen.getAllByLabelText('Precio antes de IVA (MXN)')).toHaveLength(1);
    expect(screen.queryByTestId('sealed-final-price-editor-inv-s1')).toBeNull();
  });

  it('precio final ya puesto ⇒ «Cambiar precio», prellenado con él, base «precio final a mano»', async () => {
    stub([sealedRow({ listPriceCents: 118_000, resolvedSalePriceCents: 118_000, priceBasis: 'override', missing: ['location'], locationId: null })]);
    renderWithProviders(<PendingPublishQueue />, 'es');
    expect(await screen.findByTestId('sealed-final-price-inv-s1')).toHaveTextContent('MX$1,180.00 · precio final a mano');
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar precio de INV-001950' }));
    expect((screen.getByLabelText('Precio antes de IVA (MXN)') as HTMLInputElement).value).toBe('1180.00');
    // Igual al actual ⇒ nada que guardar.
    expect(screen.getByRole('button', { name: 'Guardar precio' })).toBeDisabled();
  });
});

describe('§39.3 · motivo por fila (pendingReason) y origen traducido', () => {
  it('`premium_at_floor` ⇒ su frase + «Ver la regla» (súper-admin) a /admin/m10#premium-piso', async () => {
    stub([row({ pendingReason: 'premium_at_floor', pendingPriceEntryId: 'ppe-1' })]);
    renderWithProviders(<PendingPublishQueue />, 'es');
    const reason = await screen.findByTestId('publish-reason-inv-1');
    expect(reason).toHaveTextContent('Rareza premium con mercado bajo el piso: retenida para revisión.');
    expect(within(reason).getByRole('link', { name: 'Ver la regla' })).toHaveAttribute('href', '/admin/m10#premium-piso');
  });

  it('`premium_at_floor` como operador ⇒ la frase, ⛔ sin enlace a Configuración', async () => {
    roleState.role = 'vault_operator';
    stub([row({ pendingReason: 'premium_at_floor' })]);
    renderWithProviders(<PendingPublishQueue />, 'es');
    const reason = await screen.findByTestId('publish-reason-inv-1');
    expect(within(reason).queryByRole('link')).toBeNull();
  });

  it.each([
    [{ pendingReason: 'no_market' as const }, 'El proveedor no trae precio de mercado para esta carta.'],
    [{ pendingReason: null, productType: 'graded' as const }, 'Le falta empresa y grado: captúralos en la pieza.'],
    [{ pendingPriceEntryId: 'ppe-9' }, 'Sin precio; el motivo está en la cola de precio pendiente.'],
    [{}, 'Sin precio y sin entrada en la cola de precio pendiente: avisa a sistemas.'],
  ])('%o ⇒ «%s»', async (over, text) => {
    stub([row(over)]);
    renderWithProviders(<PendingPublishQueue />, 'es');
    expect(await screen.findByTestId('publish-reason-inv-1')).toHaveTextContent(text);
  });

  it('LP-1 · origen `aportacion_en_especie` ⇒ «Aportación en especie»; ⛔ el literal crudo en el DOM', async () => {
    stub([
      row({ acquisitionType: 'aportacion_en_especie' }),
      row({ inventoryItemId: 'inv-2', folio: 'INV-2', acquisitionType: 'compra' }),
      row({ inventoryItemId: 'inv-3', folio: 'INV-3', acquisitionType: 'otra_cosa' as never }),
    ]);
    const { container } = renderWithProviders(<PendingPublishQueue />, 'es');
    expect(await screen.findByText('Aportación en especie')).toBeInTheDocument();
    expect(screen.getByText('Compra directa')).toBeInTheDocument();
    expect(screen.getByText('Origen desconocido')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/aportacion_en_especie|otra_cosa/);
  });

  it('el folio es un botón que abre la pieza (ItemDetailModal) sin salir de la cola', async () => {
    stub([row()]);
    const detail = vi.spyOn(api, 'getAdminInventoryItem').mockReturnValue(new Promise(() => {}));
    renderWithProviders(<PendingPublishQueue />, 'es');
    fireEvent.click(await screen.findByRole('button', { name: 'Abrir la pieza INV-001944' }));
    await waitFor(() => expect(detail).toHaveBeenCalledWith('inv-1'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('§39.2 (c) · el panel de «Sellado» (VariantDrawer)', () => {
  const fx = async () => (await import('@/lib/mock/fixtures')).mockInventory;

  async function sealedPiece(over: Partial<InventoryItemDTO>): Promise<InventoryItemDTO> {
    const base = (await fx()).find((i) => i.productType === 'sealed') ?? (await fx())[0];
    return { ...base, productType: 'sealed', ownerType: 'platform', ...over } as InventoryItemDTO;
  }

  it('sellado: rótulo «Antes de IVA», cifra derivada (S-2) y «Mercado» como referencia; reserved en solo lectura', async () => {
    const rows = [
      await sealedPiece({ id: 'p-1', folio: 'INV-001944', status: 'in_stock', location: undefined, listPriceCents: undefined, resolvedSalePriceCents: null, priceBasis: 'pending' }),
      await sealedPiece({ id: 'p-2', folio: 'INV-001945', status: 'listed', listPriceCents: 125_000, resolvedSalePriceCents: 125_000, priceBasis: 'override' }),
      await sealedPiece({ id: 'p-3', folio: 'INV-001946', status: 'reserved', listPriceCents: 125_000 }),
    ];
    vi.spyOn(api, 'getAdminInventory').mockResolvedValue({ data: rows, page: 1, pageSize: 100, total: 3 });
    renderWithProviders(
      <VariantDrawer cardId="c-s" cardName="Surging Sparks Booster Box" cardNumber="" finish="normal" productType="sealed" marketRefCents={110_000} onClose={() => {}} />,
      'es',
    );
    const p1 = await screen.findByTestId('sealed-final-price-p-1');
    expect(p1).toHaveTextContent('Antes de IVA: — · sin precio');
    expect(p1).toHaveTextContent('Mercado: MX$1,100.00');
    expect(screen.getByTestId('sealed-final-price-p-2')).toHaveTextContent('Antes de IVA: MX$1,250.00 a mano');
    expect(screen.getByRole('button', { name: 'Poner precio de INV-001944' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cambiar precio de INV-001945' })).toBeInTheDocument();
    // `reserved`: solo lectura, sin lápiz.
    expect(screen.queryByRole('button', { name: /precio de INV-001946/ })).toBeNull();
    expect(screen.getByTestId('sealed-final-price-p-3')).toHaveTextContent('MX$1,250.00');
    // ⛔ El botón-número escondido de raw/graded no aparece en sellado.
    expect(screen.queryByRole('button', { name: /^Editar precio de/ })).toBeNull();
  });

  it('servidor anterior a S-2 (sin `resolvedSalePriceCents`) ⇒ «automático» SIN cifra', async () => {
    const rows = [await sealedPiece({ id: 'p-1', folio: 'INV-001944', status: 'in_stock', listPriceCents: undefined })];
    delete (rows[0] as Partial<InventoryItemDTO>).resolvedSalePriceCents;
    vi.spyOn(api, 'getAdminInventory').mockResolvedValue({ data: rows, page: 1, pageSize: 100, total: 1 });
    renderWithProviders(<VariantDrawer cardId="c-s" cardName="Box" cardNumber="" finish="normal" productType="sealed" onClose={() => {}} />, 'es');
    expect(await screen.findByTestId('sealed-final-price-p-1')).toHaveTextContent('Antes de IVA: automático');
  });

  it('re-precio de una publicada ⇒ «Guardar precio», sin `status`', async () => {
    const rows = [await sealedPiece({ id: 'p-2', folio: 'INV-001945', status: 'listed', listPriceCents: 125_000 })];
    vi.spyOn(api, 'getAdminInventory').mockResolvedValue({ data: rows, page: 1, pageSize: 100, total: 1 });
    const patch = vi.spyOn(api, 'updateInventoryItem').mockResolvedValue({} as InventoryItemDTO);
    const onToast = vi.fn();
    renderWithProviders(<VariantDrawer cardId="c-s" cardName="Box" cardNumber="" finish="normal" productType="sealed" onClose={() => {}} onToast={onToast} />, 'es');
    fireEvent.click(await screen.findByRole('button', { name: 'Cambiar precio de INV-001945' }));
    fireEvent.change(screen.getByLabelText('Precio antes de IVA (MXN)'), { target: { value: '1300' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar precio' }));
    const dialog = await screen.findByRole('dialog', { name: '¿Fijar el precio de Box?' });
    expect(dialog).toHaveTextContent('Ya está a la venta');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar · MX$1,300.00 antes de IVA' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('p-2', { listPriceCents: 130_000 }));
    await waitFor(() => expect(onToast).toHaveBeenCalledWith('Precio de INV-001945 cambiado a MX$1,300.00 antes de IVA.'));
  });

  /**
   * FP-5 · P-PRE-1 «se conserva como está, sin hacerlo más visible»: la celda de precio de una pieza RAW es la de
   * hoy, byte a byte (snapshot acotado al botón-número), sin rótulo nuevo ni lápiz.
   */
  it('FP-5 · panel raw ⇒ la celda de precio es la de hoy (snapshot acotado)', async () => {
    const all = await fx();
    const base = { ...all.find((i) => i.id === 'inv-2001')!, listPriceCents: 150_000 };
    vi.spyOn(api, 'getAdminInventory').mockResolvedValue({ data: [base], page: 1, pageSize: 100, total: 1 });
    renderWithProviders(<VariantDrawer cardId="c-charizard" cardName="Charizard" cardNumber="4" finish="normal" productType="raw" onClose={() => {}} />, 'es');
    const cell = await screen.findByRole('button', { name: 'Editar precio de INV-000201' });
    expect(cell.outerHTML).toMatchInlineSnapshot(
      `"<button type="button" class="ml-auto font-mono tabular-nums text-xs text-text hover:text-accent" aria-label="Editar precio de INV-000201">MX$1,500.00</button>"`,
    );
    expect(screen.queryByText(/Antes de IVA/)).toBeNull();
    expect(screen.queryByRole('button', { name: /^(Poner|Cambiar) precio de /i })).toBeNull();
    expect(screen.queryByTestId(/^sealed-final-price/)).toBeNull();
  });
});

describe('techlead D-8 · una sola lista de invalidaciones', () => {
  it('«Recargar» tras un `409` invalida EXACTAMENTE lo mismo que un guardado con éxito (incluido el panel de «Sellado»)', async () => {
    stub([sealedRow()]);
    const inv = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
    const firstKeys = () => inv.mock.calls.map((c) => (c[0] as { queryKey: string[] }).queryKey[0]);
    const patch = vi
      .spyOn(api, 'updateInventoryItem')
      .mockRejectedValueOnce(new ApiClientError(409, { code: 'CONFLICT', message: 'x' }))
      .mockResolvedValueOnce({} as InventoryItemDTO);
    renderWithProviders(<PendingPublishQueue />, 'es');
    await openEditorAndType('INV-001950', '1250');
    fireEvent.click(screen.getByRole('button', { name: 'Guardar y publicar' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Publicar · MX$1,250.00 antes de IVA' }));
    const alert = await screen.findByRole('alert');
    inv.mockClear();
    fireEvent.click(within(alert).getByRole('button', { name: 'Recargar' }));
    const onReload = new Set(firstKeys());

    inv.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar y publicar' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Publicar · MX$1,250.00 antes de IVA' }));
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(inv).toHaveBeenCalled());
    const onSave = new Set(firstKeys());

    expect([...onReload].sort()).toEqual([...SEALED_FINAL_PRICE_INVALIDATES].sort());
    expect([...onSave].sort()).toEqual([...SEALED_FINAL_PRICE_INVALIDATES].sort());
    expect(onReload.has('sealed-set-detail')).toBe(true);
  });
});
