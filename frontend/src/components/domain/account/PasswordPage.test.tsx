import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { setStoredUser, getStoredUser } from '@/lib/session';
import type { UserDTO } from '@/types/contract';
import { PasswordPage } from './PasswordPage';

const push = vi.fn();
const replace = vi.fn();
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push, replace }),
  usePathname: () => '/account/password',
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const getMe = vi.fn();
const changePassword = vi.fn();
const forgotPassword = vi.fn();
const logout = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/api', () => ({
  getMe: () => getMe(),
  changePassword: (...a: unknown[]) => changePassword(...a),
  forgotPassword: (...a: unknown[]) => forgotPassword(...a),
  logout: () => logout(),
}));

const base: UserDTO = {
  id: 'u-1',
  email: 'c@example.com',
  name: 'Cliente',
  role: 'customer',
  locale: 'es',
  authProvider: 'local',
  emailVerified: true,
  hasPassword: true,
  mustChangePassword: false,
  nameSource: 'user',
};

function fill(current: string, next: string, confirm: string, currentLabel = 'Contraseña actual') {
  fireEvent.change(screen.getByLabelText(currentLabel), { target: { value: current } });
  fireEvent.change(screen.getByLabelText('Contraseña nueva'), { target: { value: next } });
  fireEvent.change(screen.getByLabelText('Confirmar contraseña nueva'), { target: { value: confirm } });
}

