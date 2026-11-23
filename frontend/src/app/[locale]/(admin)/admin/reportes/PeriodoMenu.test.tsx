import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState, type ReactNode } from 'react';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { AdminSidebar } from '@/components/layout/AdminSidebar';
import { periodFor, parsePeriod } from '@/lib/reports/period';
import { resetCurrentPeriodForTests, setCurrentPeriod } from '@/lib/reports/period-store';
import { BoardView } from './BoardView';
import { StockView } from './StockView';
import { M9View } from '../m9/M9View';
import { parseSalesUrl } from '../m9/salesParams';
import * as api from '@/lib/api';

/**
 * §REPORTES-CEO §2 (I-3b, qa): el periodo vigente VIAJA por el menú. Cada prueba mide el MENÚ (`nav`), no los enlaces de las
 * franjas, y muere si `useReportPeriodSearch` se anula o si una pantalla no publica su periodo.
 */
vi.mock('@/lib/role', () => ({
  useRole: () => ({ role: 'super_admin', setRole: () => {}, isSuperAdmin: true, canSwitchRole: false }),
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
  usePickingSummary: () => ({ isLoading: false, isError: false, refetch: () => {}, data: undefined }),
}));

const menu = () => within(screen.getByRole('navigation'));
const menuHref = (name: string) => menu().getByRole('link', { name: new RegExp(name) }).getAttribute('href');

beforeEach(() => {
  resetCurrentPeriodForTests();
  window.history.replaceState({}, '', '/');
});

describe('el menú lleva el periodo vigente (solo el menú)', () => {
  it('un periodo publicado en el almacén sale en los seis enlaces de Reportes y NO en Inicio, Pedidos ni Marketing', () => {
    setCurrentPeriod(periodFor('30d'));
    renderWithProviders(<AdminSidebar />, 'es');
    for (const [n, h] of [
      ['Junta de dirección', '/admin/reportes'],
      ['Finanzas', '/admin/m7'],
      ['^Ventas', '/admin/m9'],
      ['Compras a vendedores', '/admin/reportes/compras'],
      ['^Inventario$', '/admin/reportes/inventario'],
      ['Operación', '/admin/reportes/operacion'],
    ]) {
      expect(menuHref(n)).toBe(`${h}?preset=30d`);
    }
    expect(menuHref('^Inicio')).toBe('/admin');
    expect(menuHref('^Pedidos$')).toBe('/admin/m3');
    expect(menuHref('Marketing')).toBe('/admin/marketing');
  });
});

describe('Ventas publica su periodo al menú (caso 1)', () => {
  it('cambiar el periodo en Ventas (30 días → 7 días) llega al menú', async () => {
    vi.spyOn(api, 'getSalesReport');
    renderWithProviders(
      <>
        <AdminSidebar />
        <M9View initialSales={parseSalesUrl({ preset: '30d' })} />
      </>,
      'es',
    );
    await waitFor(() => expect(menuHref('Finanzas')).toBe('/admin/m7?preset=30d'));
    fireEvent.click(screen.getByRole('button', { name: '7 días' }));
    expect(menuHref('Finanzas')).toBe('/admin/m7?preset=7d');
    expect(menuHref('Compras a vendedores')).toBe('/admin/reportes/compras?preset=7d');
  });

  it('Ventas abierta directo con ?preset=7d deja el menú con ese periodo', async () => {
    renderWithProviders(
      <>
        <AdminSidebar />
        <M9View initialSales={parseSalesUrl({ preset: '7d' })} />
      </>,
      'es',
    );
    await waitFor(() => expect(menuHref('Finanzas')).toBe('/admin/m7?preset=7d'));
  });
});

describe('pasar por Inventario no altera ni pierde el periodo (caso 2)', () => {
  it('el enlace de la franja de Inventario en la Junta lleva el periodo', async () => {
    renderWithProviders(<BoardView initialPeriod={periodFor('30d')} />, 'es');
    const franja = await screen.findByTestId('franja-stock');
    expect(within(franja).getByRole('link', { name: /Ver el informe completo/ })).toHaveAttribute('href', '/admin/reportes/inventario?preset=30d');
  });

  it('Inventario sin periodo en la URL NO pisa el vigente (el menú sigue en 30 días)', () => {
    setCurrentPeriod(periodFor('30d'));
    renderWithProviders(
      <>
        <AdminSidebar />
        <StockView />
      </>,
      'es',
    );
    expect(menuHref('Finanzas')).toBe('/admin/m7?preset=30d');
  });

  it('Inventario con periodo en la URL lo adopta (llegar con un enlace guardado)', () => {
    renderWithProviders(
      <>
        <AdminSidebar />
        <StockView initialPeriod={periodFor('7d')} />
      </>,
      'es',
    );
    expect(menuHref('Finanzas')).toBe('/admin/m7?preset=7d');
  });
});

describe('«Todo» de Finanzas llegando a Ventas (caso 3): una caída coherente, URL y pantalla coinciden', () => {
  it('?preset=all en Ventas cae a «Este mes»: la pantalla, la URL y el menú dicen lo mismo', async () => {
    window.history.replaceState({}, '', '/admin/m9?preset=all');
    renderWithProviders(
      <>
        <AdminSidebar />
        <M9View initialSales={parseSalesUrl({ preset: 'all' })} />
      </>,
      'es',
    );
    expect(screen.getByRole('button', { name: 'Este mes' })).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(window.location.search).toContain('preset=month'));
    expect(window.location.search).not.toContain('all');
    expect(menuHref('Finanzas')).toBe('/admin/m7?preset=month');
  });

  it('en la Junta también: ?preset=all cae a «Este mes» y reescribe la URL', async () => {
    window.history.replaceState({}, '', '/admin/reportes?preset=all');
    renderWithProviders(<BoardView initialPeriod={parsePeriod({ preset: 'all' }, undefined, { maxDays: 366 })} />, 'es');
    await waitFor(() => expect(window.location.search).toBe('?preset=month'));
  });
});

describe('«hasta» futuro por URL (m-15)', () => {
  it('?preset=custom con un «hasta» posterior a hoy cae al defecto, como prohíbe el selector', () => {
    expect(parsePeriod({ preset: 'custom', from: '2026-11-01', to: '2027-06-01' }, '2026-11-22').preset).toBe('month');
  });
});

describe('B-1 · el informe de Ventas relee el periodo cuando la URL cambia (candado de la `key`)', () => {
  function Host() {
    const [s, setS] = useState(parseSalesUrl({ preset: '30d' }));
    return (
      <>
        <button onClick={() => setS(parseSalesUrl({ preset: 'today' }))}>ir a hoy</button>
        <M9View initialSales={s} />
      </>
    );
  }
  it('con otro `initialSales` (el enlace «Ventas de hoy») el informe pide el periodo nuevo', async () => {
    const spy = vi.spyOn(api, 'getSalesReport');
    renderWithProviders(<Host />, 'es');
    await waitFor(() => expect(spy).toHaveBeenCalled());
    fireEvent.click(screen.getByText('ir a hoy'));
    const today = periodFor('today');
    await waitFor(() => expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ from: today.from, to: today.to })));
    expect(screen.getByRole('button', { name: 'Hoy' })).toHaveAttribute('aria-pressed', 'true');
    spy.mockRestore();
  });
});
