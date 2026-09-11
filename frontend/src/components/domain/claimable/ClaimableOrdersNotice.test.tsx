import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { setStoredUser } from '@/lib/session';
import type { ClaimableOrderDTO, UserDTO } from '@/types/contract';
import { ClaimableOrdersNotice, CLAIMABLE_DISMISSED_KEY } from './ClaimableOrdersNotice';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const claimable = (n: number): ClaimableOrderDTO[] =>
  Array.from({ length: n }, (_, i) => ({
    orderId: `ord-g-${i + 1}`,
    orderNumber: `TCG-00010${i + 1}`,
    status: 'settled',
    totalCents: 168520 + i,
    itemCount: 1,
    createdAt: '2026-08-10T18:20:00Z',
  }));

function asCustomer(overrides: Partial<UserDTO> = {}) {
  setStoredUser({
    id: 'u-777',
    email: 'ash@example.com',
    name: 'Ash Ketchum',
    role: 'customer',
    locale: 'es',
    emailVerified: true,
    ...overrides,
  });
}

/** El aviso NO tiene nodo propio cuando no hay nada que ofrecer: se mide por `data-testid`. */
const notice = () => screen.queryByTestId('claimable-orders-notice');

beforeEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

/**
 * DESIGN_SYSTEM §33.9 · regla 4: «El aviso de pedidos reclamables nunca se pinta vacío ni en
 * error» — ni skeleton, ni banner de error, ni «Reintentar». Contrato v1.67 (nota de consumo de
 * `GET /orders/claimable`): `[]` ⇒ nada; `403 EMAIL_NOT_VERIFIED` ⇒ nada.
 */
describe('ClaimableOrdersNotice · cuándo NO se pinta (regla 4)', () => {
  it('con `[]` no hay nodo en el DOM (ni tarjeta vacía ni «no tienes pedidos»)', async () => {
    asCustomer();
    const spy = vi.spyOn(api, 'getClaimableOrders').mockResolvedValue([]);
    const { container } = renderWithProviders(<ClaimableOrdersNotice surface="vault" />, 'es');
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(notice()).toBeNull();
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(screen.queryByText(/pedido/i)).toBeNull();
  });

  it('con error (incluido 403 EMAIL_NOT_VERIFIED) no hay nodo ni «Reintentar»', async () => {
    asCustomer();
    const spy = vi
      .spyOn(api, 'getClaimableOrders')
      .mockRejectedValue(new ApiClientError(403, { code: 'EMAIL_NOT_VERIFIED', message: 'verify' }));
    const { container } = renderWithProviders(<ClaimableOrdersNotice surface="orders" />, 'es');
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(notice()).toBeNull();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(screen.queryByRole('button', { name: /reintentar/i })).toBeNull();
  });

  it('mientras carga tampoco pinta nada (sin skeleton)', () => {
    asCustomer();
    vi.spyOn(api, 'getClaimableOrders').mockReturnValue(new Promise(() => {}));
    const { container } = renderWithProviders(<ClaimableOrdersNotice surface="vault" />, 'es');
    expect(container.firstChild).toBeNull();
  });

  it('con correo SIN verificar no llama al endpoint (el banner de verificación ya está en pantalla)', async () => {
    asCustomer({ emailVerified: false });
    const spy = vi.spyOn(api, 'getClaimableOrders').mockResolvedValue(claimable(1));
    const { container } = renderWithProviders(<ClaimableOrdersNotice surface="vault" />, 'es');
    // Le damos un tick a react-query: no debe haber disparado la consulta.
    await new Promise((r) => setTimeout(r, 30));
    expect(spy).not.toHaveBeenCalled();
    expect(container.firstChild).toBeNull();
  });

  it('tras «Ahora no» desaparece y queda anotado en sessionStorage (vuelve en la siguiente sesión)', async () => {
    asCustomer();
    vi.spyOn(api, 'getClaimableOrders').mockResolvedValue(claimable(1));
    renderWithProviders(<ClaimableOrdersNotice surface="vault" />, 'es');
    await screen.findByTestId('claimable-orders-notice');

    fireEvent.click(screen.getByRole('button', { name: 'Ahora no' }));
    expect(notice()).toBeNull();
    expect(window.sessionStorage.getItem(CLAIMABLE_DISMISSED_KEY)).toBe('1');
  });

  it('con la marca de «Ahora no» en la sesión no se pinta ni se consulta', async () => {
    asCustomer();
    window.sessionStorage.setItem(CLAIMABLE_DISMISSED_KEY, '1');
    const spy = vi.spyOn(api, 'getClaimableOrders').mockResolvedValue(claimable(1));
    renderWithProviders(<ClaimableOrdersNotice surface="orders" />, 'es');
    await new Promise((r) => setTimeout(r, 30));
    expect(spy).not.toHaveBeenCalled();
    expect(notice()).toBeNull();
  });
});

