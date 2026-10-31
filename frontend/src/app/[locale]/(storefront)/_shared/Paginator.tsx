'use client';

import { useTranslations } from 'next-intl';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Link } from '@/i18n/navigation';

export interface PaginatorProps {
  page: number;
  totalPages: number;
  onPage: (page: number) => void;
  /**
   * C2 (BRIEF_MKT Ola 2): ruta (sin locale) de la página `n`. Con ella, la flecha habilitada es un `<a href>` rastreable
   * (`?page=n`, también en el HTML del servidor); el clic normal sigue paginando en el cliente (`onPage`) y el clic con
   * modificador (pestaña nueva) sigue el enlace. Sin ella, botones como siempre (Sellado, Accesorios).
   */
  hrefFor?: (page: number) => string;
}

/**
 * Paginador sobrio del storefront (§20.12; artboard 2a): flechas cuadradas de
 * 38px con borde de regla y el conteo «página / total» en mono tabular. La
 * flecha habilitada lleva borde de tinta; la deshabilitada baja de opacidad.
 * Con una sola página no se renderiza. Sincronizado con los filtros: el padre
 * resetea `page` en cada cambio. Vivía en `catalog/`; se movió a `_shared/`
 * para que Sellado pagine con el mismo patrón (deuda D3 del pase de refactors).
 */
export function Paginator({ page, totalPages, onPage, hrefFor }: PaginatorProps) {
  const t = useTranslations('catalog.pagination');
  if (totalPages <= 1) return null;

  const btn =
    'flex h-[38px] w-[38px] items-center justify-center border transition-colors disabled:cursor-not-allowed disabled:opacity-40';
  const enabledCls = 'border-text text-text hover:bg-text hover:text-primary-fg';
  const disabledCls = 'border-border-strong text-muted';

  function arrow(target: number, enabled: boolean, label: string, icon: React.ReactNode) {
    if (hrefFor && enabled) {
      return (
        <Link
          href={hrefFor(target)}
          aria-label={label}
          onClick={(e: React.MouseEvent<HTMLAnchorElement>) => {
            // Pestaña nueva / ventana nueva: que el navegador siga el enlace.
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
            e.preventDefault();
            onPage(target);
          }}
          className={cn(btn, enabledCls)}
        >
          {icon}
        </Link>
      );
    }
    return (
      <button
        type="button"
        aria-label={label}
        disabled={!enabled}
        onClick={() => onPage(target)}
        className={cn(btn, enabled ? enabledCls : disabledCls)}
      >
        {icon}
      </button>
    );
  }

  return (
    <nav aria-label={t('label')} className="flex items-center justify-center gap-3">
      {arrow(page - 1, page > 1, t('prev'), <ArrowLeft size={16} aria-hidden />)}
      <span className="tabular font-mono text-[11px] text-muted" aria-live="polite">
        {t('pageOf', { page, total: totalPages })}
      </span>
      {arrow(page + 1, page < totalPages, t('next'), <ArrowRight size={16} aria-hidden />)}
    </nav>
  );
}
