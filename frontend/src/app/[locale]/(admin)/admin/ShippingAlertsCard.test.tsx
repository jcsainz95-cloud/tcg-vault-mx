import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import { mockDashboard } from '@/lib/mock/fixtures';
import type { DashboardDTO } from '@/types/contract';
import { AdminDashboard } from './AdminDashboard';

/**
 * «Alertas de envíos» del tablero (`DESIGN_SYSTEM §43.22`, candados UX-SDX-39…42; contrato `§M4-SHIP.19.35.5` fila 1 y
 * `§19.35.8` F-2). `workQueue.shipping` llega igual a los dos roles; la cifra del saldo jamás (T.11).
 */

const role = vi.hoisted(() => ({ superAdmin: true }));
vi.mock('@/lib/role', () => ({
  useRole: () => ({ role: role.superAdmin ? 'super_admin' : 'vault_operator', setRole: () => {}, isSuperAdmin: role.superAdmin, canSwitchRole: false }),
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: unknown; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}));

type Shipping = NonNullable<DashboardDTO['workQueue']['shipping']>;
const BASE: Shipping = { lowBalance: false, withCarrierAlert: 3, withLabelAlert: 2, labelProcessing: 1 };

function serve(shipping: unknown) {
  const workQueue = { ...mockDashboard.workQueue } as Record<string, unknown>;
  if (shipping !== undefined) workQueue.shipping = shipping;
  vi.spyOn(api, 'getDashboard').mockResolvedValue({ ...mockDashboard, workQueue } as never);
}

async function card() {
  return screen.findByTestId('dashboard-shipping-alerts');
}

beforeEach(() => {
  vi.restoreAllMocks();
  role.superAdmin = true;
});

describe('UX-SDX-39 · la tarjeta para los dos roles; `null`/ausente ⇒ no existe', () => {
  for (const superAdmin of [true, false]) {
    it(`${superAdmin ? 'súper-admin' : 'operador'} ve rótulo, cifra, enlace a ?alert=true, nota y «en proceso»`, async () => {
      role.superAdmin = superAdmin;
      serve(BASE);
      renderWithProviders(<AdminDashboard />, 'es');
      const c = await card();
      expect(screen.getByText('Alertas de envíos')).toBeInTheDocument();
      expect(screen.getByTestId('dashboard-shipping-alerts-value')).toHaveTextContent(/^2$/);
      const link = screen.getByRole('link', { name: '2 con alerta de guía · 3 con aviso de la paquetería' });
      expect(link).toHaveAttribute('href', '/admin/m4?tab=envios&alert=true');
      expect(c).toHaveTextContent('Un envío puede tener las dos alertas: en la lista sale una sola vez.');
      expect(c).toHaveTextContent('1 guía en proceso');
    });
  }
  it('cifra grande en bermellón solo si `withLabelAlert > 0`', async () => {
    serve(BASE);
    renderWithProviders(<AdminDashboard />, 'es');
    await card();
    expect(screen.getByTestId('dashboard-shipping-alerts-value').closest('div.flex-col')?.className).toMatch(/text-accent/);
  });
  it('`labelProcessing: 3` ⇒ plural', async () => {
    serve({ ...BASE, labelProcessing: 3 });
    renderWithProviders(<AdminDashboard />, 'es');
    expect(await card()).toHaveTextContent('3 guías en proceso');
  });
  it('`labelProcessing: 0` ⇒ sin línea «en proceso»', async () => {
    serve({ ...BASE, labelProcessing: 0 });
    renderWithProviders(<AdminDashboard />, 'es');
    expect(await card()).not.toHaveTextContent('en proceso');
  });
  for (const [name, value] of [['null', null], ['ausente', undefined]] as const) {
    it(`\`shipping\` ${name} ⇒ ningún «Alertas de envíos»`, async () => {
      serve(value);
      renderWithProviders(<AdminDashboard />, 'es');
      await screen.findByTestId('sales-gross');
      expect(screen.queryByTestId('dashboard-shipping-alerts')).toBeNull();
      expect(screen.queryByText('Alertas de envíos')).toBeNull();
    });
  }
});

