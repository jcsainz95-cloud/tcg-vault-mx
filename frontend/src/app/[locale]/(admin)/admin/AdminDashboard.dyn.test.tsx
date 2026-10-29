import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { AdminDashboard } from './AdminDashboard';
import * as api from '@/lib/api';
import { mockDashboard } from '@/lib/mock/fixtures';
import type { DashboardDTO } from '@/types/contract';

/**
 * v1.113⟨portada⟩ — `dataHealth.featuredRotation` y `dataHealth.listingPrices` (API_CONTRACT §DYN.2.5/§DYN.5.8,
 * criterio 927 «aparece el aviso en salud de datos»). Aditivos y sin dinero (los ve también el operador). `stale` en
 * bermellón. Mutación que lo pone rojo: no pintar `stale` distinto de `ok` (o no pintar las líneas).
 */
vi.mock('@/lib/role', () => ({
  useRole: () => ({ role: 'vault_operator', setRole: () => {}, isSuperAdmin: false, canSwitchRole: false }),
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: unknown; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}));

beforeEach(() => vi.restoreAllMocks());

function serve(dataHealth: Partial<DashboardDTO['dataHealth']>, drop: (keyof DashboardDTO['dataHealth'])[] = []) {
  const dh = { ...mockDashboard.dataHealth, ...dataHealth } as Record<string, unknown>;
  for (const k of drop) delete dh[k];
  vi.spyOn(api, 'getDashboard').mockResolvedValue({ ...mockDashboard, dataHealth: dh as DashboardDTO['dataHealth'] });
}

describe('DYN · salud de datos del tablero: Destacadas y precio del día', () => {
  it('`stale` (927): dice qué día se sirve y cuál tocaba, en bermellón', async () => {
    serve({
      featuredRotation: { status: 'stale', servingBusinessDate: '2026-10-28', expectedBusinessDate: '2026-10-29' },
      listingPrices: { status: 'stale', lastDailyBusinessDate: '2026-10-28' },
    });
    renderWithProviders(<AdminDashboard />, 'es');
    const fr = await screen.findByTestId('dyn-health-featured');
    expect(fr).toHaveTextContent('Destacadas: atrasadas — se sirve 2026-10-28, tocaba 2026-10-29.');
    expect(fr.className).toContain('text-accent');
    const lp = screen.getByTestId('dyn-health-prices');
    expect(lp).toHaveTextContent('Precio del día: atrasado — último cálculo diario 2026-10-28.');
    expect(lp.className).toContain('text-accent');
  });

  it('`ok` y `never`: sin bermellón', async () => {
    serve({
      featuredRotation: { status: 'ok', servingBusinessDate: '2026-10-29', expectedBusinessDate: '2026-10-29' },
      listingPrices: { status: 'never', lastDailyBusinessDate: null },
    });
    renderWithProviders(<AdminDashboard />, 'es');
    const fr = await screen.findByTestId('dyn-health-featured');
    expect(fr).toHaveTextContent('Destacadas: al día (2026-10-29).');
    expect(fr.className).not.toContain('text-accent');
    expect(screen.getByTestId('dyn-health-prices')).toHaveTextContent('Precio del día: aún no hay cálculo diario.');
  });

  it('servidor anterior (sin los campos) ⇒ ningún nodo', async () => {
    serve({}, ['featuredRotation', 'listingPrices']);
    renderWithProviders(<AdminDashboard />, 'es');
    await screen.findByText(/Salud de datos|Data health/);
    expect(screen.queryByTestId('dyn-data-health')).toBeNull();
  });
});
