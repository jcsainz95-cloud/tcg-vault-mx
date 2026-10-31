import { describe, it, expect, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import es from '../../../../../messages/es.json';
import { Paginator } from './Paginator';
import { catalogPageHref, parseUrlFilters } from '../catalog/catalog-url';

/**
 * C2 (BRIEF_MKT Ola 2, criterio 950) — la paginación del catálogo es rastreable: en el HTML del SERVIDOR las flechas
 * habilitadas son `<a href="…?page=n">`; el clic normal sigue paginando en el cliente (sin navegar) y `?page=` se lee
 * de la URL. El HTML crudo contra el stack real lo cubre `e2e/seo-raw-html.spec.ts`; el seed sembrado tiene menos de
 * 20 grupos y no pagina, por eso el `<a href>` del paginador se fija aquí.
 *
 * Mutación que lo pone rojo: quitar `hrefFor` del `CatalogView` (o la rama `<Link>` del Paginator) ⇒ 0 `href`.
 */

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={`/es${href}`} {...props}>
      {children}
    </a>
  ),
}));

function wrap(node: React.ReactNode) {
  return (
    <NextIntlClientProvider locale="es" messages={es}>
      {node}
    </NextIntlClientProvider>
  );
}

describe('C2 · Paginator rastreable', () => {
  it('en el HTML del servidor la flecha habilitada es un <a href> a ?page=n; la deshabilitada, un botón', () => {
    const html = renderToString(
      wrap(<Paginator page={1} totalPages={3} onPage={() => {}} hrefFor={(p) => catalogPageHref({}, p)} />),
    );
    expect(html).toContain('href="/es/catalog?page=2"');
    expect(html).not.toContain('href="/es/catalog?page=0"');
    expect(html).toMatch(/<button[^>]*disabled/);
  });

  it('la página 2 enlaza a la 1 SIN parámetro (una sola URL por página) y a la 3', () => {
    const html = renderToString(
      wrap(<Paginator page={2} totalPages={3} onPage={() => {}} hrefFor={(p) => catalogPageHref({}, p)} />),
    );
    expect(html).toContain('href="/es/catalog"');
    expect(html).toContain('href="/es/catalog?page=3"');
  });

  it('el clic normal pagina en el cliente (sin seguir el enlace); con Ctrl, el navegador sigue el enlace', () => {
    const onPage = vi.fn();
    render(wrap(<Paginator page={1} totalPages={3} onPage={onPage} hrefFor={(p) => catalogPageHref({}, p)} />));
    const next = screen.getByRole('link', { name: es.catalog.pagination.next });
    // Se registra si la vista canceló la navegación y, después, se cancela siempre (jsdom no navega).
    const prevented: boolean[] = [];
    const spy = (e: MouseEvent) => {
      prevented.push(e.defaultPrevented);
      e.preventDefault();
    };
    document.addEventListener('click', spy);
    fireEvent.click(next);
    expect(prevented).toEqual([true]);
    expect(onPage).toHaveBeenCalledWith(2);
    onPage.mockClear();
    fireEvent.click(next, { ctrlKey: true });
    expect(prevented).toEqual([true, false]);
    expect(onPage).not.toHaveBeenCalled();
    document.removeEventListener('click', spy);
  });

  it('sin hrefFor sigue siendo de botones (Sellado, Accesorios)', () => {
    const html = renderToString(wrap(<Paginator page={1} totalPages={3} onPage={() => {}} />));
    expect(html).not.toContain('href=');
  });

  it('catalogPageHref lleva los filtros (MK-D5) y conserva lo ajeno; parseUrlFilters lee ?page= ≥ 2 y descarta basura', () => {
    // MK-D5: el href sale de los FILTROS (la pestaña Gradeadas se escribe en su forma canónica `productType=graded`).
    const sp = new URLSearchParams('type=graded&page=4&utm_source=x');
    expect(catalogPageHref(parseUrlFilters(sp), 2, sp)).toBe('/catalog?utm_source=x&productType=graded&page=2');
    expect(catalogPageHref(parseUrlFilters(sp), 1, sp)).toBe('/catalog?utm_source=x&productType=graded');
    expect(parseUrlFilters(new URLSearchParams('page=3')).page).toBe(3);
    for (const bad of ['1', '0', '-2', 'abc', '2.5', '9999999']) {
      expect(parseUrlFilters(new URLSearchParams(`page=${bad}`)).page).toBeUndefined();
    }
  });
});
