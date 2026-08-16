import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';

// Link de i18n → <a> plano para el render de prueba.
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

// Sesión ANÓNIMA (ready + no autenticado): es la rama que estrena la gráfica del set.
vi.mock('@/lib/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/session')>();
  return { ...actual, useSession: () => ({ user: null, isAuthenticated: false, ready: true }) };
});

import HomePage from './page';

describe('HomePage · panel anónimo (§7.18)', () => {
  it('la rama anónima encabeza el panel con la gráfica del set destacado y conserva 2 líneas de confianza + Entrar', async () => {
    renderWithProviders(<HomePage />, 'es');

    // La gráfica pública del set destacado aparece (etiqueta de mercado + nombre del set del mock).
    expect(await screen.findByText('Valor de mercado · Set destacado')).toBeInTheDocument();
    const setName = await screen.findByText('Surging Sparks');
    expect(setName).toHaveAttribute('lang', 'en');

    // Se podan a 2 líneas de confianza: custodia + precio real (se omite la de autenticación).
    expect(screen.getByText('Bóveda asegurada, sin envíos innecesarios')).toBeInTheDocument();
    expect(screen.getByText('Valor de mercado transparente en MXN')).toBeInTheDocument();
    expect(screen.queryByText('Cada carta se autentica al ingresar')).not.toBeInTheDocument();

    // El enlace de acceso (login, nav.login) permanece al pie.
    expect(screen.getByRole('link', { name: 'Iniciar sesión' })).toBeInTheDocument();
  });
});
