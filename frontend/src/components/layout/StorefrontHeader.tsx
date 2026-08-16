'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { LogOut, Menu, User, X, Zap } from 'lucide-react';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { LocaleToggle } from '@/components/ui/LocaleToggle';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { useSession } from '@/lib/session';
import { logout as apiLogout } from '@/lib/api';
import { cn } from '@/lib/cn';

export function StorefrontHeader() {
  const t = useTranslations('nav');
  const tc = useTranslations('common');
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // Sesión de cliente (reactiva). `ready` evita mismatch de hidratación: mientras
  // sea false pintamos el estado deslogueado, idéntico al render de servidor.
  const { user, isAuthenticated, ready } = useSession();
  const authed = ready && isAuthenticated;
  const displayName = user?.name || user?.email || '';

  const links = [
    { href: '/catalog', label: t('shop') },
    { href: '/buylist', label: t('buylist') },
    { href: '/vault', label: t('vault') },
    { href: '/orders', label: t('orders') },
  ];

  async function onLogout() {
    setOpen(false);
    await apiLogout();
    router.push('/');
  }

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-surface/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-2 font-bold text-text">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-accent text-accent-fg">
            <Zap size={18} aria-hidden />
          </span>
          <span className="hidden sm:inline">{tc('appName')}</span>
        </Link>

        <nav className="ml-4 hidden items-center gap-1 md:flex">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={cn(
                'rounded-md px-3 py-2 text-sm font-medium hover:bg-surface-2',
                pathname.startsWith(l.href) ? 'text-primary' : 'text-muted',
              )}
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <div className="hidden sm:block">
            <LocaleToggle />
          </div>
          <ThemeToggle />
          {authed ? (
            <div className="hidden items-center gap-2 sm:flex">
              <span
                className="inline-flex max-w-[12rem] items-center gap-2 rounded-md px-2 py-2 text-sm font-medium text-text"
                title={displayName}
              >
                <User size={16} aria-hidden className="text-muted" />
                <span className="truncate">{displayName}</span>
              </span>
              <button
                type="button"
                onClick={onLogout}
                className="inline-flex items-center gap-1.5 rounded-md border border-border-strong px-3 py-2 text-sm font-medium hover:bg-surface-2"
              >
                <LogOut size={16} aria-hidden />
                {t('logout')}
              </button>
            </div>
          ) : (
            <Link
              href="/login"
              className="hidden rounded-md border border-border-strong px-3 py-2 text-sm font-medium hover:bg-surface-2 sm:inline-flex"
            >
              {t('login')}
            </Link>
          )}
          <button
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center rounded-md text-muted hover:bg-surface-2 md:hidden"
            aria-label={t('menu')}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </div>

      {open && (
        <nav className="border-t border-border bg-surface px-4 py-3 md:hidden">
          <div className="flex flex-col gap-1">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="rounded-md px-3 py-3 text-base font-medium text-text hover:bg-surface-2"
              >
                {l.label}
              </Link>
            ))}
            {authed ? (
              <>
                <span className="flex items-center gap-2 px-3 py-3 text-base font-medium text-muted">
                  <User size={18} aria-hidden />
                  <span className="truncate">{displayName}</span>
                </span>
                <button
                  type="button"
                  onClick={onLogout}
                  className="flex items-center gap-2 rounded-md px-3 py-3 text-left text-base font-medium text-text hover:bg-surface-2"
                >
                  <LogOut size={18} aria-hidden />
                  {t('logout')}
                </button>
              </>
            ) : (
              <Link
                href="/login"
                onClick={() => setOpen(false)}
                className="rounded-md px-3 py-3 text-base font-medium text-text hover:bg-surface-2"
              >
                {t('login')}
              </Link>
            )}
            <div className="px-3 py-2">
              <LocaleToggle />
            </div>
          </div>
        </nav>
      )}
    </header>
  );
}
