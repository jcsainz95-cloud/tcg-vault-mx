'use client';

import { useTranslations } from 'next-intl';
import { Layers, Shield, Mail, Package } from 'lucide-react';
import { Button } from '@/components/ui/Button';

/** Guía de envío seguro (DESIGN_SYSTEM §7.13, PROJECT AC 34): sleeve + top loader. */
export function SafeShippingGuide({ onUnderstood }: { onUnderstood?: () => void }) {
  const t = useTranslations('safeShipping');
  const steps = [
    { icon: Layers, title: t('step1Title'), body: t('step1Body') },
    { icon: Shield, title: t('step2Title'), body: t('step2Body') },
    { icon: Mail, title: t('step3Title'), body: t('step3Body') },
    { icon: Package, title: t('step4Title'), body: t('step4Body') },
  ];
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-h3 font-semibold">{t('title')}</h3>
        <p className="text-sm text-muted">{t('intro')}</p>
      </div>
      <ol className="grid gap-3 sm:grid-cols-2">
        {steps.map((s, i) => (
          <li key={i} className="flex gap-3 rounded-lg border border-border bg-surface p-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
              <s.icon size={18} aria-hidden />
            </span>
            <div>
              <p className="text-sm font-semibold text-text">
                {i + 1}. {s.title}
              </p>
              <p className="text-xs text-muted">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
      {onUnderstood && (
        <Button variant="secondary" onClick={onUnderstood} className="self-start">
          {t('understood')}
        </Button>
      )}
    </div>
  );
}
