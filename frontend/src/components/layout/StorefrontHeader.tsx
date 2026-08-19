'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { LocaleToggle } from '@/components/ui/LocaleToggle';
import { useSession } from '@/lib/session';
import { useCart } from '@/lib/cart';
import { logout as apiLogout } from '@/lib/api';
import { cn } from '@/lib/cn';

/** Marca: sello bermellón cuadrado + logotipo en mincho muy espaciado. */
function Wordmark({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const tc = useTranslations('common');
  return (
    <span className="flex items-center gap-3">
      <span
        aria-hidden
        className={cn('block shrink-0 bg-accent', size === 'md' ? 'h-[22px] w-[22px]' : 'h-[18px] w-[18px]')}
      />
      <span
        className={cn(
          'font-serif font-medium uppercase leading-none tracking-wordmark text-text',
          size === 'md' ? 'text-lg' : 'text-[15px]',
        )}
      >
        {tc('appName')}
      </span>
    </span>
  );
}

/** Menú móvil: dos reglas finas, no el icono de hamburguesa genérico. */
function RuleMenuIcon({ open }: { open: boolean }) {
  return (
    <span aria-hidden className="flex w-[22px] flex-col gap-[5px]">
      <span className={cn('h-px bg-text transition-transform', open && 'translate-y-[3px] rotate-[8deg]')} />
      <span className={cn('h-px bg-text transition-transform', open && '-translate-y-[3px] -rotate-[8deg]')} />
    </span>
  );
}

export function StorefrontHeader() {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // Sesión de cliente (reactiva). `ready` evita mismatch de hidratación: mientras
  // sea false pintamos el estado deslogueado, idéntico al render de servidor.
  const { user, isAuthenticated, ready } = useSession();
  const authed = ready && isAuthenticated;
  const displayName = user?.name || user?.email || '';
  const { count } = useCart();

  // Nav por sesión (P-13): el público solo ve "Compra" y "Vender". "Mi Bóveda" y
  // "Mis Órdenes" son áreas privadas y se muestran solo con sesión (authed). Como
  // `authed` depende de `ready`, en SSR/hidratación se pinta el nav público —idéntico
  // al render de servidor— y las pestañas privadas aparecen al montar la sesión.
  const links = [
    { href: '/catalog', label: t('shop') },
    { href: '/sellado', label: t('sealed') },
    { href: '/buylist', label: t('buylist') },
    ...(authed
      ? [
          { href: '/vault', label: t('vault') },
          { href: '/orders', label: t('orders') },
          { href: '/shipments', label: t('shipments') },
        ]
      : []),
  ];

  async function onLogout() {
    setOpen(false);
    await apiLogout();
    router.push('/');
  }

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-bg">
      <div className="mx-auto flex max-w-7xl items-center gap-10 px-5 py-4 sm:px-6 lg:px-8 lg:py-[22px]">
        <Link href="/" className="lg:hidden">
          <Wordmark size="sm" />
        </Link>
        <Link href="/" className="hidden lg:block">
          <Wordmark />
        </Link>

        <nav className="hidden items-center gap-[30px] lg:flex">
          {links.map((l) => {
            const active = pathname.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'pb-1.5 text-[11px] font-medium uppercase leading-none tracking-label transition-colors',
                  // El activo se marca con la regla bermellón, no con relleno.
                  active
                    ? 'border-b border-accent text-text'
                    : 'border-b border-transparent text-muted hover:text-text',
                )}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-5 lg:gap-[22px]">
          <div className="hidden lg:block">
            <LocaleToggle />
          </div>

          {authed ? (
            <div className="hidden items-center gap-5 lg:flex">
              <span
                className="max-w-[12rem] truncate text-[11px] font-medium uppercase tracking-label text-text"
                title={displayName}
              >
                {displayName}
              </span>
              <button
                type="button"
                onClick={onLogout}
                className="text-[11px] font-medium uppercase tracking-label text-muted hover:text-text"
              >
                {t('logout')}
              </button>
            </div>
          ) : (
            <Link
              href="/login"
              className="hidden text-[11px] font-medium uppercase tracking-label text-text lg:inline"
            >
              {t('login')}
            </Link>
          )}

          <Link
            href="/checkout"
            className="hidden items-center gap-2 border border-text px-3.5 py-2.5 text-[11px] font-medium uppercase tracking-label text-text hover:bg-text hover:text-primary-fg lg:inline-flex"
          >
            {t('cart')}
            <span className="tabular font-mono">{count}</span>
          </Link>

          <button
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center lg:hidden"
            aria-label={t('menu')}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <RuleMenuIcon open={open} />
          </button>
        </div>
      </div>

      {open && (
        <nav className="border-t border-border px-5 py-2 lg:hidden">
          <div className="flex flex-col">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="border-b border-border py-4 text-sm font-medium uppercase tracking-label text-text"
              >
                {l.label}
              </Link>
            ))}
            <Link
              href="/checkout"
              onClick={() => setOpen(false)}
              className="flex items-center justify-between border-b border-border py-4 text-sm font-medium uppercase tracking-label text-text"
            >
              {t('cart')}
              <span className="tabular font-mono text-muted">{count}</span>
            </Link>
            {authed ? (
              <>
                <span className="truncate border-b border-border py-4 text-sm text-muted">{displayName}</span>
                <button
                  type="button"
                  onClick={onLogout}
                  className="border-b border-border py-4 text-left text-sm font-medium uppercase tracking-label text-text"
                >
                  {t('logout')}
                </button>
              </>
            ) : (
              <Link
                href="/login"
                onClick={() => setOpen(false)}
                className="border-b border-border py-4 text-sm font-medium uppercase tracking-label text-text"
              >
                {t('login')}
              </Link>
            )}
            <div className="py-4">
              <LocaleToggle />
            </div>
          </div>
        </nav>
      )}
    </header>
  );
}
