import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithIntl } from '@/test/render';

/**
 * TL-MKT3-2 (techlead sobre `e066b0b5`): la pestaña «Gradeadas» emitía `?type=graded`, un alias que el panel no
 * escribe (el panel escribe `productType=graded`): dos URLs para la misma vista. Ahora la pestaña emite el parámetro del
 * panel; el alias `type` solo se sigue LEYENDO (enlaces guardados), y también activa la pestaña.
 * Mutación que lo pone rojo: volver a `href: '/catalog?type=graded'`.
 */
const { path, query } = vi.hoisted(() => ({ path: { current: '/catalog' }, query: { current: '' } }));
vi.mock('@/i18n/navigation', () => ({
  usePathname: () => path.current,
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(query.current) }));

import { StoreTabs } from './StoreTabs';

describe('TL-MKT3-2 · la pestaña Gradeadas usa productType=graded', () => {
  it('el enlace es /catalog?productType=graded', () => {
    renderWithIntl(<StoreTabs />, 'es');
    expect(screen.getByRole('link', { name: 'Gradeadas' })).toHaveAttribute('href', '/catalog?productType=graded');
  });

  for (const q of ['productType=graded', 'type=graded']) {
    it(`?${q} marca «Gradeadas» como activa y no «Cartas sueltas»`, () => {
      query.current = q;
      renderWithIntl(<StoreTabs />, 'es');
      expect(screen.getByRole('link', { name: 'Gradeadas' })).toHaveAttribute('aria-current', 'page');
      expect(screen.getByRole('link', { name: 'Cartas sueltas' })).not.toHaveAttribute('aria-current');
    });
  }
});
