'use client';

import { useEffect, useRef, useState } from 'react';
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

  // Menor del informe N1 (ux-review de marketing 2026-11-03): en móvil las cuatro pestañas no caben y «GRADEADAS» quedaba
  // cortada («GRADEAD») sin indicio de que la fila se desplaza. (a) Mientras quede contenido a la derecha, un
  // degradado al color de fondo marca el borde (decorativo, `aria-hidden`); (b) la pestaña activa entra entera a la vista.
  const navRef = useRef<HTMLElement>(null);
  const [moreRight, setMoreRight] = useState(false);
  const activeKey = tabs.find((tab) => tab.active)?.key;
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const active = nav.querySelector<HTMLElement>('[aria-current="page"]');
    if (active && active.offsetLeft + active.offsetWidth > nav.scrollLeft + nav.clientWidth) {
      nav.scrollLeft = active.offsetLeft + active.offsetWidth - nav.clientWidth + 48;
    }
    const sync = () => setMoreRight(nav.scrollLeft + nav.clientWidth < nav.scrollWidth - 1);
    sync();
    nav.addEventListener('scroll', sync, { passive: true });
    window.addEventListener('resize', sync);
    return () => {
      nav.removeEventListener('scroll', sync);
      window.removeEventListener('resize', sync);
    };
  }, [activeKey]);

  // R4 (a11y): esto es NAVEGACIÓN entre rutas, no un tab-panel ARIA — sin
  // role="tablist"/"tab" ni aria-selected (prometerían panel controlado y
  // navegación por flechas). Un <nav> etiquetado + aria-current="page" en el
  // link activo dice exactamente lo que es. El aspecto visual (§20.1) no cambia.
  return (
    <div className="relative">
      <nav
        ref={navRef}
        className="gutter flex gap-6 overflow-x-auto border-b border-border-strong sm:gap-8"
        aria-label={t('label')}
      >
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={tab.active ? 'page' : undefined}
            className={cn(
              // MKT-CONV.8: en < lg cada pestaña es una fila de 44 px (toque y altura fijos; scroll horizontal si no
              // caben). En lg, igual que antes (`pb-3`).
              'flex h-11 items-center whitespace-nowrap text-[11px] font-medium uppercase tracking-label transition-colors sm:text-xs lg:block lg:h-auto lg:pb-3',
              tab.active
                ? 'border-b-2 border-accent text-text'
                : 'border-b-2 border-transparent text-muted hover:text-text',
            )}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
      {moreRight && (
        <span
          aria-hidden
          data-testid="store-tabs-more"
          className="pointer-events-none absolute bottom-px right-0 top-0 w-12"
          style={{ background: 'linear-gradient(to left, var(--color-bg) 25%, transparent)' }}
        />
      )}
    </div>
  );
}
