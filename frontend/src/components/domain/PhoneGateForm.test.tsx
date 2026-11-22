import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { PhoneGate } from './PhoneGateForm';
import * as api from '@/lib/api';
import { setStoredUser } from '@/lib/session';
import type { UserDTO } from '@/types/contract';

/**
 * §CELULAR · variante B (modal sobre la página). Candados: el visitante anónimo no ve nada; con sesión y sin celular
 * aparece el modal; al guardar se cierra SIN navegar y el carrito sigue; «Cerrar sesión» es la única salida.
 */
const replace = vi.fn();
const push = vi.fn();
let pathname = '/checkout';
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push, replace }),
  usePathname: () => pathname,
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

const USER: UserDTO = {
  id: 'u1',
  email: 'g@example.com',
  name: 'G',
  role: 'customer',
  locale: 'es',
  authProvider: 'google',
  phoneRequired: true,
};

beforeEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  replace.mockClear();
  pathname = '/checkout';
});

describe('PhoneGate — puerta del celular (modal B)', () => {
  it('visitante anónimo: sin modal', () => {
    renderWithProviders(<PhoneGate />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('con sesión y phoneRequired:false: sin modal', () => {
    setStoredUser({ ...USER, phone: '5512345678', phoneRequired: false });
    renderWithProviders(<PhoneGate />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('con sesión y sin celular: modal con título, foco en el campo y botón apagado', async () => {
    setStoredUser(USER);
    renderWithProviders(<PhoneGate />);
    const dialog = await screen.findByRole('dialog', { name: 'Completa tu celular' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const field = within(dialog).getByLabelText('Celular (10 dígitos)');
    expect(field).toHaveFocus();
    expect(within(dialog).getByRole('button', { name: 'Guardar y continuar' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Cerrar sesión' })).toBeInTheDocument();
    // Esc no lo cierra.
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('aplica también al personal del admin', async () => {
    pathname = '/admin';
    setStoredUser({ ...USER, role: 'super_admin' });
    renderWithProviders(<PhoneGate />);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('no estorba en /login ni con la contraseña temporal pendiente', () => {
    setStoredUser(USER);
    pathname = '/login';
    const { unmount } = renderWithProviders(<PhoneGate />);
    expect(screen.queryByRole('dialog')).toBeNull();
    unmount();
    pathname = '/checkout';
    setStoredUser({ ...USER, mustChangePassword: true });
    renderWithProviders(<PhoneGate />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('muestra el carrito conservado y al guardar el carrito sigue intacto', async () => {
    window.localStorage.setItem('tcg.cart', JSON.stringify({ version: 3, ids: ['a', 'b'], accessories: [], deckPulls: [] }));
    setStoredUser(USER);
    renderWithProviders(<PhoneGate />);
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(screen.getByTestId('phone-gate-cart')).toHaveTextContent(/\(2\)/));
    const before = window.localStorage.getItem('tcg.cart');
    fireEvent.change(within(dialog).getByLabelText('Celular (10 dígitos)'), { target: { value: '5512345678' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar y continuar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(window.localStorage.getItem('tcg.cart')).toBe(before);
  });

  it('pegar «+52 55-1234-5678» normaliza a 10 dígitos; guardar manda el normalizado, cierra y NO navega', async () => {
    setStoredUser(USER);
    const spy = vi.spyOn(api, 'updateMe');
    renderWithProviders(<PhoneGate />);
    const dialog = await screen.findByRole('dialog');
    const field = within(dialog).getByLabelText('Celular (10 dígitos)') as HTMLInputElement;
    fireEvent.change(field, { target: { value: '+52 55-1234-5678' } });
    expect(field.value).toBe('5512345678');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar y continuar' }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ phone: '5512345678' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(replace).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it('un celular falso (0000000000) no habilita guardar', async () => {
    setStoredUser(USER);
    renderWithProviders(<PhoneGate />);
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Celular (10 dígitos)'), { target: { value: '0000000000' } });
    expect(within(dialog).getByRole('button', { name: 'Guardar y continuar' })).toBeDisabled();
  });

  it('el servidor rechaza con PHONE_INVALID: error en línea y el modal sigue', async () => {
    setStoredUser(USER);
    const { ApiClientError } = await import('@/lib/api-client');
    vi.spyOn(api, 'updateMe').mockRejectedValueOnce(new ApiClientError(422, { code: 'PHONE_INVALID', message: 'x' }));
    renderWithProviders(<PhoneGate />);
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Celular (10 dígitos)'), { target: { value: '5512345678' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar y continuar' }));
    expect(await within(dialog).findByText('Escribe tu celular de 10 dígitos')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('error de red o 500 NO se dice como error de formato', async () => {
    setStoredUser(USER);
    const { ApiClientError } = await import('@/lib/api-client');
    vi.spyOn(api, 'updateMe').mockRejectedValueOnce(new ApiClientError(500, { code: 'INTERNAL', message: 'x' }));
    renderWithProviders(<PhoneGate />);
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Celular (10 dígitos)'), { target: { value: '5512345678' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar y continuar' }));
    expect(await within(dialog).findByText(/No se pudo guardar/)).toBeInTheDocument();
    expect(within(dialog).queryByText('Escribe tu celular de 10 dígitos')).toBeNull();
  });

  it.each([
    ['+52 55 1234 5678'],
    ['52 55 1234 5678'],
    ['+52 1 55 1234 5678'],
    ['+5215512345678'],
  ])('pegado «%s» queda en 5512345678', async (pasted) => {
    setStoredUser(USER);
    renderWithProviders(<PhoneGate />);
    const field = within(await screen.findByRole('dialog')).getByLabelText('Celular (10 dígitos)') as HTMLInputElement;
    fireEvent.change(field, { target: { value: pasted } });
    expect(field.value).toBe('5512345678');
  });

  it.each([['+52 55 1234 5678'], ['52 55 1234 5678'], ['+52 1 55 1234 5678']])('tecleado «%s» carácter a carácter queda en 5512345678', async (typed) => {
    setStoredUser(USER);
    renderWithProviders(<PhoneGate />);
    const field = within(await screen.findByRole('dialog')).getByLabelText('Celular (10 dígitos)') as HTMLInputElement;
    for (let i = 1; i <= typed.length; i++) {
      // El campo es controlado: cada tecla se añade al valor que muestra.
      fireEvent.change(field, { target: { value: field.value + typed[i - 1] } });
    }
    expect(field.value).toBe('5512345678');
  });

  it('letras se descartan: «ab5512345678» no se acepta como número con letras', async () => {
    setStoredUser(USER);
    renderWithProviders(<PhoneGate />);
    const field = within(await screen.findByRole('dialog')).getByLabelText('Celular (10 dígitos)') as HTMLInputElement;
    fireEvent.change(field, { target: { value: 'ab55' } });
    expect(field.value).toBe('55');
  });

  it('prellena con el celular de la dirección predeterminada', async () => {
    setStoredUser(USER);
    renderWithProviders(<PhoneGate />);
    const dialog = await screen.findByRole('dialog');
    const field = within(dialog).getByLabelText('Celular (10 dígitos)') as HTMLInputElement;
    await waitFor(() => expect(field.value).toBe('5555123456'));
  });

  it('«Cerrar sesión» cierra la sesión y vuelve al inicio', async () => {
    setStoredUser(USER);
    const spy = vi.spyOn(api, 'logout');
    renderWithProviders(<PhoneGate />);
    const dialog = await screen.findByRole('dialog');
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Cerrar sesión' }));
    });
    await waitFor(() => expect(spy).toHaveBeenCalled());
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'));
  });

  it('sesión vieja sin la bandera: relee GET /users/me una vez', async () => {
    const { phoneRequired: _p, ...old } = USER;
    void _p;
    setStoredUser(old);
    const spy = vi.spyOn(api, 'getMe');
    renderWithProviders(<PhoneGate />);
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
  });
});
