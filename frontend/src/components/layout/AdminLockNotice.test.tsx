import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { AdminShell } from './AdminShell';
import { setStoredUser } from '@/lib/session';
import { formatDateTimeMx } from '@/lib/format';
import { ApiClientError } from '@/lib/api-client';
import type { UserDTO } from '@/types/contract';

/**
 * **UX-11 · aviso de candado en el panel** (`API_CONTRACT §M6-U.5`, `DESIGN_SYSTEM §42.6`, criterio 265). Se mide
 * a través de `AdminShell` (donde vive): con `lockNotice` ⇒ aviso `role="status"`; «Entendido» ⇒ UN
 * `POST …/dismiss`; `204` ⇒ desaparece y el foco pasa al `<main>`; error ⇒ se queda con `dismissError`; con
 * `mustChangePassword` ⇒ ni aviso ni llamada. Canarios: cierre optimista; pintar con temporal pendiente.
 */

vi.mock('@/lib/config', () => ({ config: { useMocks: false, apiBaseUrl: '', googleClientId: '' } }));

const replace = vi.fn();
let currentPath = '/admin';
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('') }));
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  usePathname: () => currentPath,
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const getMe = vi.fn();
const dismissLockNotice = vi.fn();
vi.mock('@/lib/api', () => ({
  logout: () => Promise.resolve(),
  getPickingListSummary: () => Promise.reject(new Error('no backend')),
  getMe: () => getMe(),
  dismissLockNotice: () => dismissLockNotice(),
}));

const SINCE = '2026-10-04T15:30:00.000Z';
const ana: UserDTO = { id: 'u-ana', email: null, username: 'ana', name: 'Ana', role: 'vault_operator', locale: 'es' };

beforeEach(() => {
  replace.mockClear();
  getMe.mockReset();
  dismissLockNotice.mockReset();
  window.localStorage.clear();
  setStoredUser(null);
  currentPath = '/admin';
});

describe('UX-11 · aviso de candado en el panel', () => {
  it('con `lockNotice` pinta el aviso (status, no alert) con la fecha y el enlace a cambiar contraseña', async () => {
    setStoredUser({ ...ana, mustChangePassword: false });
    getMe.mockResolvedValue({ ...ana, mustChangePassword: false, lockNotice: { since: SINCE } });
    renderWithProviders(<AdminShell>panel</AdminShell>, 'es');

    const box = await screen.findByTestId('admin-lock-notice');
    const banner = box.querySelector('[role]')!;
    expect(banner).toHaveAttribute('role', 'status');
    expect(box).toHaveTextContent('Hubo varios intentos fallidos de entrar a tu cuenta');
    expect(box).toHaveTextContent(`Fue el ${formatDateTimeMx(SINCE, 'es')}.`);
    expect(screen.getByRole('link', { name: 'Cambiar contraseña' })).toHaveAttribute('href', '/admin/account/password');
    // Va ANTES del contenido de la pantalla, dentro del <main>.
    const main = screen.getByRole('main');
    expect(main.firstElementChild).toBe(box);
    expect(screen.getByText('panel')).toBeInTheDocument();
  });

  it('«Entendido» ⇒ UNA llamada a dismiss; el 204 lo quita y el foco va al <main>', async () => {
    setStoredUser({ ...ana, mustChangePassword: false });
    getMe.mockResolvedValue({ ...ana, mustChangePassword: false, lockNotice: { since: SINCE } });
    let resolve!: () => void;
    dismissLockNotice.mockImplementation(() => new Promise<void>((r) => (resolve = r)));
    renderWithProviders(<AdminShell>panel</AdminShell>, 'es');

    fireEvent.click(await screen.findByRole('button', { name: 'Entendido' }));
    await waitFor(() => expect(dismissLockNotice).toHaveBeenCalledTimes(1));
    // ⛔ Sin cierre optimista: mientras el servidor no contesta, el aviso sigue.
    expect(screen.getByTestId('admin-lock-notice')).toBeInTheDocument();
    resolve();
    await waitFor(() => expect(screen.queryByTestId('admin-lock-notice')).not.toBeInTheDocument());
    expect(screen.getByRole('main')).toHaveFocus();
    expect(dismissLockNotice).toHaveBeenCalledTimes(1);
  });

  it('si el dismiss falla, el aviso SE QUEDA y dice que no se pudo cerrar', async () => {
    setStoredUser({ ...ana, mustChangePassword: false });
    getMe.mockResolvedValue({ ...ana, mustChangePassword: false, lockNotice: { since: SINCE } });
    dismissLockNotice.mockRejectedValue(new ApiClientError(500, { code: 'INTERNAL', message: 'x' }));
    renderWithProviders(<AdminShell>panel</AdminShell>, 'es');

    fireEvent.click(await screen.findByRole('button', { name: 'Entendido' }));
    expect(await screen.findByText('No pudimos cerrar el aviso. Intenta de nuevo.')).toBeInTheDocument();
    expect(screen.getByTestId('admin-lock-notice')).toHaveTextContent('Hubo varios intentos fallidos');
  });

  it('sin `lockNotice` no se pinta nada', async () => {
    setStoredUser({ ...ana, mustChangePassword: false });
    getMe.mockResolvedValue({ ...ana, mustChangePassword: false, lockNotice: null });
    renderWithProviders(<AdminShell>panel</AdminShell>, 'es');
    await screen.findByText('panel');
    await waitFor(() => expect(getMe).toHaveBeenCalled());
    expect(screen.queryByTestId('admin-lock-notice')).not.toBeInTheDocument();
  });

  it('con contraseña temporal pendiente: ni consulta ni aviso ni dismiss (no está en la allowlist)', async () => {
    currentPath = '/admin/account/password';
    setStoredUser({ ...ana, mustChangePassword: true });
    getMe.mockResolvedValue({ ...ana, mustChangePassword: true, lockNotice: { since: SINCE } });
    renderWithProviders(<AdminShell>panel</AdminShell>, 'es');
    expect(await screen.findByText('panel')).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    expect(getMe).not.toHaveBeenCalled();
    expect(screen.queryByTestId('admin-lock-notice')).not.toBeInTheDocument();
    expect(dismissLockNotice).not.toHaveBeenCalled();
  });

  it('aunque la sesión local vaya atrasada, si `/users/me` dice `mustChangePassword` no se pinta', async () => {
    setStoredUser({ ...ana, mustChangePassword: false });
    getMe.mockResolvedValue({ ...ana, mustChangePassword: true, lockNotice: { since: SINCE } });
    renderWithProviders(<AdminShell>panel</AdminShell>, 'es');
    await waitFor(() => expect(getMe).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId('admin-lock-notice')).not.toBeInTheDocument();
  });
});
