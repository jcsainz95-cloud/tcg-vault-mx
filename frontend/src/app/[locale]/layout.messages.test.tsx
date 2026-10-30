import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isValidElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import es from '../../../messages/es.json';
import en from '../../../messages/en.json';
import { ADMIN_NAMESPACE, HOME_NAMESPACES, SHELL_NAMESPACES } from '@/i18n/message-scopes';
import { RouteMessages } from '@/components/i18n/RouteMessages';
import { ScopedMessagesProvider } from '@/components/i18n/ScopedMessagesProvider';
import { clientNamespaces } from '@/test/i18n-closure';
import { stripComments } from '@/test/strip-comments';

/**
 * 🔒 DYN-F10 (a) y (c) · API_CONTRACT §DYN.6.7, ARCHITECTURE §4.DYN (f) 8 — los textos de traducción viajan POR RUTA.
 *
 * `NextIntlClientProvider` serializa sus mensajes en el HTML. La raíz manda solo `SHELL`; la portada añade `home`; el
 * resto de páginas `storefront` (= todo − `admin` − `SHELL`); el panel `storefront` + `admin`. Lo que se fija:
 *  (a) por idioma (es, en): la raíz manda EXACTAMENTE `SHELL_NAMESPACES`; la portada añade EXACTAMENTE `home`; `admin`
 *      no va ni en la raíz ni en la portada ni en `storefront`; lo serializado para la portada (raíz + `home`) pesa ≤
 *      `HOME_MESSAGES_MAX_BYTES`. Y las dos listas se MIDEN contra el código (`test/i18n-closure.ts`): son exactamente
 *      los namespaces que piden los módulos de cliente de los layouts (`SHELL`) y de la portada (`home`), menos los
 *      falsos positivos nombrados abajo.
 *  (c) estático: toda `page.tsx` bajo `app/[locale]` fuera de `(admin)` tiene EXACTAMENTE un `RouteMessages`, en ella o
 *      en un layout entre ella y `[locale]/layout`; el único con ámbito `home` es la portada; `(storefront)/layout`
 *      no lleva ninguno (contiene la portada).
 * La (b) (render con solo los mensajes del ámbito ⇒ 0 `MISSING_MESSAGE`) vive en
 * `components/i18n/RouteMessages.render.test.tsx`; la (d), en `e2e/route-messages.spec.ts`.
 * Mutaciones medidas (FRONTEND_NOTES §DYN): quitar de `home` un namespace que usa la portada; quitar el `RouteMessages`
 * de una página; volver a mandar todo menos `admin` desde la raíz.
 */

/**
 * Trinquete en bytes (`JSON.stringify` de raíz + `home`, el idioma más pesado). Medido 2026-10-30 sobre `0d40d0b7`+A+c1:
 * es 47 354 B (en 45 819 B); antes de c1 la raíz mandaba todo menos `admin`: es 102 316 B. Subirlo exige decir por qué
 * en FRONTEND_NOTES §DYN.
 */
const HOME_MESSAGES_MAX_BYTES = 48_500;

/**
 * Falsos positivos de la medición estática (literales `'<ns>.<clave>'` que NO se traducen en la portada):
 *  - `admin`, `checkout`: `lib/error-audience.ts` lista claves PROHIBIDAS (`admin.m5.transition.*`,
 *    `checkout.retry.*`) para su candado; no las pinta nadie.
 */
const HOME_STATIC_FALSE_POSITIVES = new Set(['admin', 'checkout']);

const captured = vi.hoisted(() => ({ rootMessages: null as Record<string, unknown> | null, locale: 'es' }));

