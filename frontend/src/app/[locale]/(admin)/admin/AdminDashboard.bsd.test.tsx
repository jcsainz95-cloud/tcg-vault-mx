import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { AdminDashboard } from './AdminDashboard';
import * as api from '@/lib/api';
import { mockDashboard } from '@/lib/mock/fixtures';

/**
 * 💰 rev BSD-1 — **UX-BSD-8 (BSD-F6, tablero)** · DESIGN_SYSTEM §BSD-UX.6c, contrato BSD-1.1 C-3 y BSD-1.3 punto 4.
 * Los contadores son HERMANOS de `workQueue.buylist` (que sigue siendo un número) y los da el SERVIDOR. Con 0 (o ausentes)
 * ⇒ ningún nodo (⛔ «0 solicitudes»). Texto completo en el enlace (⛔ un número solo).
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

function serve(workQueue: Partial<typeof mockDashboard.workQueue>) {
  vi.spyOn(api, 'getDashboard').mockResolvedValue({ ...mockDashboard, workQueue: { ...mockDashboard.workQueue, ...workQueue } });
}

describe('UX-BSD-8 · tablero: «se cierran solas pronto» y guías de entrada con alerta', () => {
  it('contadores > 0 ⇒ líneas-enlace a M5 con el plural del servidor', async () => {
    serve({ buylistGuideDueSoon: 2, buylistInboundLabelAlert: 1 });
    renderWithProviders(<AdminDashboard />, 'es');
    const due = await screen.findByTestId('dashboard-buylist-guide-due');
    expect(due).toHaveTextContent('2 solicitudes aceptadas sin guía se cierran solas pronto');
    expect(due.getAttribute('href')).toBe('/admin/m5');
    const alert = screen.getByTestId('dashboard-buylist-inbound-alert');
    expect(alert).toHaveTextContent('1 solicitud de venta con alerta en su guía');
    expect(alert.getAttribute('href')).toBe('/admin/m5');
    // `workQueue.buylist` sigue siendo el número de siempre.
    expect(screen.getByRole('link', { name: /^Buylist/ })).toBeInTheDocument();
  });

  it('singular', async () => {
    serve({ buylistGuideDueSoon: 1 });
    renderWithProviders(<AdminDashboard />, 'es');
    expect(await screen.findByTestId('dashboard-buylist-guide-due')).toHaveTextContent('1 solicitud aceptada sin guía se cierra sola pronto');
  });

  it.each([
    ['en 0', { buylistGuideDueSoon: 0, buylistInboundLabelAlert: 0 }],
    ['ausentes (servidor anterior)', {}],
  ])('contadores %s ⇒ ningún nodo', async (_n, wq) => {
    serve(wq);
    renderWithProviders(<AdminDashboard />, 'es');
    await screen.findByRole('link', { name: /^Buylist/ });
    expect(screen.queryByTestId('dashboard-buylist-guide-due')).toBeNull();
    expect(screen.queryByTestId('dashboard-buylist-inbound-alert')).toBeNull();
    expect(document.body.textContent).not.toMatch(/se cierran? solas? pronto|alerta en su guía/);
  });
});
