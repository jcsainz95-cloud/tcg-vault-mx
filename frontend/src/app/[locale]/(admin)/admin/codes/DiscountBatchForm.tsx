'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { createDiscountCodeBatch, downloadDiscountCodeBatchCsv } from '@/lib/api';
import { asApiError } from '@/lib/api-client';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useErrorMessage } from '@/components/ui/QueryState';
import { downloadTextFile } from '@/lib/download';
import type { DiscountCodeBatchCreateResponse } from '@/types/contract';
import { DiscountConfigFields, EMPTY_CONFIG, type ConfigDraft, type FieldErrors } from './DiscountConfigFields';
import { serverFieldError, toConfig } from './discount-config';

const PREFIX_RE = /^[A-Z0-9]{2,8}$/;

/** `/admin/codes/batch/new` (§DSC-UX.5 D8): prefijo, cantidad 1-500, la misma config; usos 1 y 1 FIJOS. */
export function DiscountBatchForm() {
  const t = useTranslations('admin.discounts');
  const getMessage = useErrorMessage('operator');
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<ConfigDraft>({ ...EMPTY_CONFIG, kind: 'fixed_amount' });
  const [prefix, setPrefix] = useState('');
  const [quantity, setQuantity] = useState('50');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [result, setResult] = useState<DiscountCodeBatchCreateResponse | null>(null);
  const [sample, setSample] = useState<string[]>([]);
  const n = Number(quantity) || 0;

  const create = useMutation({
    mutationFn: async () => {
      const conf = toConfig(draft, t);
      const fieldErrors: FieldErrors = { ...conf.errors };
      if (!PREFIX_RE.test(prefix)) fieldErrors.prefix = t('errors.validation');
      if (!Number.isInteger(n) || n < 1 || n > 500) fieldErrors.quantity = t('errors.validation');
      if (Object.keys(fieldErrors).length || !conf.body) throw { fieldErrors };
      return createDiscountCodeBatch({ ...conf.body, prefix, quantity: n });
    },
    onMutate: () => {
      setErrors({});
      setFormError(null);
    },
    onSuccess: async (res) => {
      setResult(res);
      void queryClient.invalidateQueries({ queryKey: ['admin-discount-batches'] });
      // «Las primeras filas del CSV de muestra» (D8): del CSV que sirve el servidor, no armado aquí.
      try {
        const csv = await (await downloadDiscountCodeBatchCsv(res.batch.id)).blob.text();
        setSample(csv.trim().split('\n').slice(0, 4));
      } catch {
        setSample([]);
      }
    },
    onError: (e: unknown) => {
      if (e && typeof e === 'object' && 'fieldErrors' in e) {
        setErrors((e as { fieldErrors: FieldErrors }).fieldErrors);
        return;
      }
      const err = asApiError(e);
      if (err?.code === 'VALIDATION_ERROR') {
        const f = serverFieldError(err.details, t);
        if (Object.keys(f).length) setErrors(f);
        else setFormError(getMessage(e));
      } else setFormError(getMessage(e));
    },
  });

  async function downloadCsv() {
    if (!result) return;
    try {
      const res = await downloadDiscountCodeBatchCsv(result.batch.id);
      downloadTextFile(res.filename ?? `lote-${result.batch.prefix}.csv`, await res.blob.text());
    } catch (e) {
      setFormError(getMessage(e));
    }
  }

  if (result) {
    return (
      <div className="max-w-[760px]" data-testid="batch-ready">
        <Link href="/admin/codes" className="font-mono text-[11px] uppercase tracking-label text-muted hover:text-text">
          ← {t('back')}
        </Link>
        <h1 className="mt-3 font-serif text-3xl text-text">{t('batch.title')}</h1>
        <div role="status" className="mt-6 border-l-2 border-success pl-4">
          <p className="font-medium text-text">{t('batch.ready', { prefix: result.batch.prefix })}</p>
          <p className="mt-1 text-sm text-muted">{t('batch.readyBody', { n: result.batch.quantity })}</p>
        </div>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button variant="accent" onClick={() => void downloadCsv()}>
            {t('downloadCsv')}
          </Button>
          <Link
            href={`/admin/codes/batch/${result.batch.id}/report`}
            className="inline-flex min-h-[44px] items-center border border-text px-5 text-[11px] font-medium uppercase tracking-label text-text"
          >
            {t('batch.viewBatchReport')}
          </Link>
        </div>
        {formError && (
          <p role="alert" className="mt-4 font-mono text-xs text-accent">
            {formError}
          </p>
        )}
        {sample.length > 0 && (
          <pre data-testid="batch-csv-sample" className="mt-6 overflow-x-auto border border-border bg-surface-2 p-4 font-mono text-xs text-text">
            {sample.join('\n')}
          </pre>
        )}
      </div>
    );
  }

  return (
    <form
      className="max-w-[760px] pb-24"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate();
      }}
    >
      <Link href="/admin/codes" className="font-mono text-[11px] uppercase tracking-label text-muted hover:text-text">
        ← {t('back')}
      </Link>
      <h1 className="mt-3 font-serif text-3xl text-text">{t('batch.title')}</h1>
      {formError && (
        <p role="alert" className="mt-4 font-mono text-xs text-accent">
          {formError}
        </p>
      )}
      <div className="mt-8 grid gap-5 sm:grid-cols-2">
        <Input
          label={t('batch.prefix')}
          hint={t('batch.prefixHint')}
          value={prefix}
          maxLength={8}
          autoComplete="off"
          className="font-mono uppercase"
          onChange={(e) => setPrefix(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
          error={errors.prefix}
        />
        <Input
          label={t('batch.quantity')}
          inputMode="numeric"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value.replace(/[^\d]/g, '').slice(0, 3))}
          error={errors.quantity}
        />
      </div>
      <div className="mt-8 grid gap-8">
        <DiscountConfigFields draft={draft} onChange={(p) => setDraft((d) => ({ ...d, ...p }))} errors={errors}>
          <Input label={t('batch.perCode')} value={t('batch.fixedOne')} disabled aria-disabled readOnly />
          <Input label={t('batch.perCustomer')} value={t('batch.fixedOne')} disabled aria-disabled readOnly />
        </DiscountConfigFields>
      </div>
      <div className="sticky bottom-0 z-10 -mx-5 mt-8 flex flex-wrap gap-3 border-t border-border bg-bg px-5 py-3 lg:static lg:mx-0 lg:border-0 lg:px-0">
        <Button type="submit" variant="accent" loading={create.isPending} className="min-h-[48px]">
          {t('batch.generate', { n: Math.max(0, Math.min(n, 500)) })}
        </Button>
        <Link href="/admin/codes" className="inline-flex min-h-[48px] items-center px-3 text-sm underline underline-offset-4">
          {t('cancel')}
        </Link>
      </div>
    </form>
  );
}
