import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import es from '../../../messages/es.json';
import en from '../../../messages/en.json';
import { scopeMessages, shellMessages, type MessageScope } from '@/i18n/message-scopes';
import { ScopedMessagesProvider } from './ScopedMessagesProvider';
import { setStoredUser } from '@/lib/session';
import { setToken } from '@/lib/api-client';
import * as api from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';

/**
 * 🔒 DYN-F10 (b) · API_CONTRACT §DYN.6.7 — renderizados SOLO con los mensajes de su ámbito, como los recibe el
 * navegador (raíz = `SHELL`; la portada además `home`, por `ScopedMessagesProvider`), la portada, el encabezado de la
 * tienda y `[locale]/error` dan **0 `MISSING_MESSAGE`**, en es y en. La tienda no tiene `not-found.tsx` ni `loading.tsx`
 * propios (la 404 es la de Next, sin textos nuestros; medido 2026-10-30 con `find app -name 'not-found.tsx'`).
 * El control (último caso) demuestra que la sonda ve: la portada con SOLO `SHELL` sí da `MISSING_MESSAGE`.
 * Mutación medida: quitar de `HOME_NAMESPACES` un namespace que usa la portada ⇒ rojo aquí y en (a).
 */
vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import { HomeView } from '@/app/[locale]/(storefront)/HomeView';
import { StorefrontHeader } from '@/components/layout/StorefrontHeader';
import LocaleError from '@/app/[locale]/error';

const CATALOG = { es, en } as const;

function renderScoped(ui: ReactElement, locale: 'es' | 'en', scope: MessageScope | null) {
  const errors: string[] = [];
  const all = CATALOG[locale] as unknown as AbstractIntlMessages;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const utils = render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider
        locale={locale}
        timeZone="America/Mexico_City"
        messages={shellMessages(all)}
        onError={(e) => errors.push(`${e.code}: ${e.message}`)}
        getMessageFallback={({ key, namespace }) => `${namespace ?? ''}.${key}`}
      >
        {scope ? <ScopedMessagesProvider messages={scopeMessages(all, scope)}>{ui}</ScopedMessagesProvider> : ui}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  const missing = () => errors.filter((e) => e.startsWith('MISSING_MESSAGE'));
  return { ...utils, missing };
}

const settle = () => new Promise((r) => setTimeout(r, 80));

beforeEach(() => {
  setToken(null);
  setStoredUser(null);
  window.localStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

describe('DYN-F10 (b) · cada vista con solo los mensajes de su ámbito ⇒ 0 MISSING_MESSAGE', () => {
  it.each(['es', 'en'] as const)('%s: portada (anónima, con datos) con SHELL + home', async (locale) => {
    const { missing } = renderScoped(<HomeView />, locale, 'home');
    await screen.findByText(locale === 'es' ? 'Piezas destacadas' : 'Featured pieces');
    await settle();
    expect(missing()).toEqual([]);
  });

  it.each(['es', 'en'] as const)('%s: portada con sesión (banda de portafolio)', async (locale) => {
    setStoredUser({ id: 'u-1', email: 'ash@example.com', name: 'Ash', role: 'customer', locale });
    setToken('t');
    const { missing } = renderScoped(<HomeView />, locale, 'home');
    await settle();
    await settle();
    expect(missing()).toEqual([]);
  });

  it.each(['es', 'en'] as const)('%s: portada con el API caído (estados de error de los estantes)', async (locale) => {
    const boom = () => Promise.reject(new ApiClientError(503, { code: 'SERVICE_UNAVAILABLE', message: 'down' } as never));
    vi.spyOn(api, 'getFeatured').mockImplementation(boom);
    vi.spyOn(api, 'getCatalog').mockImplementation(boom);
    vi.spyOn(api, 'getSealedGroups').mockImplementation(boom);
    const { missing } = renderScoped(<HomeView />, locale, 'home');
    await settle();
    await settle();
    expect(missing()).toEqual([]);
  });

  it.each(['es', 'en'] as const)('%s: encabezado de la tienda (anónimo y con sesión) con solo SHELL', async (locale) => {
    const anon = renderScoped(<StorefrontHeader />, locale, null);
    await settle();
    expect(anon.missing()).toEqual([]);
    anon.unmount();
    setStoredUser({ id: 'u-1', email: 'ash@example.com', name: 'Ash', role: 'customer', locale });
    setToken('t');
    const authed = renderScoped(<StorefrontHeader />, locale, null);
    await settle();
    expect(authed.missing()).toEqual([]);
  });

  it.each(['es', 'en'] as const)('%s: [locale]/error con solo SHELL', async (locale) => {
    const { missing } = renderScoped(<LocaleError error={new Error('x')} reset={() => undefined} />, locale, null);
    await settle();
    expect(missing()).toEqual([]);
  });

  it('control: la portada con SOLO SHELL sí da MISSING_MESSAGE (la sonda ve)', async () => {
    const { missing } = renderScoped(<HomeView />, 'es', null);
    await settle();
    expect(missing().length).toBeGreaterThan(0);
  });
});
