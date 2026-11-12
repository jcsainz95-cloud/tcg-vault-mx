'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { logout } from '@/lib/api';
import { isLogoutInProgress, useSession } from '@/lib/session';
import { cn } from '@/lib/cn';
import { SupplierBrandBar } from './SupplierBrandBar';

const TABS = [
  { href: '/proveedores', key: 'requests' },
  { href: '/proveedores/ofertas', key: 'offers' },
  { href: '/proveedores/acuerdos', key: 'purchases' },
] as const;

/** Marco del portal: exige sesión con rol `supplier`; cualquier otro rol/ausencia sale a `/proveedores/entrar`. */
export function SupplierShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations('supplier');
  const { user, isAuthenticated, ready } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const ok = isAuthenticated && user?.role === 'supplier';

  useEffect(() => {
    if (!ready || ok || isLogoutInProgress()) return;
    router.replace('/proveedores/entrar');
  }, [ready, ok, router]);

  if (!ready || !ok) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-bg" aria-busy="true">
        <span className="inline-flex items-center gap-2 font-mono text-sm text-muted">
          <Loader2 size={16} className="animate-spin" aria-hidden />
          {t('loading')}
        </span>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-bg">
      <SupplierBrandBar>
        <button
          type="button"
          className="min-h-[44px] font-mono text-[11px] uppercase tracking-eyebrow text-on-ink underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-on-ink"
          onClick={async () => {
            await logout();
            router.replace('/proveedores/entrar');
          }}
        >
          {t('nav.logout')}
        </button>
      </SupplierBrandBar>
      <div className="border-b border-border bg-bg">
        <nav aria-label={t('nav.label')} className="mx-auto flex max-w-3xl">
          {TABS.map((tab) => {
            const active = pathname === tab.href;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex min-h-[48px] flex-1 items-center justify-center border-b-2 px-2 text-center font-mono text-[11px] uppercase tracking-eyebrow',
                  active ? 'border-accent text-text' : 'border-transparent text-muted hover:text-text',
                )}
              >
                {t(`nav.${tab.key}`)}
              </Link>
            );
          })}
        </nav>
      </div>
      <main id="main" className="mx-auto w-full max-w-3xl px-5 py-6">
        <p className="mb-4 font-mono text-[11px] uppercase tracking-eyebrow text-muted">{user?.supplierName ?? user?.name}</p>
        {children}
      </main>
    </div>
  );
}
