import { useMessages } from 'next-intl';
import { scopeMessages, type MessageScope } from '@/i18n/message-scopes';
import { ScopedMessagesProvider } from './ScopedMessagesProvider';

/**
 * §DYN.6.7 (c1), ARCHITECTURE §4.DYN (f) 8 — componente de SERVIDOR: añade a la página los namespaces de su ámbito
 * (`home` en la portada; `storefront` en el resto) sobre los de `SHELL` que manda la raíz.
 *
 * En el servidor, `useMessages()` de next-intl (condición `react-server`) lee el catálogo COMPLETO de la petición
 * (`i18n/request.ts`), no el provider; es el mismo origen que `getMessages()`, en versión síncrona para que una
 * página o un layout sin `async` lo puedan pintar.
 *
 * Va en la página o en el layout más cercano que no contenga la portada; ⛔ nunca en `(storefront)/layout`. Por
 * segmento y no por `pathname` en la raíz: la raíz no se vuelve a pintar en una navegación de cliente (portada →
 * catálogo se quedaría con los textos de la portada); el RSC de la página nueva sí trae su ámbito.
 * Exactamente UNO entre cada `page.tsx` y `[locale]/layout` (candado DYN-F10 c en `layout.messages.test.tsx`).
 */
export function RouteMessages({ scope, children }: { scope: MessageScope; children: React.ReactNode }) {
  const messages = scopeMessages(useMessages(), scope);
  return <ScopedMessagesProvider messages={messages}>{children}</ScopedMessagesProvider>;
}
