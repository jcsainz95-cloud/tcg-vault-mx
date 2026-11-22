import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import M6Page from './page';

/** §FICHA-CLIENTE.13 (qa B-1): monta la PÁGINA (con su guarda) con rol operador, no solo la vista. */
vi.mock('@/lib/role', () => ({
  useRole: () => ({ role: 'vault_operator', setRole: () => {}, isSuperAdmin: false, canSwitchRole: false }),
}));
vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/admin/m6',
  useRouter: () => ({ push: vi.fn() }),
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

describe('M6 · página con rol operador', () => {
  it('abre la lista y la ficha, sin acciones de gestión', async () => {
    renderWithProviders(<M6Page />, 'es');
    expect(screen.queryByText(/solo súper-admin|Acceso restringido/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Crear usuario' })).not.toBeInTheDocument();
    fireEvent.click((await screen.findAllByRole('button', { name: 'Ver ficha' }))[0]);
    const dialog = await screen.findByRole('dialog', { name: /Ficha 360/ });
    expect(await within(dialog).findByTestId('strip-purchases')).toBeInTheDocument();
    for (const name of ['Bloquear', 'Reactivar', 'Restablecer contraseña', 'Eliminar usuario', 'Guardar KYC', 'Revisar identidad']) {
      expect(within(dialog).queryByRole('button', { name })).not.toBeInTheDocument();
    }
    expect(within(dialog).queryByLabelText('Tope mensual')).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('link', { name: 'Revisar identidad' })).not.toBeInTheDocument();
    expect(within(dialog).getByTestId('phone-field')).toBeInTheDocument();
    expect(within(within(dialog).getByTestId('phone-field')).queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument();
  });
});
