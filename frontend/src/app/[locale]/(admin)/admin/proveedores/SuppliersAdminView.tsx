'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';
import { SuppliersTab } from './SuppliersTab';
import { RequestsTab } from './RequestsTab';
import { OffersTab } from './OffersTab';
import { PurchasesTab } from './PurchasesTab';

const TABS = ['requests', 'offers', 'purchases', 'stores'] as const;
type Tab = (typeof TABS)[number];

/** El `h1` sale de `admin.modules.suppliers` (candado `AdminPageTitles` §37.2). */
export function SuppliersAdminView() {
  const tm = useTranslations('admin.modules');
  const t = useTranslations('admin.suppliers');
  const [tab, setTab] = useState<Tab>('requests');
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-serif text-3xl text-text">{tm('suppliers')}</h1>
        <p className="text-sm text-muted">{t('lead')}</p>
      </header>
      <div role="tablist" aria-label={t('tabsLabel')} className="flex flex-wrap border-b border-border">
        {TABS.map((k) => (
          <button
            key={k}
            role="tab"
            id={`sup-tab-${k}`}
            aria-selected={tab === k}
            aria-controls="sup-panel"
            type="button"
            onClick={() => setTab(k)}
            className={cn(
              'min-h-[44px] border-b-2 px-4 font-mono text-[11px] uppercase tracking-eyebrow',
              tab === k ? 'border-accent text-text' : 'border-transparent text-muted hover:text-text',
            )}
          >
            {t(`tabs.${k}`)}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="sup-panel" aria-labelledby={`sup-tab-${tab}`}>
        {tab === 'requests' && <RequestsTab />}
        {tab === 'offers' && <OffersTab />}
        {tab === 'purchases' && <PurchasesTab />}
        {tab === 'stores' && <SuppliersTab />}
      </div>
    </div>
  );
}
