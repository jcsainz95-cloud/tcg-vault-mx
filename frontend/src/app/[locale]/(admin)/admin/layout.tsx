import { getMessages } from 'next-intl/server';
import { AdminShell } from '@/components/layout/AdminShell';
import { AdminMessagesProvider } from '@/components/layout/AdminMessagesProvider';
import { adminMessagesOf } from '@/i18n/message-scopes';

/**
 * El layout raíz NO manda el namespace `admin` al cliente (PERF portada, `i18n/message-scopes.ts`);
 * el back-office lo recibe aquí.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const messages = await getMessages();
  return (
    <AdminMessagesProvider admin={adminMessagesOf(messages)}>
      <AdminShell>{children}</AdminShell>
    </AdminMessagesProvider>
  );
}
