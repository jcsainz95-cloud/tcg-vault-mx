import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { mockInventory, mockLocations } from '@/lib/mock/fixtures';
import type { AdminInventoryItemDetailDTO, InventoryItemDTO, InventoryStatus } from '@/types/contract';
import { ItemDetailModal } from './ItemDetailModal';

vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/admin/m1',
  useRouter: () => ({ push: vi.fn() }),
  Link: ({ href, children, ...rest }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}));

// El rol por defecto es el del contexto sin proveedor (`customer`), como antes de §M11-SP; las pruebas del dueño lo cambian.
const roleState = vi.hoisted(() => ({ role: 'customer' }));
vi.mock('@/lib/role', () => ({
  useRole: () => ({ role: roleState.role, setRole: () => {}, isSuperAdmin: roleState.role === 'super_admin', canSwitchRole: false }),
}));

beforeEach(() => {
  vi.restoreAllMocks();
  roleState.role = 'customer';
});

function detail(status: InventoryStatus): AdminInventoryItemDetailDTO {
  return {
    ...mockInventory[0],
    status,
    // En `loc-1` (stock de plataforma) ⇒ el destino posible en stock es `loc-2`.
    location: { id: 'loc-1', label: 'C03-F02-S15', zone: 'platform_stock' },
    movements: [],
    // §M11-SP.13.6: el detalle trae la clave en toda fila (raw/graded `null`).
    sealedProductId: null,
  };
}

/**
 * **Hueco 1 (auditoría del operador, 2026-09-29).** Una carta vendida en preparación (`picking`) tiene
 * que poder ubicarse/corregirse desde el detalle de M1. SOLO «Mover de ubicación»: la merma no.
 */
