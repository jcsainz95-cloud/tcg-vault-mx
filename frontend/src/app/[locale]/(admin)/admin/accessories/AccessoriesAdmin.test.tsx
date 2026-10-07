import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { adminAcc } from '@/test/accessories.testkit';
import type { AdminAccessoryDTO } from '@/types/contract';

/**
 * AC-F10 (`API_CONTRACT §AC.11`, `DESIGN_SYSTEM §AC-UX.9/.11`): panel de accesorios.
 * AC-UX-10: el operador no ve precio editable, costo, «Sugerido» ni «Publicar»; el súper-admin sí.
 * AC-UX-11: cada `PHOTO_INVALID.reason` pinta su texto; > 10 MiB no hace la petición.
 */
const { roleState, router } = vi.hoisted(() => ({
  roleState: { role: 'super_admin' as 'super_admin' | 'vault_operator' },
  router: { push: vi.fn(), replace: vi.fn() },
}));
vi.mock('@/lib/role', () => ({
  useRole: () => ({
    role: roleState.role,
    setRole: () => {},
    isSuperAdmin: roleState.role === 'super_admin',
    canSwitchRole: false,
  }),
}));
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/admin/accessories',
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));

import { AccessoriesAdminView } from './AccessoriesAdminView';
import { AccessoryEditView } from './AccessoryEditView';

beforeEach(() => {
  vi.restoreAllMocks();
  roleState.role = 'super_admin';
  router.push.mockReset();
  vi.spyOn(api, 'listAccessoryStockMovements').mockResolvedValue({ items: [], page: 1, pageSize: 20, total: 0 });
  vi.spyOn(api, 'getSettings').mockResolvedValue({ energyBundlePriceCents: 2000, accessorySuggestionCount: 3 } as never);
});

const NO_PHOTO = adminAcc({
  id: 'acc-fire',
  name: 'Energía Fuego',
  category: 'energy',
  energyType: 'fire',
  priceCents: 500,
  photo: null,
  lengthMm: null,
  widthMm: null,
  heightMm: null,
  weightG: null,
  stockQty: 0,
  availableQty: 0,
});
const SLEEVES = adminAcc({ id: 'acc-1', name: 'Penny sleeves x100', active: true, reservedQty: 3, availableQty: 17, suggested: true });
const NO_PRICE = adminAcc({ id: 'acc-2', name: 'Toploader x25', priceCents: null });

function mockList(items: AdminAccessoryDTO[] = [NO_PHOTO, SLEEVES, NO_PRICE]) {
  return vi.spyOn(api, 'listAdminAccessories').mockResolvedValue({ items, page: 1, pageSize: 24, total: items.length });
}

describe('AC-F10 · lista del panel', () => {
  it('SIN FOTO, SIN PRECIO, PUBLICADO, SUGERIDO y «N apartadas · M disponibles»', async () => {
    mockList();
    renderWithProviders(<AccessoriesAdminView />, 'es');
    const fire = await screen.findByTestId('admin-accessory-acc-fire');
    expect(within(fire).getByText('SIN FOTO')).toBeInTheDocument();
    expect(within(fire).getByText('NO PUBLICADO')).toBeInTheDocument();
    expect(within(fire).getByText('Energías · Fuego')).toBeInTheDocument();
    const sl = screen.getByTestId('admin-accessory-acc-1');
    expect(within(sl).getByText('PUBLICADO')).toBeInTheDocument();
    expect(within(sl).getByText('SUGERIDO')).toBeInTheDocument();
    expect(within(sl).getByText('3 apartadas · 17 disponibles')).toBeInTheDocument();
    expect(within(screen.getByTestId('admin-accessory-acc-2')).getByText('SIN PRECIO')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Nuevo accesorio' })).toHaveAttribute('href', '/admin/accessories/new');
  });

  it('los filtros viajan al servidor', async () => {
    const user = userEvent.setup();
    const spy = mockList();
    renderWithProviders(<AccessoriesAdminView />, 'es');
    await screen.findByTestId('admin-accessory-acc-1');
    await user.selectOptions(screen.getByLabelText('Categoría'), 'energy');
    await user.click(screen.getByLabelText('Solo agotados'));
    await waitFor(() =>
      expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ category: 'energy', soldOut: true })),
    );
  });

  it('súper-admin: bloque «Precios fijos y sugerencias»; el operador no lo ve', async () => {
    mockList();
    const { unmount } = renderWithProviders(<AccessoriesAdminView />, 'es');
    expect(await screen.findByText('Precios fijos y sugerencias')).toBeInTheDocument();
    unmount();
    roleState.role = 'vault_operator';
    renderWithProviders(<AccessoriesAdminView />, 'es');
    await screen.findByTestId('admin-accessory-acc-1');
    expect(screen.queryByText('Precios fijos y sugerencias')).toBeNull();
  });

  it('el bloque de ajustes guarda los dos diales con PUT /admin/settings', async () => {
    const user = userEvent.setup();
    mockList();
    const put = vi.spyOn(api, 'updateSettings').mockResolvedValue({} as never);
    renderWithProviders(<AccessoriesAdminView />, 'es');
    await user.click(await screen.findByText('Precios fijos y sugerencias'));
    const price = await screen.findByLabelText('Precio del paquete de energías (con IVA)');
    await user.clear(price);
    await user.type(price, '25');
    const count = screen.getByLabelText('Accesorios sugeridos en el carrito');
    await user.clear(count);
    await user.type(count, '0');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(put).toHaveBeenCalledWith({ energyBundlePriceCents: 2500, accessorySuggestionCount: 0 }));
  });

  it('filtrado por Energías con precios distintos: «Las energías no tienen todas el mismo precio.»', async () => {
    mockList([NO_PHOTO, { ...NO_PHOTO, id: 'acc-water', energyType: 'water', name: 'Energía Agua', priceCents: 600 }]);
    renderWithProviders(<AccessoriesAdminView />, 'es');
    expect(await screen.findByText('Las energías no tienen todas el mismo precio.')).toBeInTheDocument();
  });
});

