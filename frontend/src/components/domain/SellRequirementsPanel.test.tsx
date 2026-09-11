import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithIntl } from '@/test/render';
import type { SellRequirements } from '@/hooks/useSellRequirements';
import { SellRequirementsPanel } from './SellRequirementsPanel';

// next-intl `Link` acepta `href` objeto `{ pathname, query }`; el mock lo serializa como haría el router.
vi.mock('@/i18n/navigation', () => ({
  Link: ({
    href,
    children,
    ...props
  }: {
    href: string | { pathname: string; query?: Record<string, string> };
    children: React.ReactNode;
  }) => {
    const url =
      typeof href === 'string'
        ? href
        : `${href.pathname}${href.query ? `?${new URLSearchParams(href.query).toString()}` : ''}`;
    return (
      <a href={url} {...props}>
        {children}
      </a>
    );
  },
}));

const anonymous = {
  ready: true,
  isAuthenticated: false,
  emailBlocked: false,
  kycLoading: false,
} as unknown as SellRequirements;

/**
 * §33.11 / ARCHITECTURE §4.47.6 (P-55): los CTA de entrar/registrarse del flujo de venta llevan
 * `next=/buylist` para volver al cotizador con el carrito de venta rehidratado. Antes eran
 * `/login` y `/register` a secas y el vendedor aterrizaba en `/`.
 */
describe('SellRequirementsPanel · sin sesión, los CTA vuelven al cotizador', () => {
  it('«Iniciar sesión» → /login?next=/buylist y «Crear cuenta» → /register?next=/buylist', () => {
    renderWithIntl(<SellRequirementsPanel req={anonymous} />, 'es');
    const login = screen.getByRole('link', { name: 'Iniciar sesión' });
    expect(login).toHaveAttribute('href', '/login?next=%2Fbuylist');
    const register = screen.getByRole('link', { name: 'Crear cuenta' });
    expect(register).toHaveAttribute('href', '/register?next=%2Fbuylist');
  });
});
