import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { PreparationQueue } from './PreparationQueue';
import * as api from '@/lib/api';
import type { ShipPreparationItemDTO, ShipPreparationOrderDTO, ShipPreparationStateDTO } from '@/types/contract';

/**
 * «Pedidos por preparar» en el celular (DESIGN_SYSTEM §60.9 · HECHOS 2026-10-05 (1)). Lo que se puede afirmar sin
 * navegador: las clases que el CSS usa para decidir (⛔ sin JS de dispositivo) y la conducta del visor de foto y de
 * la dirección plegada. Lo que necesita un ancho real (desborde, alto de 44 px medido, pie pegajoso a la vista) lo
 * mide `e2e/m4-mobile.spec.ts` (MOB-1…5) a 360 y 390 px.
 */
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}));

beforeEach(() => vi.restoreAllMocks());

function counts(items: ShipPreparationItemDTO[]) {
  const c = {
    total: items.length,
    pending: 0,
    picked: 0,
    missing: 0,
    blocked: 0,
  };
  for (const i of items) {
    if (i.availability.kind === 'blocked') c.blocked += 1;
    else c[i.prepStatus] += 1;
  }
  return c;
}

function prep(
  items: ShipPreparationItemDTO[],
  refundPreviewCents: number,
  prepared = false,
  openReplacements = 0,
): ShipPreparationStateDTO {
  return prepared
    ? {
        status: 'prepared',
        preparedAt: '2026-09-28T17:20:00Z',
        preparedBy: { userId: 'u-op1', name: 'Operador' },
        openReplacements,
        ...counts(items),
      }
    : { status: 'in_progress', refundPreviewCents, ...counts(items) };
}

const item = (id: string, over: Partial<ShipPreparationItemDTO> = {}): ShipPreparationItemDTO => ({
  shipmentItemId: `sit-${id}`,
  inventoryItemId: `inv-${id}`,
  folio: `INV-${id}`,
  quantity: 1,
  card: {
    name: `Carta ${id}`,
    setName: 'Base Set',
    finish: 'holofoil',
    conditionLabel: 'NM',
    imageSmallUrl: null,
  },
  currentLocation: { kind: 'assigned', label: 'C01-F01-S01' },
  prepStatus: 'pending',
  missingReason: null,
  prepMarkedBy: null,
  availability: { kind: 'available' },
  refund: { kind: 'refundable', amountCents: 31458 },
  ...over,
});

function shipOrder(
  items: ShipPreparationItemDTO[],
  over: Partial<ShipPreparationOrderDTO> & {
    refundPreviewCents?: number;
    prepared?: boolean;
    openReplacements?: number;
  } = {},
): ShipPreparationOrderDTO {
  const { refundPreviewCents = 0, prepared = false, openReplacements = 0, ...rest } = over;
  return {
    destination: 'ship',
    shipmentId: 'shp-1',
    kind: 'guest_direct_ship',
    orderId: 'ord-1',
    orderNumber: 'TCG-000123',
    requestedAt: '2026-09-20T10:00:00Z',
    customer: {
      userId: 'u-1',
      email: 'ash@example.com',
      lastName: 'Ketchum',
      fullName: 'Ash Ketchum',
    },
    preparation: prep(items, refundPreviewCents, prepared, openReplacements),
    shipTo: {
      recipientName: 'Ash Ketchum',
      line1: 'Calle 1',
      city: 'CDMX',
      state: 'CDMX',
      postalCode: '01000',
      country: 'MX',
      phone: '5550000000',
    },
    items,
    ...rest,
  };
}

/** La cola «del servidor»: el espía lee SIEMPRE el estado actual, así una prueba lo cambia tras un verbo. */
function serve(order: ShipPreparationOrderDTO | null) {
  const state = { order };
  vi.spyOn(api, 'getAdminPreparationQueue').mockImplementation(async ({ destination } = {}) =>
    state.order && (!destination || destination === 'ship') ? [state.order] : [],
  );
  return state;
}

const card = () => screen.findByTestId('prep-order-shp-1');

