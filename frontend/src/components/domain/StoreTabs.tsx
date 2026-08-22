'use client';

import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { Link, usePathname } from '@/i18n/navigation';
import { cn } from '@/lib/cn';

/**
 * Sub-navegación de la «Tienda» (artboard 2a, dirección 1a «Conservadora»):
 * Cartas sueltas (/catalog) · Producto sellado (/sellado) · Gradeadas
 * (/catalog?type=graded). La pestaña activa lleva subrayado rojo de 2px y
 * versalitas con tracking de etiqueta; el resto queda en muted.
 *
 * «Gradeadas» no es una ruta propia: es el catálogo con el filtro
 * productType=graded pre-aplicado vía query (?type=graded). CatalogView lee
 * ese parámetro y lo sincroniza con sus filtros.
 */
export function StoreTabs() {
  const t = useTranslations('storeTabs');
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // La pestaña usa ?type=graded; los enlaces del Home llegan con ?productType=graded.
  const graded =
    searchParams?.get('type') === 'graded' || searchParams?.get('productType') === 'graded';
  const inCatalog = pathname.startsWith('/catalog');

  const tabs = [
    { key: 'singles', href: '/catalog', label: t('singles'), active: inCatalog && !graded },
    { key: 'sealed', href: '/sellado', label: t('sealed'), active: pathname.startsWith('/sellado') },
    { key: 'graded', href: '/catalog?type=graded', label: t('graded'), active: inCatalog && graded },
  ];

  return (
    <div
      className="gutter flex gap-6 overflow-x-auto border-b border-border-strong sm:gap-8"
      role="tablist"
      aria-label={t('label')}
    >
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          role="tab"
          aria-selected={tab.active}
          aria-current={tab.active ? 'page' : undefined}
          className={cn(
            'whitespace-nowrap pb-3 text-[11px] font-medium uppercase tracking-label transition-colors sm:text-xs',
            tab.active
              ? 'border-b-2 border-accent text-text'
              : 'border-b-2 border-transparent text-muted hover:text-text',
          )}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
