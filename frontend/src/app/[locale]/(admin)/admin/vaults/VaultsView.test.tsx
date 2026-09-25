import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { VaultsView } from './VaultsView';
import * as api from '@/lib/api';

// `@/i18n/navigation` (next-intl) no resuelve bajo vitest; se stubea a un <a> que preserva href.
// Lo necesita el enlace del guardarraíl («Ver en la cola de pendientes») de la consola de precios.
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}));


beforeEach(() => {
  vi.restoreAllMocks();
});

describe('Admin · Bóvedas de clientes (GET /admin/vaults, v1.20)', () => {
  it('lista clientes con piezas y valor estimado (orden default value_desc)', async () => {
    const spy = vi.spyOn(api, 'getAdminVaults');
    renderWithProviders(<VaultsView />, 'es');

    // Ana (mockHoldings: 128000+950000+320000 = MX$13,980.00; Zapdos pendiente NO suma).
    expect(await screen.findByText('Ana López')).toBeInTheDocument();
    expect(screen.getByText('ana@example.com')).toBeInTheDocument();
    expect(screen.getByText('4 piezas')).toBeInTheDocument();
    expect(screen.getByText(/13,980\.00/)).toBeInTheDocument();
    // Bruno (bóveda chica) después por valor.
    expect(screen.getByText('Bruno Díaz')).toBeInTheDocument();
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ sort: 'value_desc', page: 1 }));

    // value_desc: Ana (mayor valor) antes que Bruno.
    const names = screen.getAllByRole('link', { name: /Ver bóveda/ }).map((b) => b.textContent);
    expect(names[0]).toContain('Ana López');
  });

  it('cada cliente es un ENLACE a su detalle con URL propia (H-6), ya no un estado local', async () => {
    renderWithProviders(<VaultsView />, 'es');

    const link = await screen.findByRole('link', { name: /Ver bóveda · Ana López/ });
    expect(link).toHaveAttribute('href', '/admin/vaults/u-777');
  });

  /**
   * ⭐ **Prueba 29 del contrato (§M4-VAULT.8, H-1 frontend).** Una fila con `name: null` (cuenta con
   * nombre fabricado del correo) pinta la AUSENCIA CON NOMBRE + el correo, también en el nombre
   * accesible del enlace; ⛔ ningún nodo de texto igual a `email.split('@')[0]`.
   */
  it('H-1 · fila con `name: null`: «Sin nombre registrado» + correo (también en el `aria-label`), ⛔ nunca el prefijo del correo', async () => {
    vi.spyOn(api, 'getAdminVaults').mockResolvedValue({
      data: [
        { userId: 'u-780', name: null, email: 'jcsainz95@example.com', pieceCount: 1, totalValueMxnCents: 9500, pendingPriceCount: 0 },
      ],
      page: 1,
      pageSize: 20,
      total: 1,
    });
    const { container } = renderWithProviders(<VaultsView />, 'es');

    const link = await screen.findByRole('link', {
      name: 'Ver bóveda · Sin nombre registrado · jcsainz95@example.com',
    });
    expect(within(link).getByTestId('vault-row-noname-u-780')).toHaveTextContent('Sin nombre registrado');
    // El correo también dentro de la celda de nombre (en `< sm` la columna de correo se oculta).
    expect(within(link).getAllByText('jcsainz95@example.com').length).toBeGreaterThanOrEqual(1);
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      expect((n.textContent ?? '').trim()).not.toBe('jcsainz95');
    }
    expect(container.textContent).not.toContain('null');
  });
});
