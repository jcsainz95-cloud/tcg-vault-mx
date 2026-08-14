import { render } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import es from '../../messages/es.json';
import en from '../../messages/en.json';

const messages = { es, en } as const;

export function renderWithIntl(ui: ReactElement, locale: 'es' | 'en' = 'es') {
  return render(
    <NextIntlClientProvider locale={locale} messages={messages[locale]}>
      {ui}
    </NextIntlClientProvider>,
  );
}

/** Render con NextIntl + TanStack Query (para componentes que consumen la API). */
export function renderWithProviders(ui: ReactElement, locale: 'es' | 'en' = 'es') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale={locale} messages={messages[locale]}>
        {ui}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}
