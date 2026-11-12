'use client';

import { useTranslations } from 'next-intl';
import { LogoTcgHunt } from '@/components/domain/LogoTcgHunt';
import { LocaleToggle } from '@/components/ui/LocaleToggle';

/** Cabecera de marca del portal (tinta, sin enlaces a la tienda pública). */
export function SupplierBrandBar({ children }: { children?: React.ReactNode }) {
  const t = useTranslations('supplier');
  const tc = useTranslations('common');
  return (
    <header className="flex items-center justify-between gap-4 bg-ink px-5 py-3">
      <div className="flex items-center gap-3">
        <LogoTcgHunt variant="mark-dark" size={28} decorative />
        <div className="leading-none">
          <span className="block font-brand text-[15px] font-bold uppercase tracking-[0.04em] text-on-ink">{tc('brand.name')}</span>
          <span className="mt-1 block font-mono text-[10px] uppercase tracking-eyebrow text-on-ink-muted">{t('brand')}</span>
        </div>
      </div>
      <div className="flex items-center gap-4">
        {children}
        <LocaleToggle tone="ink" />
      </div>
    </header>
  );
}