describe('ItemDetailModal · hueco 1: mover una pieza en `picking`', () => {
  /*
   * Respuesta REAL del move, en sus DOS formas: `sin location` = la fila de `toAdminInventoryItemRow`
   * (`locationId`, SIN `location`), lo que sirve production hoy (QA, medido contra el stack
   * 2026-09-29 — la prueba anterior simulaba un `location` que ese backend no produce, y por eso no
   * veía el aviso «Item movido a .»); `con location` = lo que añade el backend de esta rama
   * (`inventory.service.ts · moveItem`). Front y back se publican por separado: valen las dos.
   */
  it.each([
    ['sin location', false],
    ['con location', true],
  ])('en `picking` ofrece «Mover de ubicación» (solo stock de plataforma) y NO la merma ni publicar (respuesta %s)', async (_shape, withLocation) => {
    vi.spyOn(api, 'getAdminInventoryItem').mockResolvedValue(detail('picking'));
    const row: InventoryItemDTO = { ...mockInventory[0], status: 'picking' };
    delete row.location;
    const moveSpy = vi.spyOn(api, 'moveInventoryItem').mockResolvedValue({
      ...row,
      locationId: 'loc-2',
      ...(withLocation
        ? { location: { id: 'loc-2', label: 'C03-F02-S16', zone: 'platform_stock' as const } }
        : {}),
    } as InventoryItemDTO);
    renderWithProviders(
      <ItemDetailModal itemId="inv-1001" onClose={() => {}} locations={mockLocations} />,
      'es',
    );
    const dialog = await screen.findByRole('dialog', { name: 'Detalle de pieza' });
    expect(await within(dialog).findByRole('heading', { name: /Mover de ubicación/ })).toBeInTheDocument();
    expect(within(dialog).queryByRole('heading', { name: /Marcar pérdida/ })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Publicar' })).not.toBeInTheDocument();

    const select = within(dialog).getByLabelText('Nueva ubicación') as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value).filter(Boolean);
    // Solo stock de plataforma, sin la actual: nunca un cajón de custodia de cliente.
    expect(values).toEqual(['loc-2']);

    fireEvent.change(select, { target: { value: 'loc-2' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Mover' }));
    await waitFor(() =>
      expect(moveSpy).toHaveBeenCalledWith('inv-1001', { toLocationId: 'loc-2', note: undefined }),
    );
    // El aviso nombra la ubicación ELEGIDA — nunca «Item movido a .» con la etiqueta vacía.
    const ok = await within(dialog).findByRole('status');
    expect(ok).toHaveTextContent('Item movido a C03-F02-S16.');
  });

  /**
   * **QA IMPORTANTE sobre `4ca6c45` (2026-09-29).** El selector ofrecía cajones de «Custodia de
   * clientes» a una pieza de plataforma `in_stock`/`listed`; el backend responde
   * `422 LOCATION_NOT_AVAILABLE reason=not_platform_stock` (`item-location.rules.ts ·
   * assertMoveDestination`) y el banner pintaba el inglés del servidor. Una pieza de la tienda solo
   * vive en `platform_stock`, en CUALQUIER estado — no solo en `picking`.
   */
  it.each(['in_stock', 'listed'] as const)(
    'en `%s` ofrece mover SOLO a stock de plataforma activo (ningún cajón de custodia) y sigue la merma',
    async (status) => {
      vi.spyOn(api, 'getAdminInventoryItem').mockResolvedValue(detail(status));
      const locations = [
        ...mockLocations,
        // Un estante de plataforma INACTIVO tampoco se ofrece (`reason:'inactive'`).
        { ...mockLocations[1], id: 'loc-6', label: 'C03-F02-S17', isActive: false },
      ];
      renderWithProviders(
        <ItemDetailModal itemId="inv-1001" onClose={() => {}} locations={locations} />,
        'es',
      );
      const dialog = await screen.findByRole('dialog', { name: 'Detalle de pieza' });
      expect(await within(dialog).findByRole('heading', { name: /Mover de ubicación/ })).toBeInTheDocument();
      expect(within(dialog).getByRole('heading', { name: /Marcar pérdida/ })).toBeInTheDocument();
      const select = within(dialog).getByLabelText('Nueva ubicación') as HTMLSelectElement;
      const options = Array.from(select.options).filter((o) => o.value);
      expect(options.map((o) => o.value)).toEqual(['loc-2']);
      expect(options.map((o) => o.textContent)).toEqual(['C03-F02-S16 · Stock de plataforma']);
    },
  );

  it('un `422 LOCATION_NOT_AVAILABLE` del move se pinta TRADUCIDO con su motivo, nunca el inglés del servidor', async () => {
    vi.spyOn(api, 'getAdminInventoryItem').mockResolvedValue(detail('in_stock'));
    // Forma EXACTA del backend (`item-location.rules.ts · locationError`). `not_platform_stock` ya no
    // debería poder producirse desde esta UI (el selector no lo ofrece), pero es el `reason` que QA
    // midió y el que un backend/lista rancia puede seguir devolviendo.
    vi.spyOn(api, 'moveInventoryItem').mockRejectedValue(
      new ApiClientError(422, {
        code: 'LOCATION_NOT_AVAILABLE',
        message: 'Location not available: not_platform_stock',
        details: { reason: 'not_platform_stock' },
      }),
    );
    renderWithProviders(
      <ItemDetailModal itemId="inv-1001" onClose={() => {}} locations={mockLocations} />,
      'es',
    );
    const dialog = await screen.findByRole('dialog', { name: 'Detalle de pieza' });
    const select = (await within(dialog).findByLabelText('Nueva ubicación')) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'loc-2' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Mover' }));
    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent('No se pudo mover el item.');
    // El motivo, en castellano: la pieza es de la tienda y el destino no era un estante de la tienda.
    expect(alert).toHaveTextContent('solo puede ir a un estante de stock de plataforma');
    expect(alert).toHaveTextContent('No se guardó nada');
    expect(alert.textContent).not.toMatch(/Location not available|not_platform_stock/);
  });

  it('en `shipped` no ofrece mover (una pieza que ya salió no se reubica)', async () => {
    vi.spyOn(api, 'getAdminInventoryItem').mockResolvedValue(detail('shipped'));
    renderWithProviders(
      <ItemDetailModal itemId="inv-1001" onClose={() => {}} locations={mockLocations} />,
      'es',
    );
    const dialog = await screen.findByRole('dialog', { name: 'Detalle de pieza' });
    await within(dialog).findByText('Historial de movimientos');
    expect(within(dialog).queryByRole('heading', { name: /Mover de ubicación/ })).not.toBeInTheDocument();
  });
});

/**
 * **SR-UI-10** (`DESIGN_SYSTEM §40.5`, N-16): el historial con un movimiento de CADA `MovementReason` (13 = paridad con
 * `schema.prisma` y §Enums, v1.80.8.6) ⇒ ningún texto del DOM contiene `movementReason.` ni un valor crudo. Cierra los
 * tres huecos anteriores (`adjustment`, `replacement`, `refund_return`) y el nuevo `refund_release`.
 */
describe('ItemDetailModal · SR-UI-10: los 13 motivos del historial tienen texto', () => {
  it.each(['es', 'en'] as const)('%s: ningún motivo crudo ni clave en el DOM', async (locale) => {
    const { MOVEMENT_REASONS } = await import('@/types/contract');
    expect(MOVEMENT_REASONS).toHaveLength(13);
    vi.spyOn(api, 'getAdminInventoryItem').mockResolvedValue({
      ...detail('listed'),
      movements: MOVEMENT_REASONS.map((reason, i) => ({
        id: `mv-${i}`,
        reason,
        fromStatus: reason === 'refund_release' ? 'reserved' : null,
        toStatus: reason === 'refund_release' ? 'listed' : null,
        fromLocationId: null,
        toLocationId: null,
        note: null,
        createdAt: '2026-10-04T10:00:00Z',
      })) as AdminInventoryItemDetailDTO['movements'],
    });
    const { container } = renderWithProviders(
      <ItemDetailModal itemId="inv-1001" onClose={() => {}} locations={mockLocations} />,
      locale,
    );
    await screen.findByText(locale === 'es' ? 'Liberada por reembolso' : 'Released by refund');
    const text = container.ownerDocument.body.textContent ?? '';
    expect(text).not.toMatch(/movementReason\./);
    for (const raw of MOVEMENT_REASONS) {
      // `alta`/`move`/… son palabras corrientes (y en EN «Stock-count adjustment» es el texto bueno): se buscan los
      // crudos con guion bajo en los dos idiomas y, en ES, también los inequívocos en inglés.
      if (raw.includes('_') || (locale === 'es' && ['adjustment', 'replacement', 'settle', 'withdrawal'].includes(raw))) {
        expect(text, raw).not.toContain(raw);
      }
    }
    if (locale === 'es') {
      for (const label of ['Liberada por reembolso', 'Devuelta por reembolso', 'Reposición', 'Ajuste por levantamiento']) {
        expect(screen.getByText(label)).toBeInTheDocument();
      }
      // `Apartada → A la venta` (estados traducidos) bajo el movimiento nuevo.
      expect(text).toMatch(/→/);
    }
  });
});

/**
 * **UX-SP-10 = F-SP-4 (parte del detalle)** y §70.3 (c) con §M11-SP.13.6 (A-5 respondida: el modal lee `sealedProductId`
 * del DETALLE, sin prop provisional). Se decide por `productType` primero.
 */
describe('ItemDetailModal · §70.3 (c) sellado ligado / sin producto', () => {
  function sealed(over: Partial<AdminInventoryItemDetailDTO> = {}): AdminInventoryItemDetailDTO {
    return {
      ...detail('in_stock'),
      productType: 'sealed',
      sealedSubtype: 'etb',
      listPriceCents: undefined,
      ...over,
    };
  }

  it('ligado ⇒ sin input de precio, «Lo fija el producto» + enlace a la hoja, y el PATCH de publicar SIN listPriceCents', async () => {
    vi.spyOn(api, 'getAdminInventoryItem').mockResolvedValue(sealed({ sealedProductId: 'sp-1', listPriceCents: 120000 }));
    const patch = vi.spyOn(api, 'updateInventoryItem').mockResolvedValue({ ...mockInventory[0], status: 'listed' });
    renderWithProviders(<ItemDetailModal itemId="inv-1001" onClose={() => {}} locations={mockLocations} />);
    const cell = await screen.findByTestId('detail-sealed-price-by-product');
    expect(cell.textContent).toContain('Lo fija el producto');
    expect(within(cell).getByRole('link', { name: 'Ver en «Precios del sellado»' })).toHaveAttribute('href', '/admin/m11#precios-sellado');
    expect(screen.queryByLabelText(/Precio/)).toBeNull();
    // ⛔ sin badge de precio manual aunque traiga `listPriceCents` (legado sombreado).
    expect(screen.queryByText('Precio manual')).toBeNull();
    const publish = screen.getByRole('button', { name: 'Publicar' });
    expect(publish).not.toBeDisabled();
    fireEvent.click(publish);
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch.mock.calls[0]![1]).toEqual({ status: 'listed' });
  });

  it('ligado + 422 PRICE_PENDING ⇒ texto propio junto al botón', async () => {
    vi.spyOn(api, 'getAdminInventoryItem').mockResolvedValue(sealed({ sealedProductId: 'sp-1' }));
    vi.spyOn(api, 'updateInventoryItem').mockRejectedValue(new ApiClientError(422, { code: 'PRICE_PENDING', message: 'x' }));
    renderWithProviders(<ItemDetailModal itemId="inv-1001" onClose={() => {}} locations={mockLocations} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Publicar' }));
    expect((await screen.findByRole('alert')).textContent).toContain(
      'No se publicó: el producto no tiene precio. Lo pone el dueño en «Precios del sellado».',
    );
  });

  it('422 SEALED_PRICE_IS_PER_PRODUCT ⇒ «del producto, no de la pieza» + enlace', async () => {
    vi.spyOn(api, 'getAdminInventoryItem').mockResolvedValue(sealed({ sealedProductId: 'sp-1' }));
    vi.spyOn(api, 'updateInventoryItem').mockRejectedValue(
      new ApiClientError(422, { code: 'SEALED_PRICE_IS_PER_PRODUCT', message: 'x' }),
    );
    renderWithProviders(<ItemDetailModal itemId="inv-1001" onClose={() => {}} locations={mockLocations} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Publicar' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('El precio del sellado es del producto, no de la pieza. No se guardó nada.');
    expect(within(alert).getByRole('link', { name: 'Ir a «Precios del sellado»' })).toBeInTheDocument();
  });

  it('sin producto + personal ⇒ sin input; «Sin producto: el precio de esta pieza lo pone el dueño.»', async () => {
    vi.spyOn(api, 'getAdminInventoryItem').mockResolvedValue(sealed({ sealedProductId: null }));
    renderWithProviders(<ItemDetailModal itemId="inv-1001" onClose={() => {}} locations={mockLocations} />);
    expect(await screen.findByText('Sin producto: el precio de esta pieza lo pone el dueño.')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Precio/)).toBeNull();
  });

  it('sin producto + dueño ⇒ input «Precio antes de IVA (MXN)» y el PATCH lleva listPriceCents', async () => {
    roleState.role = 'super_admin';
    vi.spyOn(api, 'getAdminInventoryItem').mockResolvedValue(sealed({ sealedProductId: null }));
    const patch = vi.spyOn(api, 'updateInventoryItem').mockResolvedValue({ ...mockInventory[0], status: 'listed' });
    renderWithProviders(<ItemDetailModal itemId="inv-1001" onClose={() => {}} locations={mockLocations} />);
    const input = await screen.findByLabelText('Precio antes de IVA (MXN)');
    const publish = screen.getByRole('button', { name: 'Publicar' });
    expect(publish).toBeDisabled();
    fireEvent.change(input, { target: { value: '1000' } });
    fireEvent.click(publish);
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch.mock.calls[0]![1]).toEqual({ status: 'listed', listPriceCents: 100000 });
  });
});