describe('AC-UX-10 · lo que ve el operador y lo que ve el súper-admin en la ficha', () => {
  it('operador: precio solo lectura, sin costo en el DOM, sin «Sugerido» ni «Publicar» ni «Borrar»', async () => {
    roleState.role = 'vault_operator';
    const { unitCostCents: _omit, ...asOperator } = SLEEVES;
    vi.spyOn(api, 'getAdminAccessory').mockResolvedValue(asOperator);
    renderWithProviders(<AccessoryEditView id="acc-1" />, 'es');
    expect(await screen.findByText(/Precio de venta: .*89\.00/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Precio de venta (con IVA)')).toBeNull();
    expect(screen.queryByText(/Costo por unidad/)).toBeNull();
    expect(screen.queryByText(/40\.00/)).toBeNull();
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.queryByRole('button', { name: /Publicar en la tienda|Quitar de la tienda/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Borrar accesorio' })).toBeNull();
    // El operador sí edita datos, foto y existencias.
    expect(screen.getByRole('button', { name: 'Guardar datos' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Entraron' })).toBeInTheDocument();
  });

  it('súper-admin: precio y costo editables, «Sugerido», «Quitar de la tienda» y PATCH con centavos', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'getAdminAccessory').mockResolvedValue(SLEEVES);
    const patch = vi.spyOn(api, 'updateAdminAccessory').mockResolvedValue(undefined);
    renderWithProviders(<AccessoryEditView id="acc-1" />, 'es');
    const price = await screen.findByLabelText('Precio de venta (con IVA)');
    expect(screen.getByLabelText('Costo por unidad')).toHaveValue('40.00');
    expect(screen.getByRole('switch', { name: 'Sugerido en el carrito' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Quitar de la tienda' })).toBeInTheDocument();
    await user.clear(price);
    await user.type(price, '95.50');
    await user.click(screen.getByRole('button', { name: 'Guardar precio' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('acc-1', { priceCents: 9550, unitCostCents: 4000 }));
  });

  it('energía: sin medidas (con su nota) y el «Sugerido» apagado con su razón', async () => {
    vi.spyOn(api, 'getAdminAccessory').mockResolvedValue(NO_PHOTO);
    renderWithProviders(<AccessoryEditView id="acc-fire" />, 'es');
    expect(await screen.findByText('Las energías no llevan medidas: viajan con las cartas.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Largo (mm)')).toBeNull();
    expect(screen.getByRole('switch', { name: 'Sugerido en el carrito' })).toBeDisabled();
    expect(screen.getByText('Las energías no se sugieren en el carrito: se ofrecen en los decks.')).toBeInTheDocument();
    // Lo que falta para publicar sale del DTO: en energía solo la foto (precio sí hay).
    expect(screen.getByText('Para publicarlo falta: foto.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publicar en la tienda' })).toBeDisabled();
  });

  it('422 ACCESSORY_NOT_ACTIVATABLE pinta los faltantes del SERVIDOR; 409 ENERGY_TYPE_TAKEN enlaza a la otra', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'getAdminAccessory').mockResolvedValue({ ...SLEEVES, active: false });
    const act = vi
      .spyOn(api, 'activateAdminAccessory')
      .mockRejectedValueOnce(new ApiClientError(422, { code: 'ACCESSORY_NOT_ACTIVATABLE', message: 'x', details: { missing: ['dimensions', 'weight'] } }))
      .mockRejectedValueOnce(new ApiClientError(409, { code: 'ENERGY_TYPE_TAKEN', message: 'x', details: { accessoryId: 'acc-other' } }));
    renderWithProviders(<AccessoryEditView id="acc-1" />, 'es');
    await user.click(await screen.findByRole('button', { name: 'Publicar en la tienda' }));
    expect(await screen.findByText('Para publicarlo falta: medidas, peso.')).toBeInTheDocument();
    expect(screen.getByText('No se publicó.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Publicar en la tienda' }));
    expect(await screen.findByRole('link', { name: 'Ver la otra' })).toHaveAttribute('href', '/admin/accessories/acc-other');
    expect(act).toHaveBeenCalledTimes(2);
  });

  it('borrar: con ventas solo el texto; sin ventas el diálogo y DELETE', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'getAdminAccessory').mockResolvedValue({ ...SLEEVES, hasSales: true });
    const { unmount } = renderWithProviders(<AccessoryEditView id="acc-1" />, 'es');
    expect(await screen.findByText('Ya se vendió: no se puede borrar. Quítalo de la tienda para que deje de verse.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Borrar accesorio' })).toBeNull();
    unmount();
    vi.spyOn(api, 'getAdminAccessory').mockResolvedValue({ ...SLEEVES, hasSales: false });
    const del = vi.spyOn(api, 'deleteAdminAccessory').mockResolvedValue(undefined);
    renderWithProviders(<AccessoryEditView id="acc-1" />, 'es');
    await user.click(await screen.findByRole('button', { name: 'Borrar accesorio' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Se borra con su foto y su historial de existencias. No se puede deshacer.')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Borrar' }));
    await waitFor(() => expect(del).toHaveBeenCalledWith('acc-1'));
  });
});

describe('alta', () => {
  it('crea con POST (nace sin publicar), sin campos ★ si es operador, y navega a la ficha', async () => {
    const user = userEvent.setup();
    roleState.role = 'vault_operator';
    const create = vi.spyOn(api, 'createAdminAccessory').mockResolvedValue({ ...SLEEVES, id: 'acc-new', active: false });
    renderWithProviders(<AccessoryEditView />, 'es');
    await user.type(screen.getByLabelText('Nombre'), 'Carpeta 9 bolsillos');
    await user.selectOptions(screen.getByLabelText('Categoría'), 'binders');
    await user.type(screen.getByLabelText('Largo (mm)'), '320');
    await user.click(screen.getByRole('button', { name: 'Guardar datos' }));
    await waitFor(() => expect(create).toHaveBeenCalled());
    const body = create.mock.calls[0][0];
    expect(body).toMatchObject({ name: 'Carpeta 9 bolsillos', category: 'binders', lengthMm: 320 });
    expect(body).not.toHaveProperty('priceCents');
    expect(body).not.toHaveProperty('unitCostCents');
    expect(body).not.toHaveProperty('suggested');
    expect(body).not.toHaveProperty('active');
    expect(router.push).toHaveBeenCalledWith('/admin/accessories/acc-new?created=1');
  });
});

describe('AC-UX-11 · foto', () => {
  const REASONS: [string, string][] = [
    ['too_large', 'La foto pesa más de 10 MB. No se guardó nada.'],
    ['unsupported_type', 'Ese archivo no es PNG, JPG ni WebP. No se guardó nada.'],
    ['too_many_pixels', 'La foto es demasiado grande en píxeles. Redúcela y vuelve a subirla. No se guardó nada.'],
    ['not_image', 'No pudimos abrir ese archivo como imagen. No se guardó nada.'],
  ];
  it.each(REASONS)('PHOTO_INVALID %s ⇒ su texto, role="alert"', async (reason, text) => {
    vi.spyOn(api, 'getAdminAccessory').mockResolvedValue(SLEEVES);
    vi.spyOn(api, 'uploadAccessoryPhoto').mockRejectedValue(
      new ApiClientError(422, { code: 'PHOTO_INVALID', message: 'x', details: { reason } }),
    );
    renderWithProviders(<AccessoryEditView id="acc-1" />, 'es');
    const input = (await screen.findByTestId('accessory-photo-input')) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['x'], 'a.png', { type: 'image/png' })] } });
    const msg = await screen.findByText(text);
    expect(msg.closest('[role="alert"]')).not.toBeNull();
  });

  it('un archivo de más de 10 MiB no se manda', async () => {
    vi.spyOn(api, 'getAdminAccessory').mockResolvedValue(SLEEVES);
    const up = vi.spyOn(api, 'uploadAccessoryPhoto');
    renderWithProviders(<AccessoryEditView id="acc-1" />, 'es');
    const input = (await screen.findByTestId('accessory-photo-input')) as HTMLInputElement;
    const big = new File(['x'], 'big.png', { type: 'image/png' });
    Object.defineProperty(big, 'size', { value: 10 * 1024 * 1024 + 1 });
    fireEvent.change(input, { target: { files: [big] } });
    expect(await screen.findByText('La foto pesa más de 10 MB. No se guardó nada.')).toBeInTheDocument();
    expect(up).not.toHaveBeenCalled();
  });
});

