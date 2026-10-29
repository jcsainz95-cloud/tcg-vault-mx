import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider, useTranslations } from 'next-intl';
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
});
