'use client';

import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import { cn } from '@/lib/cn';

/**
 * Sub-navegación de la "Tienda": Cartas sueltas (/catalog) y Producto sellado (/sellado).
 * Vive dentro de las dos vistas de compra, bajo el header. La pestaña "Tienda" del header
 * queda activa en ambas rutas; aquí se distingue cuál de las dos está abierta.
 */
export function StoreTabs() {
  const t = useTranslations('storeTabs');
  const pathname = usePathname();
  const tabs = [
    { href: '/catalog', label: t('singles') },
    { href: '/sellado', label: t('sealed') },
  ];
  return (
    <div className="gutter flex gap-8 border-b border-border pt-8" role="tablist" aria-label={t('label')}>
      {tabs.map((tab) => {
        const active = pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            role="tab"
            aria-selected={active}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'pb-3 text-sm font-medium transition-colors',
              active
                ? 'border-b-2 border-accent text-text'
                : 'border-b-2 border-transparent text-muted hover:text-text',
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
