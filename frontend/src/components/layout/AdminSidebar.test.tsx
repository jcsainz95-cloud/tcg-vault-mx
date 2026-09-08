import { describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';
import { screen } from '@testing-library/react';
import { renderWithIntl } from '@/test/render';

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
    renderWithIntl(<AdminSidebar />, 'es');
    const active = current();
    expect(active.map((a) => a.getAttribute('href'))).toEqual([href]);
  });
});