describe('MOB-2 (fuente) · ningún `sm:min-h-[44px]` en las tarjetas de preparar', () => {
  // `sm:min-h-[44px]` garantiza 44 px SOLO por ENCIMA de 640 px — al revés de lo que el celular necesita (§60.9 c).
  it.each(['ShipPreparationCard.tsx', 'VaultPlacementCard.tsx', 'prep-shared.tsx'])('%s', (file) => {
    const text = readFileSync(resolve(__dirname, file), 'utf8');
    expect(text).not.toMatch(/sm:min-h-\[44px\]/);
  });
});

describe('MOB-4 · la foto se amplía con un toque', () => {
  it('con `imageSmallUrl`: «Ver foto de …» abre el visor; «Cerrar» y Esc lo cierran', async () => {
    serve(shipOrder([item('a', { card: { name: 'Charizard', setName: 'Base Set', finish: 'holofoil', conditionLabel: 'NM', imageSmallUrl: 'https://images.pokemontcg.io/base1/4.png' } })]));
    renderWithProviders(<PreparationQueue onCaptureGuide={() => {}} />, 'es');
    const c = await card();
    fireEvent.click(within(c).getByRole('button', { name: 'Ver foto de Charizard' }));
    const viewer = await screen.findByRole('dialog', { name: 'Charizard' });
    expect(within(viewer).getByTestId('prep-photo-viewer')).toHaveTextContent('INV-a');
    fireEvent.click(within(viewer).getByRole('button', { name: 'Cerrar' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Charizard' })).not.toBeInTheDocument());
    fireEvent.click(within(c).getByRole('button', { name: 'Ver foto de Charizard' }));
    await screen.findByRole('dialog', { name: 'Charizard' });
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Charizard' })).not.toBeInTheDocument());
  });

  it('sin `imageSmallUrl`: pozo de papel y SIN disparador', async () => {
    serve(shipOrder([item('a')]));
    renderWithProviders(<PreparationQueue onCaptureGuide={() => {}} />, 'es');
    const c = await card();
    expect(within(c).queryByRole('button', { name: /Ver foto de/ })).not.toBeInTheDocument();
  });
});

describe('§60.9 b · la dirección plegada en el paso 1 (solo bajo `sm`, por CSS)', () => {
  it('paso 1: «Dirección de envío» (sm:hidden) la despliega; el bloque lleva `hidden sm:flex` hasta abrirla', async () => {
    serve(shipOrder([item('a')]));
    renderWithProviders(<PreparationQueue onCaptureGuide={() => {}} />, 'es');
    const c = await card();
    const toggle = within(c).getByTestId('prep-address-toggle-shp-1');
    expect(toggle).toHaveClass('sm:hidden');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    const addr = within(c).getByTestId('prep-address-shp-1');
    expect(addr).toHaveClass('hidden', 'sm:flex');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(addr).not.toHaveClass('hidden');
  });

  it('paso 2 (preparado): la dirección ABIERTA y sin el plegador', async () => {
    serve(shipOrder([item('a', { prepStatus: 'picked' })], { prepared: true }));
    renderWithProviders(<PreparationQueue onCaptureGuide={() => {}} />, 'es');
    const c = await card();
    expect(within(c).queryByTestId('prep-address-toggle-shp-1')).not.toBeInTheDocument();
    expect(within(c).getByTestId('prep-address-shp-1')).not.toHaveClass('hidden');
  });
});

describe('§60.9 c/d · ubicación grande y pie pegajoso bajo `sm`', () => {
  it('la ubicación es mono 17 px tinta en `< sm`; el pie es `sticky bottom-0` y vuelve a `static` en `sm`', async () => {
    serve(shipOrder([item('a')]));
    renderWithProviders(<PreparationQueue onCaptureGuide={() => {}} />, 'es');
    const c = await card();
    const loc = within(within(c).getByTestId('prep-location-sit-a')).getByText('C01-F01-S01');
    expect(loc).toHaveClass('font-mono', 'text-[17px]', 'font-semibold', 'text-text');
    const footer = within(c).getByTestId('ship-footer-shp-1');
    expect(footer).toHaveClass('sticky', 'bottom-0', 'sm:static');
  });
});
