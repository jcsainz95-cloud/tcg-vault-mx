import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { M6View } from './M6View';
import * as api from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { setStoredUser } from '@/lib/session';
import type { AdminUserDetailDTO, AdminUserSummaryDTO } from '@/types/contract';

/**
 * 🔒 PS-164 (pantalla, Usuarios) · `API_CONTRACT §M4-SHIP.19.30.2 (b)` y §19.30.3: la fila con `isOwner` no ofrece
 * restablecer / bloquear / borrar a un no dueño, y ni el propio dueño se bloquea ni se borra; el
 * `403 OWNER_ACCOUNT_PROTECTED` se pinta con su texto (el servidor autoriza; la pantalla solo oculta).
 */

vi.mock('@/lib/role', () => ({
  useRole: () => ({ role: 'super_admin', setRole: () => {}, isSuperAdmin: true, canSwitchRole: false }),
}));
vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/admin/m6',
  useRouter: () => ({ push: vi.fn() }),
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const OWNER: AdminUserSummaryDTO = {
  id: 'u-owner',
  email: 'dueno@tcghunt.mx',
  username: null,
  lockedUntil: null,
  name: 'Dueño',
  role: 'super_admin',
  status: 'active',
  createdAt: '2026-01-01T10:00:00Z',
  isOwner: true,
};
const OTHER: AdminUserSummaryDTO = { ...OWNER, id: 'u-sa2', email: 'otro@tcghunt.mx', name: 'Otro súper', isOwner: false };

beforeEach(() => {
  vi.restoreAllMocks();
});
afterEach(() => {
  setStoredUser(null);
});

async function openDetail(target: AdminUserSummaryDTO) {
  vi.spyOn(api, 'getAdminUsers').mockResolvedValue({ data: [target], page: 1, pageSize: 20, total: 1, lockState: 'ok' });
  vi.spyOn(api, 'getAdminUser').mockResolvedValue({ ...target, ownedItems: [] } as AdminUserDetailDTO);
  renderWithProviders(<M6View />, 'es');
  fireEvent.click((await screen.findAllByRole('button', { name: 'Ver ficha' }))[0]);
  return screen.findByTestId('m6-owner-account').catch(() => null);
}

describe('PS-164 · la cuenta del dueño en Usuarios', () => {
  it('un no dueño abre la ficha del dueño ⇒ sin «Restablecer contraseña», «Bloquear» ni «Eliminar usuario», con la frase', async () => {
    setStoredUser({ id: 'u-sa2', email: 'otro@tcghunt.mx', name: 'Otro súper', role: 'super_admin', locale: 'es' });
    const note = await openDetail(OWNER);
    expect(note).toHaveTextContent('Esta es la cuenta del dueño: no se restablece, bloquea ni borra desde otra cuenta.');
    expect(screen.queryByRole('button', { name: /Restablecer contraseña/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Bloquear' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Eliminar usuario/ })).not.toBeInTheDocument();
  });
  it('el dueño en su propia ficha ⇒ restablece su contraseña, pero ⛔ ni «Bloquear» ni «Eliminar usuario»', async () => {
    setStoredUser({ id: 'u-owner', email: 'dueno@tcghunt.mx', name: 'Dueño', role: 'super_admin', locale: 'es', isOwner: true });
    await openDetail(OWNER);
    expect(await screen.findByRole('button', { name: /Restablecer contraseña/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Bloquear' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Eliminar usuario/ })).not.toBeInTheDocument();
  });
  it('otra cuenta (no del dueño) ⇒ los tres botones de siempre y sin la frase', async () => {
    setStoredUser({ id: 'u-owner', email: 'dueno@tcghunt.mx', name: 'Dueño', role: 'super_admin', locale: 'es', isOwner: true });
    const note = await openDetail(OTHER);
    expect(note).toBeNull();
    expect(screen.getByRole('button', { name: /Restablecer contraseña/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bloquear' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Eliminar usuario/ })).toBeInTheDocument();
  });
  it('`403 OWNER_ACCOUNT_PROTECTED` (la marca cambió entre leer y pulsar) ⇒ su texto, ⛔ no el genérico', async () => {
    setStoredUser({ id: 'u-owner', email: 'dueno@tcghunt.mx', name: 'Dueño', role: 'super_admin', locale: 'es' });
    vi.spyOn(api, 'resetUserPassword').mockRejectedValue(new ApiClientError(403, { code: 'OWNER_ACCOUNT_PROTECTED', message: 'x' }));
    await openDetail(OTHER);
    fireEvent.click(screen.getByRole('button', { name: /Restablecer contraseña/ }));
    await waitFor(() => expect(screen.getByText('Esta es la cuenta del dueño: no se puede cambiar desde otra cuenta.')).toBeInTheDocument());
  });
});