vi.mock('next/font/local', () => ({ default: () => ({ variable: 'v', className: 'c' }) }));
vi.mock('../fonts/google-subsets.css', () => ({}));
vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: () => {} }),
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('next-intl', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('next-intl')),
  // En el servidor `RouteMessages` lee el catálogo de la petición con `useMessages()` (condición react-server).
  useMessages: () => (captured.locale === 'en' ? en : es),
  NextIntlClientProvider: ({ children, messages }: { children: React.ReactNode; messages: Record<string, unknown> }) => {
    captured.rootMessages = messages;
    return <>{children}</>;
  },
}));
vi.mock('next-intl/server', () => ({
  getMessages: async () => (captured.locale === 'en' ? en : es),
  getTranslations: async () => (key: string) => key,
}));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('@/lib/home-ssr', () => ({ loadHomeForSSR: async () => ({ featured: null, gems: null }) }));
vi.mock('@/components/layout/AdminShell', () => ({
  AdminShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import LocaleLayout from './layout';
import HomePage from './(storefront)/page';
import AdminLayout from './(admin)/admin/layout';

type Messages = Record<string, unknown>;

/** Lo que manda un `<RouteMessages scope>`: lo resuelve como lo haría el servidor y lee la prop del proveedor. */
async function sentBy(el: unknown, scope: 'home' | 'storefront'): Promise<Messages> {
  expect(isValidElement(el)).toBe(true);
  const route = el as ReactElement<{ scope: string; children: React.ReactNode }>;
  expect(route.type).toBe(RouteMessages);
  expect(route.props.scope).toBe(scope);
  const provider = RouteMessages(route.props as Parameters<typeof RouteMessages>[0]) as ReactElement<{
    messages: Messages;
  }>;
  expect(provider.type).toBe(ScopedMessagesProvider);
  return provider.props.messages;
}

beforeEach(() => {
  captured.rootMessages = null;
});

describe('DYN-F10 (a) · qué manda cada nivel (es y en)', () => {
  it.each(['es', 'en'] as const)('%s: la raíz manda EXACTAMENTE SHELL_NAMESPACES', async (locale) => {
    captured.locale = locale;
    renderToStaticMarkup(await LocaleLayout({ children: null, params: Promise.resolve({ locale }) }));
    const sent = captured.rootMessages!;
    expect(Object.keys(sent).sort()).toEqual([...SHELL_NAMESPACES].sort());
    expect(Object.keys(sent)).not.toContain(ADMIN_NAMESPACE);
  });

  it.each(['es', 'en'] as const)('%s: la portada añade EXACTAMENTE `home`, sin `admin`, y pesa ≤ el trinquete', async (locale) => {
    captured.locale = locale;
    renderToStaticMarkup(await LocaleLayout({ children: null, params: Promise.resolve({ locale }) }));
    const root = captured.rootMessages!;
    const home = await sentBy(await HomePage(), 'home');
    const shell = new Set<string>(SHELL_NAMESPACES);
    expect(Object.keys(home).sort()).toEqual(HOME_NAMESPACES.filter((ns) => !shell.has(ns)).sort());
    expect(Object.keys(home)).not.toContain(ADMIN_NAMESPACE);
    const all = (locale === 'en' ? en : es) as Messages;
    for (const ns of Object.keys(home)) expect(home[ns]).toEqual(all[ns]);
    const bytes = JSON.stringify(root).length + JSON.stringify(home).length;
    expect(bytes).toBeLessThanOrEqual(HOME_MESSAGES_MAX_BYTES);
  });

  it.each(['es', 'en'] as const)('%s: el panel recibe `storefront` (todo − admin − SHELL) y además `admin`', async (locale) => {
    captured.locale = locale;
    const all = (locale === 'en' ? en : es) as Messages;
    const el = await AdminLayout({ children: null });
    const storefront = await sentBy(el, 'storefront');
    const shell = new Set<string>(SHELL_NAMESPACES);
    expect(Object.keys(storefront).sort()).toEqual(
      Object.keys(all)
        .filter((k) => k !== ADMIN_NAMESPACE && !shell.has(k))
        .sort(),
    );
    const adminProvider = (el as ReactElement<{ children: ReactElement<{ admin: unknown }> }>).props.children;
    expect(adminProvider.props.admin).toEqual(all.admin);
  });
});

describe('DYN-F10 (a) · las listas se MIDEN contra el código de cliente', () => {
  const known = Object.keys(es);

  it('SHELL = lo que piden los módulos de cliente de `[locale]/layout`, `[locale]/error` y `(storefront)/layout`', () => {
    const { used } = clientNamespaces(
      ['app/[locale]/layout.tsx', 'app/[locale]/error.tsx', 'app/[locale]/(storefront)/layout.tsx'],
      known,
    );
    expect([...used.keys()].sort()).toEqual([...SHELL_NAMESPACES].sort());
  });

  it('home = lo que piden los módulos de cliente de la portada, menos SHELL y los falsos positivos nombrados', () => {
    const { used } = clientNamespaces(['app/[locale]/(storefront)/page.tsx'], known);
    const shell = new Set<string>(SHELL_NAMESPACES);
    const measured = [...used.keys()].filter((ns) => !shell.has(ns) && !HOME_STATIC_FALSE_POSITIVES.has(ns));
    expect(measured.sort()).toEqual([...HOME_NAMESPACES].sort());
    // Los falsos positivos siguen siéndolo: si dejan de aparecer, se quitan de la lista (no se acumulan).
    for (const fp of HOME_STATIC_FALSE_POSITIVES) expect(used.has(fp), fp).toBe(true);
  });
});

describe('DYN-F10 (c) · un RouteMessages por página (estático)', () => {
  const LOCALE_DIR = join(__dirname);
  const routeMessagesIn = (file: string) => {
    let code: string;
    try {
      code = stripComments(readFileSync(file, 'utf8'), file);
    } catch {
      return [] as string[];
    }
    return [...code.matchAll(/<RouteMessages\s+scope="([a-z]+)"/g)].map((m) => m[1]);
  };
  const pages: string[] = [];
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) {
        if (f !== '(admin)') walk(p);
      } else if (f === 'page.tsx') pages.push(p);
    }
  };
  walk(LOCALE_DIR);

  it('hay páginas que mirar (no pasa en verde por no mirar)', () => {
    expect(pages.length).toBeGreaterThan(30);
  });

  it('cada page.tsx fuera de (admin) tiene EXACTAMENTE uno, en ella o en un layout por encima (sin contar la raíz)', () => {
    const wrong: string[] = [];
    for (const page of pages) {
      const scopes = [...routeMessagesIn(page)];
      for (let dir = dirname(page); dir !== LOCALE_DIR; dir = dirname(dir)) {
        scopes.push(...routeMessagesIn(join(dir, 'layout.tsx')));
      }
      if (scopes.length !== 1) wrong.push(`${relative(LOCALE_DIR, page)}: ${scopes.length}`);
    }
    expect(wrong).toEqual([]);
  });

  it('el único `home` es la portada; `(storefront)/layout` y la raíz no llevan ninguno', () => {
    const homes = pages.filter((p) => routeMessagesIn(p).includes('home')).map((p) => relative(LOCALE_DIR, p));
    expect(homes).toEqual(['(storefront)/page.tsx']);
    expect(routeMessagesIn(join(LOCALE_DIR, '(storefront)/layout.tsx'))).toEqual([]);
    expect(routeMessagesIn(join(LOCALE_DIR, 'layout.tsx'))).toEqual([]);
  });
});
