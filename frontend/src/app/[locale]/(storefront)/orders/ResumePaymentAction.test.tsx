import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import { mockOrderDetail } from '@/lib/mock/fixtures';
import { ResumePaymentAction } from './ResumePaymentAction';

const { routerPush } = vi.hoisted(() => ({ routerPush: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
  useRouter: () => ({ push: routerPush, replace: vi.fn() }),
}));

/**
 * Contrato v1.68 §4-R.5 — «Reanudar pago»: un pedido `pending` con `reservedUntil` futuro sigue
 * siendo del cliente; el front carga `items[].inventoryItemId` al carrito y vuelve a `/checkout`,
 * donde la session responde `200 reused`. **Sin endpoint de reanudar.** Y sin `reservedUntil` del
 * servidor NO se ofrece: no se promete una reserva que no consta.
 */
const IN_20_MIN = () => new Date(Date.now() + 20 * 60_000).toISOString();

function storedIds(): string[] {
  const raw = window.localStorage.getItem('tcg.cart');
  return raw ? JSON.parse(raw).ids : [];
}

beforeEach(() => {
  vi.restoreAllMocks();
  routerPush.mockReset();
  window.localStorage.clear();
});

describe('ResumePaymentAction · «Reanudar pago» (§4-R.5)', () => {
  it('pending + reservedUntil futuro: «Reservado hasta las HH:MM» y el botón', () => {
    renderWithProviders(<ResumePaymentAction order={{ id: 'ord-9002', status: 'pending', reservedUntil: IN_20_MIN() }} />, 'es');
    expect(screen.getByTestId('resume-payment')).toHaveTextContent(/Reservado hasta las \d{1,2}:\d{2}/);
    expect(screen.getByRole('button', { name: 'Reanudar pago' })).toBeInTheDocument();
  });

  it('el clic carga las piezas del pedido (GET /orders/:id) SUSTITUYENDO el carrito y va a /checkout', async () => {
    const usr = userEvent.setup();
    window.localStorage.setItem('tcg.cart', JSON.stringify({ ids: ['inv-otra'], updatedAt: Date.now() }));
    const spy = vi.spyOn(api, 'getOrder').mockResolvedValue({
      ...mockOrderDetail,
      id: 'ord-9002',
      status: 'pending',
      items: [
        { ...mockOrderDetail.items[0], inventoryItemId: 'inv-1002' },
        { ...mockOrderDetail.items[0], inventoryItemId: 'inv-1001' },
      ],
    });
    renderWithProviders(<ResumePaymentAction order={{ id: 'ord-9002', status: 'pending', reservedUntil: IN_20_MIN() }} />, 'es');

    await usr.click(screen.getByRole('button', { name: 'Reanudar pago' }));

    await waitFor(() => expect(routerPush).toHaveBeenCalledWith('/checkout'));
    expect(spy).toHaveBeenCalledWith('ord-9002');
    // Conjunto EXACTO del pedido (el reuso exige igualdad de conjuntos): la pieza ajena se fue.
    expect(storedIds()).toEqual(['inv-1002', 'inv-1001']);
  });

  it('reservedUntil YA pasado (v1.68.1, propia VENCIDA): dice que venció y SIGUE ofreciendo reanudar (la sesión sustituye)', async () => {
    const usr = userEvent.setup();
    vi.spyOn(api, 'getOrder').mockResolvedValue({ ...mockOrderDetail, id: 'ord-9002', status: 'pending' });
    renderWithProviders(
      <ResumePaymentAction order={{ id: 'ord-9002', status: 'pending', reservedUntil: new Date(Date.now() - 1000).toISOString() }} />,
      'es',
    );
    expect(screen.getByTestId('resume-expired')).toHaveTextContent('La reserva venció: al reanudar se renovará');
    await usr.click(screen.getByRole('button', { name: 'Reanudar pago' }));
    await waitFor(() => expect(routerPush).toHaveBeenCalledWith('/checkout'));
  });

  it('sin reservedUntil (backend anterior a v1.68) o no `pending`: no pinta nada', () => {
    const { container } = renderWithProviders(<ResumePaymentAction order={{ id: 'a', status: 'pending' }} />, 'es');
    expect(container).toBeEmptyDOMElement();
    const settled = renderWithProviders(<ResumePaymentAction order={{ id: 'b', status: 'settled', reservedUntil: IN_20_MIN() }} />, 'es');
    expect(settled.container).toBeEmptyDOMElement();
  });

  it('si GET /orders/:id falla: mensaje de error, sin navegar y sin tocar el carrito', async () => {
    const usr = userEvent.setup();
    window.localStorage.setItem('tcg.cart', JSON.stringify({ ids: ['inv-otra'], updatedAt: Date.now() }));
    vi.spyOn(api, 'getOrder').mockRejectedValue(new Error('boom'));
    renderWithProviders(<ResumePaymentAction order={{ id: 'ord-9002', status: 'pending', reservedUntil: IN_20_MIN() }} />, 'es');

    await usr.click(screen.getByRole('button', { name: 'Reanudar pago' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos recuperar las piezas de este pedido.');
    expect(routerPush).not.toHaveBeenCalled();
    expect(storedIds()).toEqual(['inv-otra']);
  });
});
