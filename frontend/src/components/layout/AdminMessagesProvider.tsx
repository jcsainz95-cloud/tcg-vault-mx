'use client';

import { useMemo } from 'react';
import {
  NextIntlClientProvider,
  useLocale,
  useMessages,
  useTimeZone,
  type AbstractIntlMessages,
} from 'next-intl';
import { ADMIN_NAMESPACE } from '@/i18n/message-scopes';

/**
 * Añade el namespace `admin` a los mensajes que ya trae el provider raíz (que lo omite: ver
 * `i18n/message-scopes.ts`). Un `NextIntlClientProvider` anidado REEMPLAZA los mensajes del
 * padre, no los mezcla; por eso se mezcla aquí, en el cliente, y el servidor solo serializa
 * `admin` una vez en las páginas del back-office.
 */
export function AdminMessagesProvider({
  admin,
  children,
}: {
  admin: AbstractIntlMessages;
  children: React.ReactNode;
}) {
  const parent = useMessages();
  const locale = useLocale();
  const timeZone = useTimeZone();
  const messages = useMemo(() => ({ ...parent, [ADMIN_NAMESPACE]: admin }), [parent, admin]);
  return (
    <NextIntlClientProvider locale={locale} timeZone={timeZone} messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}
