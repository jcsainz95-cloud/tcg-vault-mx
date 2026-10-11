import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import es from '../../../../../messages/es.json';
import { AdminDashboard } from './AdminDashboard';
import { today } from './m9/sales.testkit';

/**
 * Tarjeta «Ventas de hoy» (`DESIGN_SYSTEM §AN-UX.11`; candados UX-AN-10 (= AN-F-3), UX-AN-11, UX-AN-12).
 * Deterministas (N=1). El rol se fija por prueba con el doble de `useRole`.
 */
const role = vi.hoisted(() => ({ current: 'super_admin' as 'super_admin' | 'vault_operator' }));
vi.mock('@/lib/role', () => ({
  useRole: () => ({ role: role.current, setRole: () => {}, isSuperAdmin: role.current === 'super_admin', canSwitchRole: false }),
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: unknown; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(() => {
  vi.restoreAllMocks();
  role.current = 'super_admin';
});

const T = es.admin.dashboard.salesToday;

describe('UX-AN-10 (AN-F-3) · el operador no tiene tarjeta ni petición', () => {
  it('vault_operator: `sales-today-card` no existe y `/sales/today` no se pidió', async () => {
    role.current = 'vault_operator';
    const spy = vi.spyOn(api, 'getSalesToday');
    renderWithProviders(<AdminDashboard />, 'es');
    await screen.findByTestId('sales-gross'); // el tablero ya pintó
    expect(screen.queryByTestId('sales-today-card')).toBeNull();
    expect(screen.queryByText(T.title)).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('UX-AN-11 · súper-admin: cifras, rótulo del periodo, referencia y enlace', () => {
  it('pinta lo del DTO y enlaza a la pestaña «Ventas» con `preset=today`', async () => {
    const spy = vi.spyOn(api, 'getSalesToday').mockResolvedValue(today());
    renderWithProviders(<AdminDashboard />, 'es');
    const card = await screen.findByTestId('sales-today-orders');
    expect(card.textContent).toBe('3 pedidos');
    const root = screen.getByTestId('sales-today-card');
    expect(root.textContent).toContain('MX$1,250.00 cobrado');
    expect(root.textContent).toMatch(/Hoy, mar 6 oct · va en curso/);
    expect(root.textContent).toMatch(/Mar 29 sep completo: 1 pedido · MX\$400\.00/);
    expect(screen.getByTestId('sales-today-delta').textContent).toContain('+2 pedidos');
    expect(screen.getByTestId('sales-today-link')).toHaveAttribute('href', '/admin/m9?tab=ventas&preset=today');
    expect(spy).toHaveBeenCalledTimes(1);
  });
  it('referencia sin ventas ⇒ «El … no hubo ventas.» sin %', async () => {
    vi.spyOn(api, 'getSalesToday').mockResolvedValue(
      today({ sameWeekdayLastWeek: { day: '2026-09-29', orders: 0, chargedCents: 0 }, comparison: { orders: { diff: 3, pct: null }, chargedCents: { diff: 125000, pct: null } } }),
    );
    renderWithProviders(<AdminDashboard />, 'es');
    const delta = await screen.findByTestId('sales-today-delta');
    expect(delta.textContent).toBe('El mar 29 sep no hubo ventas.');
  });
});

describe('UX-AN-12 · el error de la tarjeta no tumba el tablero', () => {
  it('la celda muestra su error con «Reintentar» y las demás tarjetas siguen', async () => {
    vi.spyOn(api, 'getSalesToday').mockRejectedValue(new Error('boom'));
    renderWithProviders(<AdminDashboard />, 'es');
    await waitFor(() => expect(screen.getByTestId('sales-today-card').textContent).toContain(T.error));
    expect(screen.getByRole('button', { name: T.retry })).toBeInTheDocument();
    expect(screen.getByTestId('sales-gross')).toBeInTheDocument();
  });
});
