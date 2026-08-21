'use client';

import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { publishAllInventory } from '@/lib/api';
import type { PublishAllRequest, PublishAllResponse } from '@/types/contract';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { useErrorMessage } from '@/components/ui/QueryState';
import { Link } from '@/i18n/navigation';
import { localUid } from '@/components/master-set/capture';

/**
 * «Publicar todo» — P-19 (DESIGN_SYSTEM §16.5c). Confirmación con alcance explícito
 * (todo / set actual / solo sellado) y RESULTADO HONESTO de cuatro renglones (publicadas /
 * ya listadas / sin precio / fallidas). Sin dry-run (el contrato no lo tiene — §16.11.1):
 * la honestidad va en el resultado, no en una estimación inventada. Idempotente por batchKey.
 */

type Scope = 'all' | 'set' | 'sealed';

export interface PublishAllDialogProps {
  open: boolean;
  onClose: () => void;
  /** Set abierto en el binder (habilita el alcance «Solo este set»). */
  currentSet?: { id: string; name: string } | null;
  onDone?: () => void;
}

export function PublishAllDialog({ open, onClose, currentSet, onDone }: PublishAllDialogProps) {
  const t = useTranslations('admin.publishAll');
  const errorMessage = useErrorMessage();
  const [scope, setScope] = useState<Scope>('all');

  // batchKey estable por SESIÓN del diálogo: un reintento tras timeout es replay idempotente.
  const batchKeyRef = useRef<string | null>(null);
  function ensureBatchKey(): string {
    if (batchKeyRef.current === null) batchKeyRef.current = localUid('puball');
    return batchKeyRef.current;
  }

  const run = useMutation({
    mutationFn: () => {
      const req: PublishAllRequest = { batchKey: ensureBatchKey() };
      if (scope === 'set' && currentSet) req.setId = currentSet.id;
      if (scope === 'sealed') req.productType = 'sealed';
      return publishAllInventory(req);
    },
    onSuccess: () => onDone?.(),
  });

  function close() {
    // El resultado consumido cierra la sesión: el próximo «Publicar todo» usa key nueva.
    if (run.data) {
      batchKeyRef.current = null;
      run.reset();
    }
    onClose();
  }

  const result = run.data ?? null;

  return (
    <Modal
      open={open}
      onClose={close}
      title={t('title')}
      footer={
        result ? (
          <Button variant="secondary" onClick={close}>
            {t('close')}
          </Button>
        ) : (
          <>
            <Button variant="secondary" onClick={close} disabled={run.isPending}>
              {t('cancel')}
            </Button>
            <Button onClick={() => run.mutate()} loading={run.isPending} disabled={run.isPending}>
              {t('cta')}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <ResultView result={result} />
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-text">{t('body')}</p>
          <Select
            label={t('scopeLabel')}
            value={scope}
            onChange={(e) => setScope(e.target.value as Scope)}
            options={[
              { value: 'all', label: t('scope.all') },
              ...(currentSet ? [{ value: 'set', label: t('scope.set', { name: currentSet.name }) }] : []),
              { value: 'sealed', label: t('scope.sealed') },
            ]}
          />
          <p className="text-xs text-muted">{t('pendingNote')}</p>
          <p className="text-xs text-muted">{t('moneyNote')}</p>
          {run.isError && (
            <Banner variant="danger" role="alert">
              {errorMessage(run.error)}
            </Banner>
          )}
        </div>
      )}
    </Modal>
  );
}

/** Resultado honesto: cuatro renglones mono `tabular-nums` (§16.5c2). */
function ResultView({ result }: { result: PublishAllResponse }) {
  const t = useTranslations('admin.publishAll');
  const { summary } = result;
  const capped = summary.pendingPrice + summary.failed > result.failures.length && result.failures.length >= 200;

  const rows: { label: string; value: number; danger?: boolean; link?: boolean }[] = [
    { label: t('result.published'), value: summary.published },
    { label: t('result.alreadyListed'), value: summary.alreadyListed },
    { label: t('result.pendingPrice'), value: summary.pendingPrice, danger: summary.pendingPrice > 0, link: summary.pendingPrice > 0 },
    { label: t('result.failed'), value: summary.failed, danger: summary.failed > 0 },
  ];

  return (
    <div className="flex flex-col gap-4" data-testid="publish-all-result">
      {result.idempotentReplay && (
        <Banner variant="info" role="status">
          {t('result.replay')}
        </Banner>
      )}
      <dl className="flex flex-col gap-1 font-mono text-sm">
        {rows.map((r) => (
          <div key={r.label} className="flex items-baseline justify-between gap-4 border-b border-border py-1.5">
            <dt className="text-muted">{r.label}</dt>
            <dd className="flex items-baseline gap-3">
              <span className={`tabular-nums ${r.danger ? 'text-accent' : 'text-text'}`}>{r.value}</span>
              {r.link && (
                <Link
                  href="/admin/m2?context=inventory"
                  className="border-b border-accent pb-0.5 font-sans text-xs text-accent hover:text-text"
                >
                  {t('result.seePending')}
                </Link>
              )}
            </dd>
          </div>
        ))}
      </dl>
      {summary.failed > 0 && result.failures.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="eyebrow">{t('result.failuresTitle')}</p>
          <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto">
            {result.failures.map((f) => (
              <li key={f.inventoryItemId} className="font-mono text-xs text-accent">
                {f.folio} — {f.error.code}
              </li>
            ))}
          </ul>
        </div>
      )}
      {capped && <p className="text-xs text-muted">{t('result.capped')}</p>}
    </div>
  );
}
