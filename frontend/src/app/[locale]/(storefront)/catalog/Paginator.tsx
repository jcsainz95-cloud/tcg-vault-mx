'use client';

import { useTranslations } from 'next-intl';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface PaginatorProps {
  page: number;
  totalPages: number;
  onPage: (page: number) => void;
}

/**
 * Paginador sobrio del catálogo (artboard 2a): flechas cuadradas de 38px con
 * borde de regla y el conteo «página / total» en mono tabular. La flecha
 * habilitada lleva borde de tinta; la deshabilitada baja de opacidad.
 * Sincronizado con los filtros: el padre resetea `page` en cada cambio.
 */
export function Paginator({ page, totalPages, onPage }: PaginatorProps) {
  const t = useTranslations('catalog.pagination');
  if (totalPages <= 1) return null;

  const btn =
    'flex h-[38px] w-[38px] items-center justify-center border transition-colors disabled:cursor-not-allowed disabled:opacity-40';

  return (
    <nav aria-label={t('label')} className="flex items-center justify-center gap-3">
      <button
        type="button"
        aria-label={t('prev')}
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
        className={cn(btn, page <= 1 ? 'border-border-strong text-muted' : 'border-text text-text hover:bg-text hover:text-primary-fg')}
      >
        <ArrowLeft size={16} aria-hidden />
      </button>
      <span className="tabular font-mono text-[11px] text-muted" aria-live="polite">
        {t('pageOf', { page, total: totalPages })}
      </span>
      <button
        type="button"
        aria-label={t('next')}
        disabled={page >= totalPages}
        onClick={() => onPage(page + 1)}
        className={cn(btn, page >= totalPages ? 'border-border-strong text-muted' : 'border-text text-text hover:bg-text hover:text-primary-fg')}
      >
        <ArrowRight size={16} aria-hidden />
      </button>
    </nav>
  );
}
