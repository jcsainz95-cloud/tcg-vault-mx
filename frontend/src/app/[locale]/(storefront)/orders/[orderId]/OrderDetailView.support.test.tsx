import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { OrderDetailView } from './OrderDetailView';
import * as api from '@/lib/api';
import { MOCK_DIRECT_SHIP_ORDER } from '@/lib/api';
import { setStoredUser } from '@/lib/session';
import { SUPPORT_CONTACT_FALLBACK } from '../../checkout/support-contact';
import type { OrderDetailDTO } from '@/types/contract';

/**
 * SC-2 = FE-DSC-2 (DESIGN_SYSTEM §60.1 b · contrato v1.82 §PNL.1): «¿Problema con tu pedido? Escríbenos»
 * solo en un pedido de envío directo con su envío ENTREGADO, y el correo es el del endpoint — ⛔ no el
 * respaldo. Canario: pintar `SUPPORT_CONTACT_FALLBACK` siempre ⇒ rojo.
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
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('') }));

beforeEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  setStoredUser({ id: 'u-777', email: 'ash@example.com', name: 'Ash Ketchum', role: 'customer', locale: 'es', emailVerified: true });
});

async function orderWith(patch: (o: OrderDetailDTO) => OrderDetailDTO) {
  const base = await api.getOrder(MOCK_DIRECT_SHIP_ORDER.id);
  const order = patch(structuredClone(base));
  vi.spyOn(api, 'getOrder').mockResolvedValue(order);
  return order;
}

describe('SC-2 · «Escríbenos» en el detalle del pedido (§60.1 b)', () => {
  it('directo ENTREGADO ⇒ sección con el correo de /support/contact (otro@x, no el respaldo) y el número en el asunto', async () => {
    const order = await orderWith((o) => ({
      ...o,
      fulfillmentMode: 'direct_ship',
      publicStatus: 'entregado',
      shipment: { ...o.shipment!, status: 'entregado' },
    }));
    vi.spyOn(api, 'getSupportContact').mockResolvedValue({ contact: 'otro@x' });
    renderWithProviders(<OrderDetailView orderId={order.id} />, 'es');
    const email = await screen.findByTestId('support-email');
    expect(email).toHaveTextContent('otro@x');
    expect(email).not.toHaveTextContent(SUPPORT_CONTACT_FALLBACK);
    const href = email.closest('a')!.getAttribute('href')!;
    expect(decodeURIComponent(href.split('subject=')[1])).toBe(`Problema con mi pedido ${order.orderNumber ?? order.id}`);
  });

  it('directo ENVIADO ⇒ sin sección', async () => {
    const order = await orderWith((o) => ({
      ...o,
      fulfillmentMode: 'direct_ship',
      publicStatus: 'enviado',
      shipment: { ...o.shipment!, status: 'enviado' },
    }));
    vi.spyOn(api, 'getSupportContact').mockResolvedValue({ contact: 'otro@x' });
    renderWithProviders(<OrderDetailView orderId={order.id} />, 'es');
    await screen.findByTestId('order-public-status');
    expect(screen.queryByTestId('support-contact')).not.toBeInTheDocument();
  });

  it('orden a BÓVEDA ⇒ sin sección (su entrega es el retiro)', async () => {
    const order = await orderWith((o) => ({ ...o, fulfillmentMode: 'vault', shipment: null }));
    vi.spyOn(api, 'getSupportContact').mockResolvedValue({ contact: 'otro@x' });
    renderWithProviders(<OrderDetailView orderId={order.id} />, 'es');
    await screen.findByTestId('order-public-status');
    expect(screen.queryByTestId('support-contact')).not.toBeInTheDocument();
  });

  it('mientras carga /support/contact: esqueleto y «Copiar correo» deshabilitado (⛔ no el respaldo); si falla, el respaldo', async () => {
    const order = await orderWith((o) => ({
      ...o,
      fulfillmentMode: 'direct_ship',
      shipment: { ...o.shipment!, status: 'entregado' },
    }));
    let reject!: (e: unknown) => void;
    vi.spyOn(api, 'getSupportContact').mockReturnValue(new Promise((_, r) => (reject = r)));
    renderWithProviders(<OrderDetailView orderId={order.id} />, 'es');
    await screen.findByTestId('support-contact');
    expect(screen.queryByTestId('support-email')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copiar correo' })).toBeDisabled();
    reject(new Error('network'));
    await waitFor(() => expect(screen.getByTestId('support-email')).toHaveTextContent(SUPPORT_CONTACT_FALLBACK));
  });
});
