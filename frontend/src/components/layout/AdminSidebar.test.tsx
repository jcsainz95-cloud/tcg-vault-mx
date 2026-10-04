import { describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import type { PickingListSummaryDTO } from '@/types/contract';

/**
 * # AdminSidebar — **qué entrada se ilumina**
 *
 * Un menú que ilumina dos entradas —o ninguna— no dice dónde estás, y este menú es la única
 * orientación del back-office. La regla («gana la más específica») vive en `isActiveHref` y se mide
 * aquí de las dos maneras: la función a solas (barato y exhaustivo) y **el DOM** (que es lo que ve
 * el operador: `aria-current="page"` **una vez y solo una**).
 */

const roleState = vi.hoisted(() => ({ role: 'super_admin' }));
const pathState = vi.hoisted(() => ({ pathname: '/admin' }));
const summaryState = vi.hoisted(() => ({ data: undefined as PickingListSummaryDTO | undefined }));

// El contador del menú se controla aquí (RF-3); sin dato ⇒ sin badges, como antes de esta prueba.
vi.mock('@/hooks/usePickingSummary', () => ({
  PICKING_SUMMARY_KEY: ['admin-picking-summary'],
  usePickingSummary: () => ({ data: summaryState.data }),
}));

vi.mock('@/lib/role', () => ({
  useRole: () => ({
    role: roleState.role,
    setRole: () => {},
    isSuperAdmin: roleState.role === 'super_admin',
    canSwitchRole: true,
  }),
}));

vi.mock('@/i18n/navigation', () => ({
  usePathname: () => pathState.pathname,
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// eslint-disable-next-line import/first
import { AdminSidebar, isActiveHref } from './AdminSidebar';

describe('isActiveHref — gana la entrada MÁS ESPECÍFICA', () => {
  it('la ruta exacta ilumina su entrada', () => {
    expect(isActiveHref('/admin/m2', '/admin/m2')).toBe(true);
    expect(isActiveHref('/admin', '/admin')).toBe(true);
  });

  it('⭐ una sub-ruta SIN entrada propia ilumina a su padre (lo que `exact: true` rompía)', () => {
    // Este es el caso que QA marcó: con `exact` en M2, cualquier sub-ruta futura de M2 dejaría de
    // iluminar M2 **en silencio**, y el menú diría que no estás en ninguna parte.
    expect(isActiveHref('/admin/m2/curva', '/admin/m2')).toBe(true);
    expect(isActiveHref('/admin/m1/cualquier-cosa', '/admin/m1')).toBe(true);
  });

  it('⭐ una sub-ruta CON entrada propia ilumina solo a la hija', () => {
    expect(isActiveHref('/admin/m2/bounties', '/admin/m2/bounties')).toBe(true);
    expect(isActiveHref('/admin/m2/bounties', '/admin/m2')).toBe(false);
  });

  it('⭐ `/admin/m10` NO ilumina `/admin/m1` (el prefijo sin barra confundía hermanos)', () => {
    expect(isActiveHref('/admin/m10', '/admin/m1')).toBe(false);
    expect(isActiveHref('/admin/m10', '/admin/m10')).toBe(true);
  });

  it('el dashboard `/admin` es exacto por definición: no se ilumina desde sus hijas', () => {
    expect(isActiveHref('/admin/m5', '/admin')).toBe(false);
  });
});

describe('AdminSidebar — en el DOM se ilumina UNA entrada, nunca dos', () => {
  const current = () =>
    screen.getAllByRole('link').filter((a) => a.getAttribute('aria-current') === 'page');

  it.each([
    ['/admin', '/admin'],
    ['/admin/m10', '/admin/m10'],
    ['/admin/m2', '/admin/m2'],
    ['/admin/m2/bounties', '/admin/m2/bounties'],
    ['/admin/m2/lo-que-venga', '/admin/m2'],
  ])('en %s se ilumina exactamente %s', (pathname, href) => {
    pathState.pathname = pathname;
    renderWithProviders(<AdminSidebar />, 'es');
    const active = current();
    expect(active.map((a) => a.getAttribute('href'))).toEqual([href]);
  });
});

/**
 * # §37.20 — «Reembolsos»: una entrada, dos cubetas (RF-2, RF-3, RF-4)
 *
 * El `summary` de estas pruebas lleva TODOS los demás campos distintos de cero a propósito: un badge que sumara
 * cualquier otro campo (la mutación de RF-3) daría otro número.
 */
function summary(manualRefundsPending: number | null): PickingListSummaryDTO {
  return {
    ship: 2,
    vault: 1,
    oldestRequestedAt: '2026-10-01T10:00:00Z',
    stuckRefunds: 5,
    toReplace: 4,
    oldestOpenCaseAt: '2026-10-01T10:00:00Z',
    toReplaceOverdue: 1,
    manualRefundsPending,
  };
}

describe('§37.20 · RF-3 — el badge de «Reembolsos» es SOLO transferencias SPEI pendientes', () => {
  it('`manualRefundsPending: 3` ⇒ «3», con `aria-label` «3 transferencias pendientes»', () => {
    roleState.role = 'super_admin';
    pathState.pathname = '/admin';
    summaryState.data = summary(3);
    renderWithProviders(<AdminSidebar />, 'es');
    const badge = screen.getByTestId('nav-badge-refunds');
    expect(badge.textContent).toBe('3');
    expect(badge.getAttribute('aria-label')).toBe('3 transferencias pendientes');
    expect(badge.closest('a')?.getAttribute('href')).toBe('/admin/refunds');
    summaryState.data = undefined;
  });

  it.each([0, null])('`manualRefundsPending: %s` ⇒ no existe el nodo (aunque haya otros contadores)', (n) => {
    roleState.role = 'super_admin';
    pathState.pathname = '/admin';
    summaryState.data = summary(n);
    renderWithProviders(<AdminSidebar />, 'es');
    expect(screen.queryByTestId('nav-badge-refunds')).toBeNull();
    summaryState.data = undefined;
  });
});

/**
 * **SR-UI-11** (`DESIGN_SYSTEM §40.0` regla 5, criterio 253 por ausencia): «Reembolso por revisar» NO cambia el menú. Las
 * entradas son las mismas que antes de v4.12 y el badge de «Reembolsos» sigue leyendo SOLO SPEI — aunque el tablero
 * traiga `refundReviews.pending: 3` (el menú ni siquiera lo consulta: se espía para probarlo).
 */
describe('§40 · SR-UI-11 — el menú no cambia con «por revisar»', () => {
  it('mismas entradas; con `manualRefundsPending: 0` no hay badge aunque haya 3 por revisar', async () => {
    const api = await import('@/lib/api');
    const { mockDashboard } = await import('@/lib/mock/fixtures');
    const dash = vi.spyOn(api, 'getDashboard').mockResolvedValue({
      ...mockDashboard,
      workQueue: { ...mockDashboard.workQueue, refundReviews: { pending: 3, oldestRefundedAt: '2026-10-01T10:00:00Z' } },
    } as never);
    roleState.role = 'super_admin';
    pathState.pathname = '/admin';
    summaryState.data = summary(0);
    renderWithProviders(<AdminSidebar />, 'es');
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual([
      '/admin',
      '/admin/m5',
      '/admin/m3',
      '/admin/refunds',
      '/admin/m4',
      '/admin/m8',
      '/admin/m1',
      '/admin/m11',
      '/admin/vaults',
      '/admin/m2',
      '/admin/m2/bounties',
      '/admin/m12',
      '/admin/m7',
      '/admin/m9',
      '/admin/m6',
      '/admin/m10',
    ]);
    expect(screen.queryByTestId('nav-badge-refunds')).toBeNull();
    expect(dash).not.toHaveBeenCalled();
    summaryState.data = undefined;
  });
});

describe('§37.20 · RF-2 — al operador, «Reembolsos» no es un enlace que lleve a ningún sitio', () => {
  it('como `vault_operator`: ningún enlace NAVEGABLE contiene «Reembolsos», y la entrada bloqueada no lleva badge', () => {
    roleState.role = 'vault_operator';
    pathState.pathname = '/admin';
    // Aunque el `summary` trajera un número (el contrato manda `null` al operador), no se pinta.
    summaryState.data = summary(3);
    renderWithProviders(<AdminSidebar />, 'es');
    const navigable = screen.getAllByRole('link').filter((a) => a.getAttribute('aria-disabled') !== 'true');
    expect(navigable.filter((a) => /Reembolsos/.test(a.textContent ?? ''))).toEqual([]);
    expect(screen.queryByTestId('nav-badge-refunds')).toBeNull();
    roleState.role = 'super_admin';
    summaryState.data = undefined;
  });
});

describe('§37.20 · RF-4 — «Reembolsos» se ilumina en su página y en el detalle SPEI, y solo ella', () => {
  const current = () =>
    screen.getAllByRole('link').filter((a) => a.getAttribute('aria-current') === 'page');

  it.each(['/admin/refunds', '/admin/manual-refunds/mr-1001', '/admin/manual-refunds'])(
    'en %s hay exactamente un activo y es /admin/refunds',
    (pathname) => {
      roleState.role = 'super_admin';
      pathState.pathname = pathname;
      renderWithProviders(<AdminSidebar />, 'es');
      expect(current().map((a) => a.getAttribute('href'))).toEqual(['/admin/refunds']);
    },
  );

  it('la regla a solas: el alias no roba la ruta a otra entrada ni confunde hermanos con prefijo', () => {
    expect(isActiveHref('/admin/manual-refunds/mr-1001', '/admin/refunds')).toBe(true);
    expect(isActiveHref('/admin/manual-refunds-x', '/admin/refunds')).toBe(false);
    expect(isActiveHref('/admin/manual-refunds/mr-1001', '/admin')).toBe(false);
    expect(isActiveHref('/admin/refunds', '/admin/m3')).toBe(false);
  });
});
