import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider, useFormatter, useNow, useTranslations } from 'next-intl';
import es from '../../../messages/es.json';
import { storefrontMessages } from '@/i18n/message-scopes';
import { AdminMessagesProvider } from './AdminMessagesProvider';

/**
 * El provider raíz ya no trae `admin` (PERF portada). Bajo `AdminMessagesProvider` deben resolver
 * a la vez los textos del back-office y los de la tienda (un provider anidado REEMPLAZA los
 * mensajes del padre; si no mezclara, el chrome del admin perdería `common`, `nav`…).
 */
function Probe() {
  const tAdmin = useTranslations('admin');
  const tCommon = useTranslations('common');
  return (
    <p>
      {tAdmin('authLoading')}|{tCommon('appName')}
    </p>
  );
}

describe('AdminMessagesProvider · mezcla en cliente', () => {
  it('resuelven `admin.*` y los namespaces de la tienda', () => {
    render(
      <NextIntlClientProvider locale="es" timeZone="America/Mexico_City" messages={storefrontMessages(es)}>
        <AdminMessagesProvider admin={es.admin}>
          <Probe />
        </AdminMessagesProvider>
      </NextIntlClientProvider>,
    );
    expect(screen.getByText(`${es.admin.authLoading}|${es.common.appName}`)).toBeInTheDocument();
  });

  it('sin él, `admin` NO está bajo el provider raíz (lo que recibe la tienda)', () => {
    const errors: string[] = [];
    render(
      <NextIntlClientProvider
        locale="es"
        timeZone="America/Mexico_City"
        messages={storefrontMessages(es)}
        onError={(e) => errors.push(e.code)}
      >
        <Probe />
      </NextIntlClientProvider>,
    );
    expect(errors).toContain('MISSING_MESSAGE');
  });

  /**
   * TL-DYN3-3: el provider solo reenvía `locale` y `timeZone`; lo demás de la raíz (`formats`, `onError`,
   * `getMessageFallback`, `now`) lo hereda el `IntlProvider` anidado de use-intl (`prevContext`, use-intl 4.x
   * `react.js` `formats: formats === undefined ? prevContext?.formats : formats`). Si una actualización de la
   * librería deja de heredar, esto se pone rojo.
   */
  it('TL-DYN3-3 · `formats`, `onError`, `getMessageFallback` y `now` de la raíz resuelven bajo el provider', () => {
    const errors: string[] = [];
    const NOW = new Date('2026-10-29T12:00:00Z');
    function FormatProbe() {
      const format = useFormatter();
      const t = useTranslations('admin');
      return (
        <p>
          {format.number(0.256, 'pct1')}|{t('noExiste' as never)}|{useNow().toISOString()}
        </p>
      );
    }
    const { container } = render(
      <NextIntlClientProvider
        locale="es"
        timeZone="America/Mexico_City"
        messages={storefrontMessages(es)}
        formats={{ number: { pct1: { style: 'percent', maximumFractionDigits: 1 } } }}
        onError={(e) => errors.push(e.code)}
        getMessageFallback={({ key }) => `fallback:${key}`}
        now={NOW}
      >
        <AdminMessagesProvider admin={es.admin}>
          <FormatProbe />
        </AdminMessagesProvider>
      </NextIntlClientProvider>,
    );
    const pct = new Intl.NumberFormat('es', { style: 'percent', maximumFractionDigits: 1 }).format(0.256);
    expect(container.textContent).toBe(`${pct}|fallback:noExiste|${NOW.toISOString()}`);
    expect(errors).toEqual(['MISSING_MESSAGE']);
  });
});
