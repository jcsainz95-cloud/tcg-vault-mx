import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import { mockDashboard } from '@/lib/mock/fixtures';
import es from '../../../../../messages/es.json';
import en from '../../../../../messages/en.json';

/**
 * # F-26 — M8 «Disputas» se retira de la interfaz (contrato §PNL.10.7 · `DESIGN_SYSTEM §60.8`)
 *
 * Desde PNL-1 nadie escribe filas `Dispute` y el dueño leyó cero abiertas/en revisión (`HECHOS.md:50` (3)). La
 * **API no cambia** (lecturas y `resolve` siguen: salida de emergencia); lo que sale es la pantalla:
 *
 * - **FE-M8-1** el menú no tiene «Disputas» ni ninguna entrada a `/admin/m8`.
 * - **FE-M8-2** `/admin/m8` redirige a `/admin` conservando el idioma (servidor, como `/admin/manual-refunds`).
 * - **FE-M8-3** con `workQueue.disputes: 3` la suma de la cola NO lo incluye y no hay enlace a M8.
 * - **FE-M8-4** (en `m6/M6View.test.tsx`) la pestaña «Disputas» de la ficha solo existe si el usuario tiene alguna.
 *
 * ⚠️ Todo F-26 vive en UN commit propio: si la medición posterior al despliegue (§PNL.10.7 paso 3 (b)) da alguna
 * disputa, revertir ese commit devuelve menú, ruta y enlace.
 */

const nav = vi.hoisted(() => ({ pathname: '/admin', redirect: vi.fn() }));

vi.mock('@/i18n/navigation', () => ({
  usePathname: () => nav.pathname,
  redirect: nav.redirect,
  Link: ({ href, children, ...rest }: { href: unknown; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('@/lib/role', () => ({
  useRole: () => ({ role: 'super_admin', setRole: () => {}, isSuperAdmin: true, canSwitchRole: false }),
}));

vi.mock('@/hooks/usePickingSummary', () => ({
  PICKING_SUMMARY_KEY: ['admin-picking-summary'],
  usePickingSummary: () => ({ data: undefined }),
}));

// eslint-disable-next-line import/first
import { AdminSidebar } from '@/components/layout/AdminSidebar';
// eslint-disable-next-line import/first
import { AdminDashboard } from './AdminDashboard';
// eslint-disable-next-line import/first
import M8Page from './m8/page';

beforeEach(() => {
  vi.restoreAllMocks();
  nav.redirect.mockReset();
});

describe('F-26 · FE-M8-1 — el menú no tiene «Disputas»', () => {
  it.each(['es', 'en'] as const)('%s: ninguna entrada se llama Disputas ni apunta a /admin/m8', (locale) => {
    renderWithProviders(<AdminSidebar />, locale);
    const links = screen.getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).not.toContain('/admin/m8');
    expect(links.filter((a) => /Disputas|Disputes/.test(a.textContent ?? ''))).toEqual([]);
    // «Día a día» queda: Solicitudes de venta · Ventas · Reembolsos · Pedidos por preparar (§60.8).
    const hrefs = links.map((a) => a.getAttribute('href'));
    const i = hrefs.indexOf('/admin/m4');
    expect(hrefs[i + 1]).toBe('/admin/m1');
  });

  it('los textos de M8 salen: `admin.modules.m8`, `admin.m8.*`, `admin.dashboard.disputes` y `dispute.*` (es y en)', () => {
    for (const msgs of [es, en]) {
      const admin = msgs.admin as unknown as Record<string, Record<string, unknown>>;
      expect(admin.modules).not.toHaveProperty('m8');
      expect(admin).not.toHaveProperty('m8');
      expect(admin.dashboard).not.toHaveProperty('disputes');
      expect(msgs).not.toHaveProperty('dispute');
    }
  });
});

describe('F-26 · FE-M8-2 — `/admin/m8` redirige a `/admin` conservando el idioma', () => {
  it.each([
    ['es', 'es'],
    ['en', 'en'],
    ['xx', 'es'],
  ])('/%s/admin/m8 ⇒ /%s/admin', async (locale, expected) => {
    await M8Page({ params: Promise.resolve({ locale }) });
    expect(nav.redirect).toHaveBeenCalledTimes(1);
    expect(nav.redirect).toHaveBeenCalledWith({ href: '/admin', locale: expected });
  });
});

describe('F-26 · FE-M8-3 — la cola del tablero no suma disputas ni enlaza a M8', () => {
  it('con `workQueue.disputes: 3` la suma es envíos + buylist (3 + 5 = 8), sin enlace a /admin/m8', async () => {
    vi.spyOn(api, 'getDashboard').mockResolvedValue({
      ...mockDashboard,
      workQueue: { ...mockDashboard.workQueue, shipments: 3, buylist: 5, disputes: 3 },
    } as never);
    renderWithProviders(<AdminDashboard />, 'es');
    const label = await screen.findByText('Cola de trabajo');
    const card = label.parentElement!.parentElement!;
    expect(card.children[1].textContent).toBe('8');
    const links = Array.from(card.querySelectorAll('a'));
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/admin/m4', '/admin/m5', '/admin/m2']);
    expect(document.querySelector('a[href="/admin/m8"]')).toBeNull();
  });
});
