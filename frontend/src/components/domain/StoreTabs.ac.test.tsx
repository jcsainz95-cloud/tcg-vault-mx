import { describe, it, expect, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithIntl } from '@/test/render';

/** AC-UX-1 (AC-F2): cuatro pestañas en el orden de §AC-UX.1; `/accesorios` marca «Accesorios». */
const { path } = vi.hoisted(() => ({ path: { current: '/accesorios' } }));
vi.mock('@/i18n/navigation', () => ({
  usePathname: () => path.current,
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));

import { StoreTabs } from './StoreTabs';

describe('AC-UX-1 · StoreTabs con «Accesorios»', () => {
  it('cuatro enlaces en orden: Cartas sueltas · Producto sellado · Gradeadas · Accesorios', () => {
    renderWithIntl(<StoreTabs />, 'es');
    const nav = screen.getByRole('navigation', { name: 'Tienda' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual(['Cartas sueltas', 'Producto sellado', 'Gradeadas', 'Accesorios']);
    expect(links[3]).toHaveAttribute('href', '/accesorios');
  });

  it('en /accesorios (y en la ficha) la pestaña lleva aria-current="page"', () => {
    path.current = '/accesorios/acc-1';
    renderWithIntl(<StoreTabs />, 'en');
    const tab = screen.getByRole('link', { name: 'Accessories' });
    expect(tab).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Sealed product' })).not.toHaveAttribute('aria-current');
  });
});

/** MKT-CONV.8: en < lg cada pestaña es una fila de 44 px; en lg, como antes (`pb-3`, alto automático). */
describe('MKT-CONV.8 · StoreTabs en < lg', () => {
  it('cada enlace mide 44 px de alto en < lg y vuelve a `pb-3` en lg; el nav hace scroll horizontal', () => {
    path.current = '/catalog';
    renderWithIntl(<StoreTabs />, 'es');
    const nav = screen.getByRole('navigation', { name: 'Tienda' });
    expect(nav.className).toContain('overflow-x-auto');
    for (const link of within(nav).getAllByRole('link')) {
      const c = link.className.split(/\s+/);
      expect(c).toEqual(expect.arrayContaining(['flex', 'h-11', 'items-center', 'lg:block', 'lg:h-auto', 'lg:pb-3']));
      expect(c).not.toContain('pb-3');
    }
  });
});
