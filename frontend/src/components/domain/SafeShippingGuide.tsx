'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';

/**
 * Guía de envío seguro (DESIGN_SYSTEM §7.13, PROJECT AC 34): sleeve + top loader.
 *
 * Makeover 1a (artboard «2b Vender»): los pasos son una retícula editorial de
 * cuatro columnas — regla superior, numeral mono en rojo (01–04), título y cuerpo —
 * sin cajas, iconos ni rellenos de color. El mismo bloque sirve en el modal
 * (columns=2, con CTA «entendido») y como sección inline al pie de /buylist
 * (columns=4, sin CTA).
 */
export function SafeShippingGuide({
  onUnderstood,
  columns = 2,
  className,
}: {
  onUnderstood?: () => void;
  /** 2 = modal (angosto) · 4 = sección inline de página completa. */
  columns?: 2 | 4;
  className?: string;
}) {
  const t = useTranslations('safeShipping');
  const steps = [
    { title: t('step1Title'), body: t('step1Body') },
    { title: t('step2Title'), body: t('step2Body') },
    { title: t('step3Title'), body: t('step3Body') },
    { title: t('step4Title'), body: t('step4Body') },
  ];
  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <p className="max-w-[560px] text-sm leading-relaxed text-muted">{t('intro')}</p>
      <ol
        className={cn(
          'grid gap-6',
          columns === 4 ? 'sm:grid-cols-2 lg:grid-cols-4' : 'sm:grid-cols-2',
        )}
      >
        {steps.map((s, i) => (
          <li key={i} className="border-t border-border pt-3.5">
            <span aria-hidden className="tabular font-mono text-[11px] text-accent">
              {String(i + 1).padStart(2, '0')}
            </span>
            <p className="mt-2 text-sm font-medium text-text">{s.title}</p>
            <p className="mt-1.5 text-[13px] leading-[1.6] text-muted">{s.body}</p>
          </li>
        ))}
      </ol>
      {onUnderstood && (
        <Button variant="secondary" onClick={onUnderstood} className="mt-2 self-start">
          {t('understood')}
        </Button>
      )}
    </div>
  );
}