describe('AC-F10 · existencias con motivo', () => {
  it('«Entraron» manda receive; «Ajuste» manda expectedStockQty y pinta STOCK_CONFLICT con el número nuevo', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'getAdminAccessory').mockResolvedValue(SLEEVES);
    const stock = vi
      .spyOn(api, 'postAccessoryStock')
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new ApiClientError(409, { code: 'STOCK_CONFLICT', message: 'x', details: { stockQty: 25 } }))
      .mockRejectedValueOnce(new ApiClientError(409, { code: 'STOCK_BELOW_RESERVED', message: 'x', details: { reservedQty: 3 } }));
    renderWithProviders(<AccessoryEditView id="acc-1" />, 'es');
    expect(await screen.findByText('Existencias: 20')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Entraron' }));
    let dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Cantidad'), '5');
    await user.click(within(dialog).getByRole('button', { name: 'Sumar 5' }));
    await waitFor(() => expect(stock).toHaveBeenCalledWith('acc-1', { kind: 'receive', quantity: 5 }));

    await user.click(screen.getByRole('button', { name: 'Ajuste (conteo)' }));
    dialog = await screen.findByRole('dialog');
    const real = within(dialog).getByLabelText('Existencias reales');
    expect(within(dialog).getByRole('button', { name: 'Ajustar a 20' })).toBeDisabled();
    await user.clear(real);
    await user.type(real, '18');
    await user.type(within(dialog).getByLabelText('Motivo'), 'merma');
    await user.click(within(dialog).getByRole('button', { name: 'Ajustar a 18' }));
    await waitFor(() =>
      expect(stock).toHaveBeenLastCalledWith('acc-1', { kind: 'adjust', newStockQty: 18, expectedStockQty: 20, reason: 'merma' }),
    );
    expect(
      await within(dialog).findByText('Las existencias cambiaron mientras ajustabas: ahora hay 25. No se cambió nada. Revisa y vuelve a intentarlo.'),
    ).toBeInTheDocument();
    // El diálogo sigue abierto y el próximo intento manda el número nuevo como esperado.
    await user.click(within(dialog).getByRole('button', { name: 'Ajustar a 18' }));
    await waitFor(() =>
      expect(stock).toHaveBeenLastCalledWith('acc-1', { kind: 'adjust', newStockQty: 18, expectedStockQty: 25, reason: 'merma' }),
    );
    expect(
      await within(dialog).findByText('Hay 3 apartadas en pedidos en curso: las existencias no pueden quedar por debajo. No se cambió nada.'),
    ).toBeInTheDocument();
  });

  it('el historial rotula el movimiento y «El sistema» cuando no hay actor', async () => {
    vi.spyOn(api, 'getAdminAccessory').mockResolvedValue(SLEEVES);
    vi.spyOn(api, 'listAccessoryStockMovements').mockResolvedValue({
      items: [
        { kind: 'sale', delta: -3, stockBefore: 20, stockAfter: 17, reason: null, actor: null, orderNumber: 'TCG-000201', createdAt: '2026-10-07T12:00:00.000Z' },
        { kind: 'adjust', delta: 2, stockBefore: 18, stockAfter: 20, reason: 'conteo físico', actor: { userId: 'u1', name: 'Ana' }, orderNumber: null, createdAt: '2026-10-06T12:00:00.000Z' },
      ],
      page: 1,
      pageSize: 20,
      total: 2,
    });
    renderWithProviders(<AccessoryEditView id="acc-1" />, 'es');
    const hist = await screen.findByTestId('accessory-stock-history');
    expect(await within(hist).findByText('Venta')).toBeInTheDocument();
    expect(within(hist).getByText('−3')).toBeInTheDocument();
    expect(within(hist).getByText('El sistema')).toBeInTheDocument();
    expect(within(hist).getByText('Pedido TCG-000201')).toBeInTheDocument();
    expect(within(hist).getByText('+2')).toBeInTheDocument();
    expect(within(hist).getByText('conteo físico')).toBeInTheDocument();
  });
});
