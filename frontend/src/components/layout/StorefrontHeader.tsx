'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Menu, X, Zap } from 'lucide-react';
import { Link, usePathname } from '@/i18n/navigation';
import { LocaleToggle } from '@/components/ui/LocaleToggle';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { cn } from '@/lib/cn';

export function StorefrontHeader() {
  const t = useTranslations('nav');
  const tc = useTranslations('common');
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const links = [
    { href: '/catalog', label: t('shop') },
    { href: '/buylist', label: t('buylist') },
    { href: '/vault', label: t('vault') },
    { href: '/orders', label: t('orders') },
  ];

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
          <Link
            href="/login"
            className="hidden rounded-md border border-border-strong px-3 py-2 text-sm font-medium hover:bg-surface-2 sm:inline-flex"
          >
            {t('login')}
          </Link>
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
            <Link
              href="/login"
              onClick={() => setOpen(false)}
              className="rounded-md px-3 py-3 text-base font-medium text-text hover:bg-surface-2"
            >
              {t('login')}
            </Link>
            <div className="px-3 py-2">
              <LocaleToggle />
            </div>
          </div>
        </nav>
      )}
    </header>
  );
}
