import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const replace = vi.fn();
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ replace, push: replace }), usePathname: () => '/', Link: 'a' }));
const login = vi.fn();
vi.mock('@/lib/api', () => ({ login: (...a: unknown[]) => login(...a), logout: vi.fn() }));

import { renderWithProviders } from '@/test/render';
import { SupplierLoginForm } from './SupplierLoginForm';
import { SupplierPasswordForm } from './SupplierPasswordForm';
import * as api from '@/lib/api/suppliers';

afterEach(() => {
  vi.restoreAllMocks();
  replace.mockClear();
  login.mockReset();
});

async function fillLogin() {
  await userEvent.type(screen.getByLabelText(/correo/i), 'a@b.mx');
  await userEvent.type(screen.getByLabelText(/contraseña/i), 'secreto123');
  await userEvent.click(screen.getByRole('button', { name: /^entrar$/i }));
}

describe('§PROV · acceso del proveedor', () => {
  it('IMP1: con contraseña temporal el login lleva a /proveedores/cambiar-contrasena (no a /account/password)', async () => {
    login.mockResolvedValue({ user: { role: 'supplier', mustChangePassword: true } });
    renderWithProviders(<SupplierLoginForm />);
    await fillLogin();
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/proveedores/cambiar-contrasena'));
  });

  it('sin temporal va al portal', async () => {
    login.mockResolvedValue({ user: { role: 'supplier', mustChangePassword: false } });
    renderWithProviders(<SupplierLoginForm />);
    await fillLogin();
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/proveedores'));
  });

  it('cuenta suspendida: texto claro', async () => {
    const { ApiClientError } = await import('@/lib/api-client');
    login.mockRejectedValue(new ApiClientError(403, { code: 'SUPPLIER_SUSPENDED', message: 'x' }));
    renderWithProviders(<SupplierLoginForm />);
    await fillLogin();
    expect(await screen.findByText(/está suspendida/i)).toBeTruthy();
  });

  it('IMP1: el cambio de contraseña usa POST /supplier/me/password', async () => {
    const change = vi.spyOn(api, 'changeSupplierPassword').mockResolvedValue(undefined);
    renderWithProviders(<SupplierPasswordForm />);
    await userEvent.type(screen.getByLabelText('Contraseña actual'), 'vieja1234');
    await userEvent.type(screen.getByLabelText('Contraseña nueva'), 'nueva12345');
    await userEvent.type(screen.getByLabelText('Repite la contraseña nueva'), 'nueva12345');
    await userEvent.click(screen.getByRole('button', { name: /guardar contraseña/i }));
    await waitFor(() => expect(change).toHaveBeenCalledWith({ currentPassword: 'vieja1234', newPassword: 'nueva12345' }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/proveedores/entrar?changed=1'));
  });
});

describe('§PROV · tras cambiar la contraseña', () => {
  it('204 revoca todas las sesiones: se limpia la sesión local y se va al login con aviso (sin llamar a /auth/logout)', async () => {
    const { setToken, setRefreshToken, getToken } = await import('@/lib/api-client');
    const { setStoredUser, getStoredUser } = await import('@/lib/session');
    setToken('t');
    setRefreshToken('r');
    setStoredUser({ id: 'u', role: 'supplier', mustChangePassword: true } as never);
    vi.spyOn(api, 'changeSupplierPassword').mockResolvedValue(undefined);
    renderWithProviders(<SupplierPasswordForm />);
    await userEvent.type(screen.getByLabelText('Contraseña actual'), 'vieja1234');
    await userEvent.type(screen.getByLabelText('Contraseña nueva'), 'nueva12345');
    await userEvent.type(screen.getByLabelText('Repite la contraseña nueva'), 'nueva12345');
    await userEvent.click(screen.getByRole('button', { name: /guardar contraseña/i }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/proveedores/entrar?changed=1'));
    expect(getToken()).toBeNull();
    expect(getStoredUser()).toBeNull();
  });

  it('el login muestra «contraseña cambiada, entra de nuevo»', () => {
    renderWithProviders(<SupplierLoginForm passwordChanged />);
    expect(screen.getByRole('status').textContent).toMatch(/Contraseña cambiada.*entra de nuevo/);
  });
});
