'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { usePickingSummary } from '@/hooks/usePickingSummary';
import { SuperAdminOnly } from '@/components/domain/SuperAdminOnly';
import { cn } from '@/lib/cn';
import { ManualRefundsView } from '../manual-refunds/ManualRefundsView';
import { OperatorRefundsView } from './OperatorRefundsView';
import { REFUNDS_TABS, type RefundsTab } from './tabs';

/**
 * **«Reembolsos»** (`DESIGN_SYSTEM §37.20`, HECHOS 2026-10-02): UNA entrada de menú, dos cubetas como pestañas de
 * página — mismo patrón que `/admin/m4` (`M4View`: `replaceState`, la pestaña por defecto **borra** `tab`, flechas,
 * conteo dentro del nombre accesible).
 *
 * - **«Transferencias SPEI»** (`spei`, por defecto): la lista de §37.9a tal cual. Su contador es
 *   `summary.manualRefundsPending` — **la misma fuente que el badge del menú** (⛔ un segundo cálculo).
 * - **«Reembolsos de operadores»** (`operadores`): la vista de §37.11b tal cual. **Sin contador**: es vigilancia.
 *
 * `SuperAdminOnly` envuelve la página ENTERA: al operador no se le pinta ni el `tablist` (S6). Solo se monta la
 * cubeta activa. ⛔ No se comparten filtros entre cubetas: son dos dineros distintos.
 */
export function RefundsView({ initialTab = 'spei' }: { initialTab?: RefundsTab }) {
  return (
    <SuperAdminOnly>
      <RefundsTabs initialTab={initialTab} />
    </SuperAdminOnly>
  );
}

function RefundsTabs({ initialTab }: { initialTab: RefundsTab }) {
  const tModules = useTranslations('admin.modules'); // §37.2a-2: h1 = rótulo del menú (candado P66-2)
  const t = useTranslations('admin.refundsPage');
  const summary = usePickingSummary();
  const [tab, setTab] = useState<RefundsTab>(initialTab);
  const tabRefs = useRef<Record<RefundsTab, HTMLButtonElement | null>>({ spei: null, operadores: null });

  const selectTab = useCallback((next: RefundsTab) => {
    setTab(next);
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (next === REFUNDS_TABS[0]) url.searchParams.delete('tab');
    else url.searchParams.set('tab', next);
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  }, []);

  function onTabKeyDown(e: React.KeyboardEvent<HTMLButtonElement>, current: RefundsTab) {
    const idx = REFUNDS_TABS.indexOf(current);
    let next: RefundsTab | null = null;
    if (e.key === 'ArrowRight') next = REFUNDS_TABS[(idx + 1) % REFUNDS_TABS.length];
    else if (e.key === 'ArrowLeft') next = REFUNDS_TABS[(idx - 1 + REFUNDS_TABS.length) % REFUNDS_TABS.length];
    else if (e.key === 'Home') next = REFUNDS_TABS[0];
    else if (e.key === 'End') next = REFUNDS_TABS[REFUNDS_TABS.length - 1];
    if (!next) return;
    e.preventDefault();
    selectTab(next);
    tabRefs.current[next]?.focus();
  }

  useEffect(() => {
    if (initialTab !== REFUNDS_TABS[0]) tabRefs.current[initialTab]?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // `null` (operador) o `0` ⇒ sin número, igual que el badge del menú.
  const speiPending = summary.data?.manualRefundsPending ?? 0;
  const label = (key: RefundsTab) => (key === 'spei' ? t('tabs.spei') : t('tabs.operators'));
  const accessibleName = (key: RefundsTab) =>
    key === 'spei' && speiPending > 0 ? `${t('tabs.spei')}, ${t('tabs.speiCount', { count: speiPending })}` : label(key);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-h1 font-bold">{tModules('refunds')}</h1>
        <p className="text-sm text-muted">{t('hint')}</p>
      </div>

      <div className="flex gap-5 overflow-x-auto border-b border-border" role="tablist" aria-label={tModules('refunds')}>
        {REFUNDS_TABS.map((key) => {
          const active = tab === key;
          return (
            <button
              key={key}
              ref={(el) => {
                tabRefs.current[key] = el;
              }}
              type="button"
              role="tab"
              id={`refunds-tab-${key}`}
              aria-selected={active}
              aria-controls={`refunds-panel-${key}`}
              aria-label={accessibleName(key)}
              tabIndex={active ? 0 : -1}
              onClick={() => selectTab(key)}
              onKeyDown={(e) => onTabKeyDown(e, key)}
              className={cn(
                '-mb-px inline-flex min-h-[44px] items-center gap-2 whitespace-nowrap border-b-2 px-1 text-sm',
                active ? 'border-text text-text' : 'border-transparent text-muted hover:text-text',
              )}
            >
              <span>{label(key)}</span>
              {key === 'spei' && speiPending > 0 && (
                <span aria-hidden data-testid="refunds-tab-badge-spei" className="tabular font-mono text-[11px] text-muted">
                  {speiPending}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" id={`refunds-panel-${tab}`} aria-labelledby={`refunds-tab-${tab}`}>
        {tab === 'spei' && <ManualRefundsView />}
        {tab === 'operadores' && <OperatorRefundsView />}
      </div>
    </div>
  );
}
