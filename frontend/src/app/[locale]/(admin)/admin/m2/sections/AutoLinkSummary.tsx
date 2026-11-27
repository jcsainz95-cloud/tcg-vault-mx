'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { getLinkExceptions, readAutoLinkSummary, setAutoLinkEnabled } from '@/lib/api/catalog-link-exceptions';
import { useRole } from '@/lib/role';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { useErrorMessage } from '@/components/ui/QueryState';
import { AutoLinkRunsPanel } from './AutoLinkRunsPanel';

/**
 * §AUTO-ENLACE F2 (contrato §8a/§8c) — contador, estado del job diario `catalog-auto-link` e interruptor (solo
 * super_admin, con confirmación al APAGAR). Fuente: `link-exceptions.summary`; si ese endpoint no responde, el mismo
 * resumen de `sync-status.autoLink` (`fallback`). Un campo ausente se omite, nunca se inventa.
 */
export function AutoLinkSummary({ fallback }: { fallback?: unknown }) {
  const t = useTranslations('admin.m2.catalog.autoLink');
  const format = useFormatter();
  const qc = useQueryClient();
  const { isSuperAdmin } = useRole();
  const getError = useErrorMessage('operator');
  const [confirmOff, setConfirmOff] = useState(false);
  const q = useQuery({ queryKey: ['link-exceptions'], queryFn: getLinkExceptions, retry: false });
  const toggle = useMutation({
    mutationFn: (on: boolean) => setAutoLinkEnabled(on),
    onSuccess: () => {
      setConfirmOff(false);
      qc.invalidateQueries({ queryKey: ['link-exceptions'] });
      qc.invalidateQueries({ queryKey: ['catalog-sync-status'] });
    },
  });
  const sm = q.data?.summary ?? (fallback ? readAutoLinkSummary(fallback as Parameters<typeof readAutoLinkSummary>[0]) : null);
  if (!sm) return null;
  const at = (iso: string) => format.dateTime(new Date(iso), { dateStyle: 'short', timeStyle: 'short' });
  const off = sm.autoLinkEnabled === false;
  const on = sm.autoLinkEnabled === true;
  return (
    <section aria-label={t('aria')} className="border border-border p-3 text-sm" data-testid="auto-link-summary">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium break-words" data-testid="auto-link-counter">
            {t('counter', { remaining: sm.unlinkedCards })}
            {sm.repairedYesterday != null && ` · ${t('repaired', { n: sm.repairedYesterday })}`}
            {sm.repairedYesterday != null && sm.pricedYesterday != null && ` (${t('priced', { n: sm.pricedYesterday })})`}
          </p>
          <p className="mt-1 text-xs text-muted break-words" data-testid="auto-link-job">
            {sm.autoLinkEnabled != null && <span className="font-medium text-ink">{off ? t('offState') : t('onState')}</span>}
            {sm.autoLinkEnabled != null && ' · '}
            {sm.lastRunAt ? t('last', { when: at(sm.lastRunAt) }) : t('neverRan')}
            {!off && sm.nextRunAt && ` · ${t('next', { when: at(sm.nextRunAt) })}`}
            {sm.waitingDecision != null && sm.waitingDecision > 0 && ` · ${t('waiting', { n: sm.waitingDecision })}`}
          </p>
          {off && <p className="mt-1 text-xs text-muted">{t('offHint')}</p>}
          {sm.pendingConfirm != null && sm.pendingConfirm > 0 && (
            <p className="mt-1 text-xs">
              <a href="#finish-review" className="underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2" data-testid="auto-link-pending-link">
                {t('pendingConfirm', { n: sm.pendingConfirm })}
              </a>
            </p>
          )}
          {isSuperAdmin && <AutoLinkRunsPanel canUnlink />}
        </div>
        {isSuperAdmin && sm.autoLinkEnabled != null && (
          <Button
            size="sm"
            variant="secondary"
            loading={toggle.isPending && !confirmOff}
            disabled={toggle.isPending}
            onClick={() => (on ? setConfirmOff(true) : toggle.mutate(true))}
            data-testid="auto-link-toggle"
          >
            {on ? t('turnOff') : t('turnOn')}
          </Button>
        )}
      </div>
      {toggle.isError && !confirmOff && <p role="alert" className="mt-2 text-xs text-danger">{t('toggleErr')} {getError(toggle.error)}</p>}
      <Modal
        open={confirmOff}
        onClose={() => setConfirmOff(false)}
        title={t('confirmOffTitle')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmOff(false)}>{t('cancel')}</Button>
            <Button loading={toggle.isPending} onClick={() => toggle.mutate(false)} data-testid="auto-link-confirm-off">{t('confirmOff')}</Button>
          </>
        }
      >
        <p className="text-sm">{t('confirmOffBody')}</p>
        {toggle.isError && <p role="alert" className="mt-2 text-sm text-danger">{t('toggleErr')} {getError(toggle.error)}</p>}
      </Modal>
    </section>
  );
}
