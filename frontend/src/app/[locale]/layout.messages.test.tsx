import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import es from '../../../messages/es.json';
import en from '../../../messages/en.json';

/**
 * CANDADO PERF portada (§DYN.3, `i18n/message-scopes.ts`): el namespace `admin` (74 % de
 * `es.json`, medido 2026-10-29) NO viaja en el provider raíz, que es el que serializa los
 * mensajes en el HTML de toda la tienda. El back-office los recibe en su propio layout.
 *
 * Canario: volver a `messages={await getMessages()}` en `[locale]/layout.tsx` pone rojo el
 * primer bloque; quitar `AdminMessagesProvider` de `admin/layout.tsx` pone rojo el segundo. La
 * mezcla en cliente la cubre `components/layout/AdminMessagesProvider.test.tsx`.
 */
const captured = vi.hoisted(() => ({ rootMessages: null as Record<string, unknown> | null, locale: 'es' }));
const adminProviderProps = vi.hoisted(() => ({ admin: null as unknown }));

vi.mock('next/font/local', () => ({ default: () => ({ variable: 'v', className: 'c' }) }));
vi.mock('../fonts/google-subsets.css', () => ({}));
vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: () => {} }),
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('next-intl', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('next-intl')),
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
vi.mock('@/components/layout/AdminShell', () => ({
  AdminShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/layout/AdminMessagesProvider', () => ({
  AdminMessagesProvider: ({ admin, children }: { admin: unknown; children: React.ReactNode }) => {
    adminProviderProps.admin = admin;
    return <>{children}</>;
  },
}));

import LocaleLayout from './layout';
import AdminLayout from './(admin)/admin/layout';

beforeEach(() => {
  captured.rootMessages = null;
  adminProviderProps.admin = null;
});

describe('[locale]/layout · mensajes del provider raíz (PERF portada, candado)', () => {
  it.each(['es', 'en'] as const)('%s: manda todos los namespaces de la tienda y NO `admin`', async (locale) => {
    captured.locale = locale;
    const all = (locale === 'en' ? en : es) as Record<string, unknown>;
    renderToStaticMarkup(await LocaleLayout({ children: null, params: Promise.resolve({ locale }) }));
    const sent = captured.rootMessages!;
    expect(sent).not.toBeNull();
    expect(Object.keys(sent)).not.toContain('admin');
    expect(Object.keys(sent).sort()).toEqual(Object.keys(all).filter((k) => k !== 'admin').sort());
    // Lo que el visitante deja de descargar sigue siendo la mayor parte del catálogo.
    expect(JSON.stringify(sent).length).toBeLessThan(JSON.stringify(all).length * 0.5);
  });
});

describe('admin/layout · el back-office recibe `admin` (candado)', () => {
  it('pasa el namespace `admin` completo a AdminMessagesProvider', async () => {
    captured.locale = 'es';
    renderToStaticMarkup(await AdminLayout({ children: null }));
    expect(adminProviderProps.admin).toEqual(es.admin);
  });
});
