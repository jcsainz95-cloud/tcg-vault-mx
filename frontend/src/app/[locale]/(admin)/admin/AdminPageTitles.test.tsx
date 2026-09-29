import { describe, it, expect, vi } from 'vitest';
import type { ComponentType, ReactNode } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import es from '../../../../../messages/es.json';
import en from '../../../../../messages/en.json';

/**
 * # §37.2 (P-66 I2) — el menú del panel rotula por NOMBRE, y cada página se titula igual
 *
 * - **P66-1** ningún rótulo de `admin.modules.*` casa con `/^M\d/` (ni contiene un código M-n).
 * - **P66-2** para cada entrada del menú, el `h1` de su página es `t('admin.modules.<key>')`,
 *   carácter por carácter — una prueba por ruta. (Medido en P-66: difería en 6 de 12.)
 * - **P66-3** `grep -nE '\bM1?[0-9]\b' messages/{es,en}.json` = 0: un texto que dice «se enciende
 *   en M10» cuando el menú ya no dice «M10» manda al operador a buscar algo que no existe.
 * - El menú de §37.2b, en su orden y con sus grupos, y SÚPER donde el dueño lo dejó.
 */

vi.mock('@/lib/role', () => ({
  useRole: () => ({ role: 'super_admin', setRole: () => {}, isSuperAdmin: true, canSwitchRole: false }),
}));

const pathState = vi.hoisted(() => ({ pathname: '/admin' }));
vi.mock('@/i18n/navigation', () => ({
  usePathname: () => pathState.pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  Link: ({ href, children, ...props }: { href: unknown; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...props}>
      {children}
    </a>
  ),
}));

// eslint-disable-next-line import/first
import { AdminSidebar, ADMIN_MENU_ITEMS } from '@/components/layout/AdminSidebar';
// eslint-disable-next-line import/first
import DashboardPage from './page';
// eslint-disable-next-line import/first
import M1Page from './m1/page';
// eslint-disable-next-line import/first
import M2Page from './m2/page';
// eslint-disable-next-line import/first
import M2BountiesPage from './m2/bounties/page';
// eslint-disable-next-line import/first
import M3Page from './m3/page';
// eslint-disable-next-line import/first
import M4Page from './m4/page';
// eslint-disable-next-line import/first
import M5Page from './m5/page';
// eslint-disable-next-line import/first
import M6Page from './m6/page';
// eslint-disable-next-line import/first
import M7Page from './m7/page';
// eslint-disable-next-line import/first
import M8Page from './m8/page';
// eslint-disable-next-line import/first
import M9Page from './m9/page';
// eslint-disable-next-line import/first
import M10Page from './m10/page';
// eslint-disable-next-line import/first
import M11Page from './m11/page';
// eslint-disable-next-line import/first
import M12Page from './m12/page';
// eslint-disable-next-line import/first
import VaultsPage from './vaults/page';

/** La página que sirve cada `href` del menú (la misma que monta el App Router). */
const PAGES: Record<string, ComponentType> = {
  '/admin': DashboardPage,
  '/admin/m1': M1Page,
  '/admin/m2': M2Page,
  '/admin/m2/bounties': M2BountiesPage,
  '/admin/m3': M3Page,
  '/admin/m4': M4Page,
  '/admin/m5': M5Page,
  '/admin/m6': M6Page,
  '/admin/m7': M7Page,
  '/admin/m8': M8Page,
  '/admin/m9': M9Page,
  '/admin/m10': M10Page,
  '/admin/m11': M11Page,
  '/admin/m12': M12Page,
  '/admin/vaults': VaultsPage,
};

const MODULES_ES = es.admin.modules as Record<string, string>;
const MODULES_EN = en.admin.modules as Record<string, string>;
const CODE_RE = /\bM1?[0-9]\b/;

describe('§37.2 · P66-1 — los rótulos del menú no llevan código M-n', () => {
  it.each([
    ['es', MODULES_ES],
    ['en', MODULES_EN],
  ] as const)('%s: ningún `admin.modules.*` empieza por M\\d ni contiene un código', (_locale, modules) => {
    for (const [key, label] of Object.entries(modules)) {
      expect(label, `admin.modules.${key}`).not.toMatch(/^M\d/);
      expect(label, `admin.modules.${key}`).not.toMatch(CODE_RE);
    }
  });
});

describe('§37.2 · P66-3 — barrido de copy: ninguna cadena cita un código M-n', () => {
  it.each(['es', 'en'])('messages/%s.json: `grep -nE "\\bM1?[0-9]\\b"` = 0', (locale) => {
    const raw = readFileSync(resolve(__dirname, `../../../../../messages/${locale}.json`), 'utf8');
    const hits = raw
      .split('\n')
      .map((line, i) => ({ n: i + 1, line }))
      .filter(({ line }) => CODE_RE.test(line))
      .map(({ n, line }) => `${n}: ${line.trim().slice(0, 120)}`);
    expect(hits).toEqual([]);
  });
});