describe('ClaimableOrdersNotice · aparece, reclama y desaparece (F7)', () => {
  it('con pedidos: banner `status` con título plural, cuerpo por superficie y filas con folio/fecha/total/estado', async () => {
    asCustomer();
    vi.spyOn(api, 'getClaimableOrders').mockResolvedValue(claimable(2));
    renderWithProviders(<ClaimableOrdersNotice surface="vault" />, 'es');

    const box = await screen.findByTestId('claimable-orders-notice');
    expect(box.querySelector('[role="status"]')).not.toBeNull();
    expect(screen.getByText('Tienes 2 pedidos hechos sin cuenta con este correo')).toBeInTheDocument();
    // Cuerpo de la BÓVEDA: dice que NO entran a la bóveda (regla 5); nunca «aparecerán en tu bóveda».
    expect(
      screen.getByText(
        'Se enviaron a tu domicilio, no a la bóveda. Al vincularlos aparecen en Compras y ventas con su seguimiento.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('TCG-000101')).toBeInTheDocument();
    expect(screen.getByText('TCG-000102')).toBeInTheDocument();
    expect(screen.getAllByText(/MX\$1,685\.2/).length).toBe(2);
    expect(screen.getByRole('button', { name: 'Vincular a mi cuenta' })).toBeInTheDocument();
  });

  it('en «Compras» el cuerpo es el de pedidos (sin mencionar la bóveda) y con >5 filas dice «y N más»', async () => {
    asCustomer();
    vi.spyOn(api, 'getClaimableOrders').mockResolvedValue(claimable(7));
    renderWithProviders(<ClaimableOrdersNotice surface="orders" />, 'es');

    await screen.findByTestId('claimable-orders-notice');
    expect(
      screen.getByText('Vincúlalos para ver su estado y su seguimiento aquí. No cambia nada del pedido.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/bóveda/)).toBeNull();
    expect(screen.getAllByText(/^TCG-0001/).length).toBe(5);
    expect(screen.getByText('y 2 más')).toBeInTheDocument();
  });

  it('«Vincular a mi cuenta» reclama TODOS los ids, el banner se sustituye por el éxito y no vuelve', async () => {
    asCustomer();
    const list = vi.spyOn(api, 'getClaimableOrders').mockResolvedValue(claimable(2));
    const claim = vi
      .spyOn(api, 'claimGuestOrders')
      .mockResolvedValue({ claimed: ['ord-g-1', 'ord-g-2'], failed: [] });
    renderWithProviders(<ClaimableOrdersNotice surface="vault" />, 'es');

    fireEvent.click(await screen.findByRole('button', { name: 'Vincular a mi cuenta' }));
    await waitFor(() => expect(claim).toHaveBeenCalledWith(['ord-g-1', 'ord-g-2']));

    // Éxito: mono verde + «Ver mis compras» (solo en bóveda) → /orders. El aviso ya no está.
    expect(await screen.findByText('PEDIDOS EN TU HISTORIAL')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver mis compras' })).toHaveAttribute('href', '/orders');
    expect(notice()).toBeNull();
    // Se invalidó la consulta: la siguiente viene vacía y el bloque de éxito persiste.
    list.mockResolvedValue([]);
    await waitFor(() => expect(list.mock.calls.length).toBeGreaterThan(1));
    expect(screen.getByText('PEDIDOS EN TU HISTORIAL')).toBeInTheDocument();
    expect(notice()).toBeNull();
  });

  it('fallo parcial: copy NEUTRO con el contacto, sin decir a quién pertenece', async () => {
    asCustomer();
    vi.spyOn(api, 'getClaimableOrders').mockResolvedValue(claimable(2));
    vi.spyOn(api, 'claimGuestOrders').mockResolvedValue({
      claimed: ['ord-g-1'],
      failed: [{ orderId: 'ord-g-2', code: 'CLAIM_EMAIL_MISMATCH' }],
    });
    renderWithProviders(<ClaimableOrdersNotice surface="orders" />, 'es');

    fireEvent.click(await screen.findByRole('button', { name: 'Vincular a mi cuenta' }));
    expect(await screen.findByText('PEDIDO EN TU HISTORIAL')).toBeInTheDocument();
    expect(
      screen.getByText(/No fue posible vincular 1 pedido\. Escríbenos a .+ citando el número de pedido\./),
    ).toBeInTheDocument();
    expect(screen.queryByText(/otra cuenta|pertenece/i)).toBeNull();
    // En «Compras» no hay enlace de éxito: la tabla se repinta sola.
    expect(screen.queryByRole('link', { name: 'Ver mis compras' })).toBeNull();
  });

  it('403 EMAIL_NOT_VERIFIED al reclamar → se sustituye por el aviso de verificación', async () => {
    asCustomer();
    vi.spyOn(api, 'getClaimableOrders').mockResolvedValue(claimable(1));
    vi.spyOn(api, 'claimGuestOrders').mockRejectedValue(
      new ApiClientError(403, { code: 'EMAIL_NOT_VERIFIED', message: 'verify' }),
    );
    renderWithProviders(<ClaimableOrdersNotice surface="vault" />, 'es');

    fireEvent.click(await screen.findByRole('button', { name: 'Vincular a mi cuenta' }));
    expect(await screen.findByText('Verifica tu correo para completar esta acción')).toBeInTheDocument();
    expect(notice()).toBeNull();
  });

  it('otro error al reclamar → banner danger inline (respuesta a una acción del usuario, §8.3)', async () => {
    asCustomer();
    vi.spyOn(api, 'getClaimableOrders').mockResolvedValue(claimable(1));
    vi.spyOn(api, 'claimGuestOrders').mockRejectedValue(
      new ApiClientError(500, { code: 'INTERNAL', message: 'boom' }),
    );
    renderWithProviders(<ClaimableOrdersNotice surface="vault" />, 'es');

    fireEvent.click(await screen.findByRole('button', { name: 'Vincular a mi cuenta' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudieron vincular los pedidos');
    // El aviso sigue (el usuario puede reintentar la acción).
    expect(notice()).not.toBeNull();
  });
});