describe('UX-SDX-40 · `lowBalance`: solo `true` pinta la línea', () => {
  for (const lowBalance of [null, false]) {
    it(`\`lowBalance: ${String(lowBalance)}\` ⇒ la tarjeta no habla de saldo`, async () => {
      serve({ ...BASE, lowBalance });
      renderWithProviders(<AdminDashboard />, 'es');
      const c = await card();
      expect(c.textContent ?? '').not.toMatch(/saldo/i);
      expect(screen.queryByRole('link', { name: 'Ver el saldo' })).toBeNull();
    });
  }
  it('`lowBalance: true` ⇒ «Queda poco saldo en Skydropx…» en bermellón', async () => {
    serve({ ...BASE, lowBalance: true });
    renderWithProviders(<AdminDashboard />, 'es');
    await card();
    const line = screen.getByTestId('dashboard-shipping-low-balance');
    expect(line).toHaveTextContent('Queda poco saldo en Skydropx: comprar guías puede fallar hasta que se recargue.');
    expect(line.className).toMatch(/text-accent/);
  });
});

describe('UX-SDX-41 · jamás la cifra del saldo; «Ver el saldo» solo súper-admin', () => {
  for (const superAdmin of [true, false]) {
    it(`${superAdmin ? 'súper-admin' : 'operador'}: sin \`MX$\`/\`$\` ni «123» aunque llegue \`balanceCents\``, async () => {
      role.superAdmin = superAdmin;
      serve({ ...BASE, lowBalance: true, balanceCents: 12345, thresholdCents: 50000 });
      renderWithProviders(<AdminDashboard />, 'es');
      const c = await card();
      const text = c.textContent ?? '';
      expect(text).not.toContain('MX$');
      expect(text).not.toContain('$');
      expect(text).not.toContain('123');
      expect(text).not.toContain('500');
      const see = screen.queryByRole('link', { name: 'Ver el saldo' });
      if (superAdmin) expect(see).toHaveAttribute('href', '/admin/m10#envios-skydropx');
      else expect(see).toBeNull();
    });
  }
});

describe('UX-SDX-42 · nota de la unión, sin alertas, y `withLabelAlert` ausente', () => {
  it('`withLabelAlert: 2, withCarrierAlert: 0` ⇒ sin la nota «sale una sola vez»', async () => {
    serve({ ...BASE, withCarrierAlert: 0 });
    renderWithProviders(<AdminDashboard />, 'es');
    const c = await card();
    expect(c).not.toHaveTextContent('sale una sola vez');
    expect(screen.getByRole('link', { name: '2 con alerta de guía · 0 con aviso de la paquetería' })).toHaveAttribute(
      'href',
      '/admin/m4?tab=envios&alert=true',
    );
  });
  it('las dos en `0` ⇒ «Ningún envío con alerta.» y ningún enlace a `alert=true`', async () => {
    serve({ ...BASE, withCarrierAlert: 0, withLabelAlert: 0 });
    const { container } = renderWithProviders(<AdminDashboard />, 'es');
    const c = await card();
    expect(c).toHaveTextContent('Ningún envío con alerta.');
    expect(container.querySelector('a[href*="alert=true"]')).toBeNull();
    expect(screen.getByTestId('dashboard-shipping-alerts-value').closest('div.flex-col')?.className ?? '').not.toMatch(/text-accent/);
  });
  it('`withLabelAlert` ausente ⇒ cifra `—`, línea solo de la paquetería, sin `NaN`', async () => {
    const { withLabelAlert: _omit, ...rest } = BASE;
    void _omit;
    serve(rest);
    renderWithProviders(<AdminDashboard />, 'es');
    const c = await card();
    expect(screen.getByTestId('dashboard-shipping-alerts-value')).toHaveTextContent(/^—$/);
    expect(screen.getByRole('link', { name: '3 con aviso de la paquetería' })).toHaveAttribute('href', '/admin/m4?tab=envios&alert=true');
    expect(c.textContent ?? '').not.toMatch(/NaN|undefined/);
    expect(c).not.toHaveTextContent('sale una sola vez');
  });
  it('`withLabelAlert` ausente y `withCarrierAlert: 0` ⇒ «Ningún envío con alerta.»', async () => {
    serve({ lowBalance: null, withCarrierAlert: 0, labelProcessing: 0 });
    const { container } = renderWithProviders(<AdminDashboard />, 'es');
    expect(await card()).toHaveTextContent('Ningún envío con alerta.');
    expect(container.querySelector('a[href*="alert=true"]')).toBeNull();
  });
  it('⛔ la pantalla no suma: con 2 y 3 no aparece «5»', async () => {
    serve({ ...BASE, labelProcessing: 0 });
    renderWithProviders(<AdminDashboard />, 'es');
    const c = await card();
    expect(c.textContent ?? '').not.toMatch(/\b5\b/);
  });
});
