'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, X } from 'lucide-react';
import { RoleProvider } from '@/lib/role';
import { useSession } from '@/lib/session';
import { usePathname, useRouter } from '@/i18n/navigation';
import { config } from '@/lib/config';
import { AdminSidebar } from './AdminSidebar';
import { AdminTopbar } from './AdminTopbar';

export function AdminShell({ children }: { children: React.ReactNode }) {
  const [drawer, setDrawer] = useState(false);
  const t = useTranslations('admin');
  const { isAuthenticated, ready } = useSession();
  const router = useRouter();
  const pathname = usePathname();

  // En modo real el back-office EXIGE sesión autenticada (el backend deriva el rol
  // del JWT y rechaza con 401 si no hay sesión). En modo mock/demo se deja pasar
  // para poder navegar el back-office sin backend (comportamiento de demostración).
  const requireAuth = !config.useMocks;

  useEffect(() => {
    if (!requireAuth) return;
    if (ready && !isAuthenticated) {
      // Preserva el destino con `next` para volver tras el login; el router de
      // next-intl conserva el locale.
      router.replace({ pathname: '/login', query: { next: pathname } });
    }
  }, [requireAuth, ready, isAuthenticated, router, pathname]);

  // Mientras no sepamos si hay sesión (o si falta) mostramos carga, NUNCA el
  // contenido del back-office (evita el super_admin falso + 401 confuso).
  if (requireAuth && (!ready || !isAuthenticated)) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-bg" aria-busy="true">
        <span className="inline-flex items-center gap-2 font-mono text-sm text-muted">
          <Loader2 size={16} className="animate-spin" aria-hidden />
          {t('authLoading')}
        </span>
      </div>
    );
  }

  return (
    <RoleProvider>
      <div className="flex min-h-dvh bg-bg">
        {/* Sidebar fijo desde lg. Dirección 5a: panel de tinta, sin iconos. */}
        <aside className="hidden w-64 shrink-0 bg-ink lg:block">
          <SidebarBrand />
          <AdminSidebar />
        </aside>

        {/* Drawer móvil */}
        {drawer && (
          <div className="fixed inset-0 z-40 lg:hidden" onClick={() => setDrawer(false)}>
            <div className="absolute inset-0 bg-[rgba(26,26,24,.55)]" />
            <aside
              className="absolute left-0 top-0 h-full w-64 overflow-y-auto bg-ink"
              onClick={(e) => e.stopPropagation()}
            >
              <SidebarBrand onClose={() => setDrawer(false)} />
              <AdminSidebar onNavigate={() => setDrawer(false)} />
            </aside>
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <AdminTopbar onMenu={() => setDrawer(true)} />
          <main className="flex-1 px-5 py-8 lg:px-10">{children}</main>
        </div>
      </div>
    </RoleProvider>
  );
}

function SidebarBrand({ onClose }: { onClose?: () => void }) {
  const t = useTranslations('admin');
  return (
    <div className="flex h-16 items-center gap-2.5 border-b border-on-ink-rule px-[22px]">
      <span aria-hidden className="block h-[18px] w-[18px] shrink-0 bg-accent" />
      <span className="text-[13px] font-medium uppercase tracking-label text-on-ink">
        {t('shellTitle')}
      </span>
      {onClose && (
        <button onClick={onClose} aria-label="Close" className="ml-auto p-1 text-on-ink-nav">
          <X size={18} />
        </button>
      )}
    </div>
  );
}
