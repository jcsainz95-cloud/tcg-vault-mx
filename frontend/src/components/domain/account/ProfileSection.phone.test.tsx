import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { ProfileSection } from './ProfileSection';
import * as api from '@/lib/api';
import { setStoredUser } from '@/lib/session';
import type { UserDTO } from '@/types/contract';

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/account',
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

const USER: UserDTO = {
  id: 'u1',
  email: 'a@b.mx',
  name: 'Ash',
  phone: '5512345678',
  role: 'customer',
  locale: 'es',
  nameSource: 'user',
  phoneRequired: false,
};

beforeEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  setStoredUser(USER);
});

describe('ProfileSection — celular de Mi cuenta (§CELULAR)', () => {
  it('no recorta lo pegado (sin maxLength) y lo normaliza al guardar', async () => {
    const spy = vi.spyOn(api, 'updateMe');
    renderWithProviders(<ProfileSection user={USER} />, 'es');
    const field = screen.getByLabelText('Celular') as HTMLInputElement;
    expect(field.maxLength).toBe(-1);
    fireEvent.change(field, { target: { value: '+52 55 8765 4321' } });
    expect(field.value).toBe('+52 55 8765 4321');
    fireEvent.click(screen.getByRole('button', { name: /Guardar/ }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ phone: '5587654321' }));
  });

  it('no deja vaciar el celular: muestra el error y no llama al servidor', async () => {
    const spy = vi.spyOn(api, 'updateMe');
    renderWithProviders(<ProfileSection user={USER} />, 'es');
    fireEvent.change(screen.getByLabelText('Celular'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /Guardar/ }));
    expect(await screen.findByText('Escribe un celular de 10 dígitos.')).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });

  it('PHONE_INVALID del servidor se pinta en el campo', async () => {
    const { ApiClientError } = await import('@/lib/api-client');
    vi.spyOn(api, 'updateMe').mockRejectedValueOnce(
      new ApiClientError(422, { code: 'PHONE_INVALID', message: 'x', details: { field: 'phone' } }),
    );
    renderWithProviders(<ProfileSection user={USER} />, 'es');
    fireEvent.change(screen.getByLabelText('Celular'), { target: { value: '5587654321' } });
    fireEvent.click(screen.getByRole('button', { name: /Guardar/ }));
    expect(await screen.findByText('Escribe un celular de 10 dígitos.')).toBeInTheDocument();
  });
});
