import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { periodFor } from '@/lib/reports/period';
import { BoardView } from './BoardView';
import { StockView } from './StockView';
import { OpsView } from './OpsView';
import { PurchasesView } from './PurchasesView';

const roleState = vi.hoisted(() => ({ isSuperAdmin: true }));
vi.mock('@/lib/role', () => ({
  useRole: () => ({ role: roleState.isSuperAdmin ? 'super_admin' : 'vault_operator', setRole: () => {}, isSuperAdmin: roleState.isSuperAdmin, canSwitchRole: false }),
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: unknown; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/hooks/usePickingSummary', () => ({
  usePickingSummary: () => ({
    isLoading: false,
    isError: false,
    refetch: () => {},
    data: { ship: 4, vault: 2, toReplace: 3, toReplaceOverdue: 1, stuckRefunds: 0, oldestRequestedAt: null, oldestOpenCaseAt: null, manualRefundsPending: null },
  }),
}));

const period = periodFor('month', '2026-11-22');
beforeEach(() => {
  roleState.isSuperAdmin = true;
});

describe('§REPORTES-CEO F1 · Junta de dirección', () => {
  it('una franja por área, cada una con su enlace al informe y el periodo en la URL', async () => {
    renderWithProviders(<BoardView initialPeriod={period} />, 'es');
    expect(screen.getByRole('heading', { level: 1, name: 'Junta de dirección' })).toBeInTheDocument();
    const want: Record<string, string> = {
      finance: '/admin/m7?preset=custom&from=2026-11-01&to=2026-11-22',
      sales: '/admin/m9?preset=custom&from=2026-11-01&to=2026-11-22',
      purchases: '/admin/reportes/compras?preset=custom&from=2026-11-01&to=2026-11-22',
      stock: '/admin/reportes/inventario',
      ops: '/admin/reportes/operacion?preset=custom&from=2026-11-01&to=2026-11-22',
      marketing: '/admin/marketing',
    };
    for (const [id, href] of Object.entries(want)) {
      const franja = screen.getByTestId(`franja-${id}`);
      expect(within(franja).getByRole('link', { name: /Ver el informe completo/ })).toHaveAttribute('href', href);
    }
  });

  it('no pinta cifras que aún no existen (caja, dinero comprometido, inventario parado, metas)', async () => {
    const { container } = renderWithProviders(<BoardView initialPeriod={period} />, 'es');
    await screen.findByText('Pedidos');
    for (const nope of ['Caja disponible', 'Dinero comprometido', 'Dinero parado', 'Meta', 'próximamente', 'EBITDA', 'buylist']) {
      expect(container.textContent?.toLowerCase()).not.toContain(nope.toLowerCase());
    }
  });

  it('la variación sale del servidor; con periodo anterior en cero muestra «—», nunca 0 %', async () => {
    renderWithProviders(<BoardView initialPeriod={period} />, 'es');
    const franja = await screen.findByTestId('franja-sales');
    await within(franja).findByText('Pedidos');
    expect(franja.querySelectorAll('[data-testid="delta"], [title]').length).toBeGreaterThan(0);
  });
});

describe('§REPORTES-CEO F1 · Inventario (Qué reponer) y roles', () => {
  it('súper-admin: valor de inventario y la sección «Qué reponer»', async () => {
    renderWithProviders(<StockView />, 'es');
    expect(await screen.findByText('Inventario (a referencia)')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Qué reponer' })).toBeInTheDocument();
  });

  it('operador: solo unidades; no pide dinero ni la lista de compra (CR-4)', async () => {
    roleState.isSuperAdmin = false;
    const api = await import('@/lib/api');
    const inv = vi.spyOn(api, 'getInventoryValue');
    const demand = vi.spyOn(api, 'getWishlistDemand');
    const { container } = renderWithProviders(<StockView />, 'es');
    expect(await screen.findByTestId('stock-operator')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/MX\$/);
    expect(inv).not.toHaveBeenCalled();
    expect(demand).not.toHaveBeenCalled();
    inv.mockRestore();
    demand.mockRestore();
  });
});

describe('§REPORTES-CEO F1 · Operación y Compras a vendedores', () => {
  it('Operación para el operador: colas en unidades y ninguna consulta de ventas', async () => {
    roleState.isSuperAdmin = false;
    const api = await import('@/lib/api');
    const sales = vi.spyOn(api, 'getSalesReport');
    const { container } = renderWithProviders(<OpsView initialPeriod={period} />, 'es');
    expect(await screen.findByText('Envíos por preparar')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/MX\$/);
    expect(sales).not.toHaveBeenCalled();
    sales.mockRestore();
  });

  it('Compras a vendedores: pagado, tarifa descontada y guías', async () => {
    renderWithProviders(<PurchasesView initialPeriod={period} />, 'es');
    expect(await screen.findByText('Tarifa de envío descontada')).toBeInTheDocument();
    expect(screen.getByText('Costo de guías de compra')).toBeInTheDocument();
  });
});