/** DESIGN_SYSTEM §33.7 (cambiar / crear) y §33.8 (BLOQUEO por temporal) sobre la MISMA página. */
describe('PasswordPage · modos cambiar / crear / bloqueo', () => {
  beforeEach(() => {
    window.localStorage.clear();
    getMe.mockReset();
    changePassword.mockReset();
    forgotPassword.mockReset();
    push.mockClear();
    replace.mockClear();
    logout.mockClear();
  });

  it('modo cambiar (hasPassword=true): «← Mi cuenta», h1 «Cambiar contraseña», y al 200 sin next ofrece «Cambiar otra vez» (sin redirección)', async () => {
    setStoredUser(base);
    getMe.mockResolvedValue(base);
    changePassword.mockImplementation(async () => {
      // Espeja lo que hace `changePassword()` real antes de resolver.
      setStoredUser({ ...base, mustChangePassword: false, hasPassword: true });
      return { ok: true, accessToken: 'a2', refreshToken: 'r2' };
    });
    renderWithProviders(<PasswordPage surface="storefront" />, 'es');
    expect(await screen.findByRole('heading', { level: 1, name: 'Cambiar contraseña' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Mi cuenta/ })).toHaveAttribute('href', '/account');
    fill('actual-larga', 'nueva-larga', 'nueva-larga');
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar contraseña' }));
    expect(await screen.findByRole('status')).toHaveTextContent('CONTRASEÑA ACTUALIZADA');
    expect(screen.getByText('Cerramos la sesión en tus otros dispositivos. Esta sigue abierta.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cambiar otra vez' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Listo' })).not.toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it('modo crear (hasPassword=false): SIN campos; «Enviarme el enlace» llama a forgot-password con el correo de la sesión', async () => {
    const google = { ...base, authProvider: 'google' as const, hasPassword: false };
    setStoredUser(google);
    getMe.mockResolvedValue(google);
    forgotPassword.mockResolvedValue({ ok: true });
    renderWithProviders(<PasswordPage surface="storefront" />, 'es');
    expect(await screen.findByRole('heading', { level: 1, name: 'Crear contraseña' })).toBeInTheDocument();
    expect(screen.getByText(/te mandamos un enlace a c@example\.com/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Contraseña actual')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Contraseña nueva')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Enviarme el enlace' }));
    await waitFor(() => expect(forgotPassword).toHaveBeenCalledWith('c@example.com'));
    expect(await screen.findByText('ENLACE ENVIADO')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enviar otra vez' })).toBeInTheDocument();
    expect(changePassword).not.toHaveBeenCalled();
  });

  it('BLOQUEO (mustChangePassword=true, reason=required): banner con foco, h1 «Crea tu contraseña definitiva», campo «Contraseña temporal», sin «← Mi cuenta», sin «Continuar», con «Cerrar sesión»', async () => {
    const temp = { ...base, mustChangePassword: true };
    setStoredUser(temp);
    getMe.mockResolvedValue(temp);
    renderWithProviders(<PasswordPage surface="storefront" next="/vault" reason="required" />, 'es');
    expect(await screen.findByRole('heading', { level: 1, name: 'Crea tu contraseña definitiva' })).toBeInTheDocument();
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Antes de continuar tienes que cambiar tu contraseña temporal.');
    await waitFor(() => expect(alert.parentElement).toHaveFocus());
    expect(screen.getByText('Entraste con una contraseña temporal. Para continuar, elige una nueva.')).toBeInTheDocument();
    expect(screen.getByLabelText('Contraseña temporal')).toHaveAttribute('autocomplete', 'current-password');
    expect(screen.getByRole('button', { name: 'Guardar y continuar' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Mi cuenta/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continuar' })).not.toBeInTheDocument();
    expect(screen.queryByText(/más tarde/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cerrar sesión' })).toBeInTheDocument();
  });

  it('BLOQUEO sin reason: el foco inicial va al h1', async () => {
    const temp = { ...base, mustChangePassword: true };
    setStoredUser(temp);
    getMe.mockResolvedValue(temp);
    renderWithProviders(<PasswordPage surface="storefront" />, 'es');
    const h1 = await screen.findByRole('heading', { level: 1, name: 'Crea tu contraseña definitiva' });
    await waitFor(() => expect(h1).toHaveFocus());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('BLOQUEO → 200: la sesión queda con la bandera en false ANTES del botón «Listo», que recibe el foco y honra ?next', async () => {
    const temp = { ...base, mustChangePassword: true };
    setStoredUser(temp);
    getMe.mockResolvedValue(temp);
    changePassword.mockImplementation(async () => {
      setStoredUser({ ...temp, mustChangePassword: false, hasPassword: true });
      return { ok: true, accessToken: 'a2', refreshToken: 'r2' };
    });
    renderWithProviders(<PasswordPage surface="storefront" next="/vault?tab=retiros" />, 'es');
    await screen.findByLabelText('Contraseña temporal');
    fill('temporal-1', 'definitiva-9', 'definitiva-9', 'Contraseña temporal');
    fireEvent.click(screen.getByRole('button', { name: 'Guardar y continuar' }));
    const done = await screen.findByRole('button', { name: 'Listo' });
    expect(getStoredUser()?.mustChangePassword).toBe(false);
    await waitFor(() => expect(done).toHaveFocus());
    expect(screen.queryByRole('button', { name: 'Cambiar otra vez' })).not.toBeInTheDocument();
    fireEvent.click(done);
    expect(replace).toHaveBeenCalledWith('/vault?tab=retiros');
  });

  it('BLOQUEO → 200 sin next: «Listo» va a la cuenta del rol (staff → /admin/account)', async () => {
    const op = { ...base, role: 'vault_operator' as const, mustChangePassword: true };
    setStoredUser(op);
    getMe.mockResolvedValue(op);
    changePassword.mockImplementation(async () => {
      setStoredUser({ ...op, mustChangePassword: false });
      return { ok: true, accessToken: 'a2', refreshToken: 'r2' };
    });
    renderWithProviders(<PasswordPage surface="admin" />, 'es');
    await screen.findByLabelText('Contraseña temporal');
    fill('temporal-1', 'definitiva-9', 'definitiva-9', 'Contraseña temporal');
    fireEvent.click(screen.getByRole('button', { name: 'Guardar y continuar' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Listo' }));
    expect(replace).toHaveBeenCalledWith('/admin/account');
  });

  it('un ?next externo no se honra: «Listo» va a la cuenta', async () => {
    const temp = { ...base, mustChangePassword: true };
    setStoredUser(temp);
    getMe.mockResolvedValue(temp);
    changePassword.mockImplementation(async () => {
      setStoredUser({ ...temp, mustChangePassword: false });
      return { ok: true, accessToken: 'a2', refreshToken: 'r2' };
    });
    renderWithProviders(<PasswordPage surface="storefront" next="https://evil.example" />, 'es');
    await screen.findByLabelText('Contraseña temporal');
    fill('temporal-1', 'definitiva-9', 'definitiva-9', 'Contraseña temporal');
    fireEvent.click(screen.getByRole('button', { name: 'Guardar y continuar' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Listo' }));
    expect(replace).toHaveBeenCalledWith('/account');
  });

  it('BLOQUEO: «Cerrar sesión» es la única otra salida → logout + replace("/login")', async () => {
    const temp = { ...base, mustChangePassword: true };
    setStoredUser(temp);
    getMe.mockResolvedValue(temp);
    renderWithProviders(<PasswordPage surface="storefront" />, 'es');
    fireEvent.click(await screen.findByRole('button', { name: 'Cerrar sesión' }));
    await waitFor(() => expect(logout).toHaveBeenCalledTimes(1));
    expect(replace).toHaveBeenCalledWith('/login');
  });
});
