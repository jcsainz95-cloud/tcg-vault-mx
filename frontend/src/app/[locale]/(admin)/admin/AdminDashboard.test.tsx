import { describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { AdminDashboard } from './AdminDashboard';

// `useRole`: super_admin para que las cifras enmascaradas no oculten la cola de trabajo.
vi.mock('@/lib/role', () => ({
  useRole: () => ({ role: 'super_admin', setRole: () => {}, isSuperAdmin: true, canSwitchRole: false }),
}));

// El `Link` de next-intl no resuelve bajo vitest; se stubea a un <a href> que preserva props.
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: unknown; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}));

describe('AdminDashboard · cola de trabajo accionable (§7.8)', () => {
  it('los conteos de la cola de trabajo son ENLACES a su módulo', async () => {
    renderWithProviders(<AdminDashboard />, 'es');

    // Cada conteo enlaza a su módulo: envíos→M4, buylist→M5, disputas→M8, precios→M2.
    const shipments = await screen.findByRole('link', { name: /Envíos/ });
    expect(shipments.getAttribute('href')).toContain('/admin/m4');

    const buylist = screen.getByRole('link', { name: /^Buylist/ });
    expect(buylist.getAttribute('href')).toContain('/admin/m5');

    const disputes = screen.getByRole('link', { name: /Disputas/ });
    expect(disputes.getAttribute('href')).toContain('/admin/m8');

    // "Precios pendientes" aparece como enlace a M2 (cola de trabajo y salud de datos).
    const pending = screen.getAllByRole('link', { name: /Precios pendientes/ });
    expect(pending.length).toBeGreaterThan(0);
    expect(pending[0].getAttribute('href')).toContain('/admin/m2');
  });
});
