import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { OrderDetailView } from './OrderDetailView';
import { OrdersView } from '../OrdersView';
import * as api from '@/lib/api';
import { MOCK_DIRECT_SHIP_ORDER } from '@/lib/api';
import { setStoredUser } from '@/lib/session';
import type { GuestOrderPublicStatus, OrderDetailDTO } from '@/types/contract';

/**
 * **El cliente registrado ve su envío** (`DESIGN_SYSTEM §37.12`, contrato `§M4-SHIP.16`, criterio 230).
 * Candado `PS-UI-1`: ni el `<h1>` del detalle ni la fila de la lista contienen «Liquidada» cuando viene
 * `publicStatus`; contienen el rótulo de `status.tracking.*` (el MISMO mapeo que el seguimiento del invitado).
 */

vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/orders',
  useRouter: () => ({ push: vi.fn() }),
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(''),
}));

beforeEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
  // Sesión de cliente verificada (las rutas son privadas; el gating lo hace el guard).
  setStoredUser({ id: 'u-777', email: 'ash@example.com', name: 'Ash Ketchum', role: 'customer', locale: 'es', emailVerified: true });
});

const LABELS: Record<GuestOrderPublicStatus, string> = {
  pendiente_pago: 'PAGO PENDIENTE',
  pagado: 'PAGADO',
  preparando: 'PREPARANDO',
  guia: 'GUÍA GENERADA',
  enviado: 'ENVIADO',
  entregado: 'ENTREGADO',
  cancelado: 'CANCELADO',
  reembolsado: 'REEMBOLSADO',
  en_revision: 'EN REVISIÓN',
};

describe('PS-UI-1 · nunca «Liquidada» al cliente', () => {
  for (const status of Object.keys(LABELS) as GuestOrderPublicStatus[]) {
    it(`publicStatus ${status} ⇒ el detalle pinta «${LABELS[status]}» y ⛔ no «Liquidada»`, async () => {
      const base = await api.getOrder(MOCK_DIRECT_SHIP_ORDER.id);
      const order: OrderDetailDTO = { ...base, status: 'settled', publicStatus: status, shipment: status === 'reembolsado' || status === 'cancelado' ? null : base.shipment };
      vi.spyOn(api, 'getOrder').mockResolvedValue(order);
      renderWithProviders(<OrderDetailView orderId={order.id} />, 'es');

      expect(await screen.findByTestId('order-public-status')).toHaveTextContent(LABELS[status]);
      expect(document.body.textContent).not.toMatch(/Liquidad[ao]/);
    });
  }

  it('la lista `/orders` titula cada fila con `publicStatus` y ⛔ no con «Liquidada»', async () => {
    renderWithProviders(<OrdersView />, 'es');
    // Tabla (≥ md) + tarjeta (< md): la fila se pinta dos veces; ninguna dice «Liquidada».
    const rows = await screen.findAllByTestId(`order-public-status-${MOCK_DIRECT_SHIP_ORDER.id}`);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row).toHaveTextContent('GUÍA GENERADA');
    expect(document.body.textContent).not.toMatch(/Liquidad[ao]/);
  });
});

describe('§37.12 · «Tu envío»', () => {
  it('paquetería, guía copiable, progreso, destino SIN calle ni teléfono, referencia y las cartas que no salieron', async () => {
    renderWithProviders(<OrderDetailView orderId={MOCK_DIRECT_SHIP_ORDER.id} />, 'es');

    const block = await screen.findByTestId('order-shipment');
    expect(block).toHaveTextContent('Paquetería: Estafeta');
    expect(within(block).getByTestId('order-tracking-number')).toHaveTextContent('Guía: EST-778899001');
    expect(within(block).getByRole('button', { name: 'Copiar guía' })).toBeInTheDocument();
    expect(within(block).getByTestId('order-ship-to')).toHaveTextContent('Para Ash Ketchum · Ciudad de México, CDMX · CP 03100');
    expect(block).not.toHaveTextContent(/Tel|Calle/);
    expect(block).toHaveTextContent('Referencia del envío: shp-7008');
    expect(within(block).getByTestId('order-shipment-missing')).toHaveTextContent('1 carta de este envío no salió; te devolvimos su dinero (ver abajo).');
    // Stepper con el paso actual = publicStatus (guia).
    const current = within(block).getByRole('listitem', { current: 'step' });
    expect(current).toHaveTextContent('GUÍA GENERADA');

    // La carta que no salió (§37.7): «No salió · te devolvimos MX$314.58» + motivo; y el encabezado parcial.
    expect(screen.getByTestId('item-refund')).toHaveTextContent('No salió · te devolvimos MX$314.58 · no la encontramos');
    expect(screen.getByTestId('order-refunded-partial')).toHaveTextContent('Te devolvimos MX$314.58 de este pedido.');
  });

  it('compra a bóveda: «En tu bóveda» + «Ver mi bóveda», ⛔ sin paquetería ni dirección', async () => {
    const base = await api.getOrder(MOCK_DIRECT_SHIP_ORDER.id);
    vi.spyOn(api, 'getOrder').mockResolvedValue({ ...base, fulfillmentMode: 'vault', publicStatus: 'entregado', shipment: null, items: base.items.map((i) => ({ ...i, refund: null })) });
    renderWithProviders(<OrderDetailView orderId={base.id} />, 'es');

    const block = await screen.findByTestId('order-shipment-vault');
    expect(block).toHaveTextContent('En tu bóveda');
    expect(within(block).getByRole('link', { name: 'Ver mi bóveda' })).toHaveAttribute('href', '/vault');
    expect(screen.queryByTestId('order-shipment')).not.toBeInTheDocument();
    expect(screen.queryByText(/Paquetería/)).not.toBeInTheDocument();
  });

  it('`en_revision` con envío cancelado: sin bloque propio, solo la línea de soporte; bóveda reembolsada ⇒ cada carta lo dice', async () => {
    const base = await api.getOrder(MOCK_DIRECT_SHIP_ORDER.id);
    vi.spyOn(api, 'getOrder').mockResolvedValue({ ...base, publicStatus: 'en_revision', shipment: { ...base.shipment!, status: 'cancelado' } });
    const { unmount } = renderWithProviders(<OrderDetailView orderId={base.id} />, 'es');
    expect(await screen.findByTestId('order-shipment-in-review')).toHaveTextContent('Estamos revisando este pedido.');
    expect(screen.queryByTestId('order-shipment')).not.toBeInTheDocument();
    unmount();

    vi.spyOn(api, 'getOrder').mockResolvedValue({ ...base, fulfillmentMode: 'vault', publicStatus: 'reembolsado', shipment: null, items: base.items.map((i) => ({ ...i, refund: null })) });
    renderWithProviders(<OrderDetailView orderId={base.id} />, 'es');
    const lines = await screen.findAllByTestId('item-origin-refunded');
    expect(lines.length).toBe(base.items.length);
    expect(lines[0]).toHaveTextContent('Ya no está en tu bóveda: este pedido se reembolsó.');
    expect(screen.queryByTestId('order-refunded-partial')).not.toBeInTheDocument();
  });
});
