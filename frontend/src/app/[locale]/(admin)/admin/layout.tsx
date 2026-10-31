import { getMessages } from 'next-intl/server';
import { AdminShell } from '@/components/layout/AdminShell';
import { AdminMessagesProvider } from '@/components/layout/AdminMessagesProvider';
import { adminMessagesOf } from '@/i18n/message-scopes';
import { RouteMessages } from '@/components/i18n/RouteMessages';

/**
 * El layout raíz manda solo `SHELL` (PERF portada, `i18n/message-scopes.ts`); el back-office recibe aquí el ámbito
 * `storefront` (sus pantallas comparten componentes con la tienda) y además `admin`.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const messages = await getMessages();
  return (
    <RouteMessages scope="storefront">
      <AdminMessagesProvider admin={adminMessagesOf(messages)}>
        <AdminShell>{children}</AdminShell>
      </AdminMessagesProvider>
    </RouteMessages>
  );
}
