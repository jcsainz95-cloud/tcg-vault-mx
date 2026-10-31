'use client';

import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { Link, usePathname } from '@/i18n/navigation';
import { cn } from '@/lib/cn';

/**
 * Sub-navegación de la «Tienda» (artboard 2a, dirección 1a «Conservadora»):
 * Cartas sueltas (/catalog) · Producto sellado (/sellado) · Gradeadas
 * (/catalog?productType=graded) · Accesorios (/accesorios, §AC-UX.1). La pestaña activa lleva subrayado rojo de 2px y
 * versalitas con tracking de etiqueta; el resto queda en muted.
 *
 * «Gradeadas» no es una ruta propia: es el catálogo con el filtro
 * `productType=graded` en la query, el MISMO parámetro que escribe el panel (TL-MKT3-2; antes la pestaña emitía el
 * alias `type`, que solo sigue leyéndose para enlaces viejos en `parseUrlFilters`).
 */
export function StoreTabs() {
  const t = useTranslations('storeTabs');
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Activa con `productType=graded`; el alias viejo `type` también cuenta (enlaces guardados).
  const graded =
    searchParams?.get('type') === 'graded' || searchParams?.get('productType') === 'graded';
  const inCatalog = pathname.startsWith('/catalog');

  const tabs = [
    { key: 'singles', href: '/catalog', label: t('singles'), active: inCatalog && !graded },
    { key: 'sealed', href: '/sellado', label: t('sealed'), active: pathname.startsWith('/sellado') },
    { key: 'graded', href: '/catalog?productType=graded', label: t('graded'), active: inCatalog && graded },
    // §AC-UX.1: cuarta pestaña AL FINAL (no mueve lo que el cliente ya conoce); ruta en español como /sellado.
    { key: 'accessories', href: '/accesorios', label: t('accessories'), active: pathname.startsWith('/accesorios') },
  ];

  // R4 (a11y): esto es NAVEGACIÓN entre rutas, no un tab-panel ARIA — sin
  // role="tablist"/"tab" ni aria-selected (prometerían panel controlado y
  // navegación por flechas). Un <nav> etiquetado + aria-current="page" en el
  // link activo dice exactamente lo que es. El aspecto visual (§20.1) no cambia.
  return (
    <nav
      className="gutter flex gap-6 overflow-x-auto border-b border-border-strong sm:gap-8"
      aria-label={t('label')}
    >
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
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
    </nav>
  );
}