describe('§37.2b — el menú: grupos, orden, nombres y SÚPER', () => {
  const EXPECTED: Array<[group: string | null, href: string, es: string, en: string, superTag: boolean]> = [
    [null, '/admin', 'Resumen', 'Overview', false],
    ['Día a día', '/admin/m5', 'Solicitudes de venta', 'Sell requests', false],
    ['Día a día', '/admin/m3', 'Ventas', 'Sales', false],
    // «Pedidos por preparar»: elección del dueño (HECHOS.md, 2026-09-29) sobre el «Preparar y
    // enviar» que proponía §37.2b. Menú y `h1` salen de la MISMA clave (`admin.modules.m4`).
    ['Día a día', '/admin/m4', 'Pedidos por preparar', 'Orders to prepare', false],
    ['Día a día', '/admin/m8', 'Disputas', 'Disputes', false],
    ['Existencias', '/admin/m1', 'Inventario', 'Inventory', false],
    ['Existencias', '/admin/m11', 'Sellado', 'Sealed', false],
    ['Existencias', '/admin/vaults', 'Bóvedas de clientes', 'Customer vaults', false],
    ['Tienda', '/admin/m2', 'Catálogo y precios', 'Catalog & pricing', true],
    ['Tienda', '/admin/m2/bounties', 'Bounties', 'Bounties', true],
    ['Tienda', '/admin/m12', 'Meta Battle Decks', 'Meta Battle Decks', false],
    ['Administración', '/admin/m7', 'Finanzas', 'Finance', true],
    ['Administración', '/admin/m9', 'Reportes', 'Reports', true],
    ['Administración', '/admin/m6', 'Usuarios', 'Users', true],
    ['Administración', '/admin/m10', 'Configuración', 'Settings', true],
  ];

  it('el orden de las entradas es el de la tabla de §37.2b', () => {
    expect(ADMIN_MENU_ITEMS.map((i) => i.href)).toEqual(EXPECTED.map((e) => e[1]));
  });

  it('en el DOM: «Resumen» sin rótulo de grupo, luego los cuatro grupos en orden, cada entrada con su nombre y SÚPER donde toca', () => {
    pathState.pathname = '/admin';
    renderWithProviders(<AdminSidebar />, 'es');
    const links = screen.getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual(EXPECTED.map((e) => e[1]));
    EXPECTED.forEach(([, href, label, , superTag], i) => {
      const link = links[i];
      expect(link.getAttribute('href')).toBe(href);
      // Nombre primero; «SÚPER» es una segunda etiqueta, no parte del nombre.
      expect(link.firstElementChild?.textContent).toBe(label);
      expect(link.textContent?.includes('Súper')).toBe(superTag);
    });
    // Cabeceras de grupo: exactamente las cuatro, en orden, y ninguna encima de «Resumen».
    const nav = screen.getByRole('navigation');
    const groupLabels = Array.from(nav.querySelectorAll(':scope > div > p')).map((p) => p.textContent);
    expect(groupLabels).toEqual(['Día a día', 'Existencias', 'Tienda', 'Administración']);
    expect(nav.querySelector(':scope > div:first-child > p')).toBeNull();
  });

  it('en inglés, los mismos nombres de la tabla', () => {
    pathState.pathname = '/admin';
    renderWithProviders(<AdminSidebar />, 'en');
    const links = screen.getAllByRole('link');
    EXPECTED.forEach(([, , , label], i) => expect(links[i].firstElementChild?.textContent).toBe(label));
  });
});

describe('§37.2 · P66-2 — el `h1` de cada página es su rótulo del menú, carácter por carácter', () => {
  // En los DOS idiomas: un `h1` que leyera otra clave (o un literal) coincidiría en `es` por
  // casualidad y divergiría en `en` — el candado solo muerde si mide los dos.
  const CASES = (['es', 'en'] as const).flatMap((locale) =>
    ADMIN_MENU_ITEMS.map((i) => [locale, i.href, i.key] as const),
  );
  it.each(CASES)('%s %s', async (locale, href, key) => {
    const Page = PAGES[href];
    expect(Page, `falta la página de ${href} en el mapa del candado`).toBeDefined();
    pathState.pathname = href;
    renderWithProviders(<Page />, locale);
    const h1 = await screen.findByRole('heading', { level: 1 });
    expect(h1.textContent).toBe((locale === 'es' ? MODULES_ES : MODULES_EN)[key]);
  });
});

describe('§37.2d — Reportes: «Actividad de la tienda», sin «beta cerrada» ni metas N/X/Y/Z', () => {
  it('los tres textos de la tabla, en es y en', () => {
    expect(es.admin.m9.metrics.title).toBe('Actividad de la tienda');
    expect(es.admin.m9.metrics.subtitle).toBe('Conteos en el rango de fechas elegido.');
    expect(es.admin.m9.goalsUnset).toBe('Todavía no hay metas fijadas: se muestran solo los conteos.');
    expect(en.admin.m9.metrics.title).toBe('Store activity');
    expect(en.admin.m9.metrics.subtitle).toBe('Counts for the selected date range.');
    expect(en.admin.m9.goalsUnset).toBe('No goals set yet: showing counts only.');
    const all = JSON.stringify(es.admin.m9) + JSON.stringify(en.admin.m9);
    expect(all).not.toMatch(/beta cerrada|closed.beta|N\/X\/Y\/Z/i);
  });
});
