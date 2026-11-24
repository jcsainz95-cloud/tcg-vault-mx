import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { periodFor } from '@/lib/reports/period';
import { BoardView } from './BoardView';
import BoardPage from './page';
import PurchasesPage from './compras/page';
import OpsPage from './operacion/page';
import * as api from '@/lib/api';
import { mockPnl } from '@/lib/mock/fixtures';
import { StockView } from './StockView';

import { OpsView } from './OpsView';
import { PurchasesView } from './PurchasesView';

const roleState = vi.hoisted(() => ({ isSuperAdmin: true }));
vi.mock('@/lib/role', () => ({
  useRole: () => ({ role: roleState.isSuperAdmin ? 'super_admin' : 'vault_operator', setRole: () => {}, isSuperAdmin: roleState.isSuperAdmin, canSwitchRole: false }),
}));
vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/admin/reportes',
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
      finance: '/admin/m7?preset=month',
      sales: '/admin/m9?preset=month',
      purchases: '/admin/reportes/compras?preset=month',
      stock: '/admin/reportes/inventario?preset=month',
      ops: '/admin/reportes/operacion?preset=month',
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
    for (const nope of ['Caja disponible', 'Dinero comprometido', 'Dinero parado', 'próximamente', 'EBITDA', 'buylist']) {
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

describe('§REPORTES-CEO CR-2b · metas de lanzamiento en la Junta, con el periodo de la Junta', () => {
  it('franja «Metas de lanzamiento» con las cuatro cifras y su avance contra la meta', async () => {
    const spy = vi.spyOn(api, 'getLaunchMetrics');
    renderWithProviders(<BoardView initialPeriod={period} />, 'es');
    const franja = await screen.findByTestId('franja-metas');
    expect(franja).toHaveAttribute('id', 'metas'); // ancla de `?tab=actividad`
    for (const l of ['Usuarios activos', 'Ventas liquidadas', 'Compras a vendedores pagadas', 'Retiros sin disputa']) {
      expect(await within(franja).findByText(l)).toBeInTheDocument();
    }
    expect(await within(franja).findByText('42 de 100 · 42.0 %')).toBeInTheDocument();
    // Mismo periodo que el resto de la Junta (días de México).
    expect(spy).toHaveBeenCalledWith({ from: '2026-11-01', to: '2026-11-22' });
    spy.mockRestore();
  });
});

describe('§REPORTES-CEO I-3 · un solo selector, «Hora de México» y fechas siempre visibles', () => {
  it('la Junta muestra el selector único con los atajos del contrato y «Todo» desactivado (máx. 366 días)', async () => {
    renderWithProviders(<BoardView initialPeriod={period} />, 'es');
    const group = screen.getByRole('group', { name: 'Periodo' });
    for (const l of ['Hoy', '7 días', '30 días', 'Este mes', 'Mes pasado', 'Este trimestre', 'Este año', 'Fechas…']) {
      expect(within(group).getByRole('button', { name: l })).toBeInTheDocument();
    }
    expect(within(group).getByRole('button', { name: /Todo/ })).toBeDisabled();
    expect(within(group).getByRole('button', { name: /Todo/ }).textContent).toContain('máx. 366 días');
    expect(screen.getByTestId('period-resolved').textContent).toBe('Hora de México · Del 1 nov al 22 nov 2026');
  });
});

describe('§REPORTES-CEO I-6 · mutaciones que antes sobrevivían', () => {
  it('la ganancia de la Junta es `profitCents` del servidor, tal cual (⛔ no se calcula en el cliente)', async () => {
    // Un P&L cuya ganancia NO sale de la fórmula de sus renglones: si la pantalla la recalculara, mostraría otra cifra.
    vi.spyOn(api, 'getPnl').mockResolvedValue({ ...mockPnl, profitCents: 123_456_789 });
    renderWithProviders(<BoardView initialPeriod={period} />, 'es');
    expect(await screen.findByText('MX$1,234,567.89')).toBeInTheDocument();
    vi.restoreAllMocks();
  });

  it('Operación para el operador: sin sección de dinero, sin selector de periodo y sin ninguna consulta de ventas', async () => {
    roleState.isSuperAdmin = false;
    const sales = vi.spyOn(api, 'getSalesReport');
    renderWithProviders(<OpsView initialPeriod={period} />, 'es');
    await screen.findByText('Envíos por preparar');
    expect(screen.queryByRole('heading', { name: 'Envíos y contracargos del periodo' })).toBeNull();
    expect(screen.queryByTestId('period-selector')).toBeNull();
    expect(screen.queryByText(/Costo de guías/)).toBeNull();
    expect(sales).not.toHaveBeenCalled();
    sales.mockRestore();
  });

  it.each([
    ['la Junta', () => BoardPage({ searchParams: Promise.resolve({}) })],
    ['Compras a vendedores', () => PurchasesPage({ searchParams: Promise.resolve({}) })],
  ])('%s: la página del servidor lleva el candado de súper-admin (operador ⇒ acceso restringido, cero consultas)', async (_n, make) => {
    roleState.isSuperAdmin = false;
    const pnl = vi.spyOn(api, 'getPnl');
    const sales = vi.spyOn(api, 'getSalesReport');
    renderWithProviders(await make(), 'es');
    expect(await screen.findByText('Acceso restringido')).toBeInTheDocument();
    expect(pnl).not.toHaveBeenCalled();
    expect(sales).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('Operación (página): abierta al operador, sin candado de súper-admin', async () => {
    roleState.isSuperAdmin = false;
    renderWithProviders(await OpsPage({ searchParams: Promise.resolve({}) }), 'es');
    expect(await screen.findByText('Envíos por preparar')).toBeInTheDocument();
    expect(screen.queryByText('Acceso restringido')).toBeNull();
  });
});
