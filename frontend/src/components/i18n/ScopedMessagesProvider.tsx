'use client';

import { useMemo } from 'react';
import {
  NextIntlClientProvider,
  useLocale,
  useMessages,
  useTimeZone,
  type AbstractIntlMessages,
} from 'next-intl';

/**
 * §DYN.6.7 (c1) — funde los namespaces del ámbito de un segmento con los que ya trae el provider padre (la raíz manda
 * solo `SHELL`, ver `i18n/message-scopes.ts`). Un `NextIntlClientProvider` anidado REEMPLAZA los mensajes del padre,
 * no los mezcla; por eso se mezcla aquí, en el cliente, y el servidor serializa solo el ámbito. Mismo patrón que
 * `AdminMessagesProvider`: `formats`, `onError`, `getMessageFallback` y `now` NO se reenvían porque el `IntlProvider`
 * de use-intl los hereda del padre cuando la prop falta (candado TL-DYN3-3 en `AdminMessagesProvider.test.tsx`).
 */
export function ScopedMessagesProvider({
  messages: scoped,
  children,
}: {
  messages: AbstractIntlMessages;
  children: React.ReactNode;
}) {
  const parent = useMessages();
  const locale = useLocale();
  const timeZone = useTimeZone();
  const messages = useMemo(() => ({ ...parent, ...scoped }), [parent, scoped]);
  return (
    <NextIntlClientProvider locale={locale} timeZone={timeZone} messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}
