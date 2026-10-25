'use client';

import { useEffect, useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Lock } from 'lucide-react';
import { createDiscountCode, getDiscountCode, patchDiscountCode, setDiscountCodePaused } from '@/lib/api';
import { asApiError } from '@/lib/api-client';
import { Link, useRouter } from '@/i18n/navigation';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { QueryState, useErrorMessage } from '@/components/ui/QueryState';
import type { DiscountCodeCreateRequest, DiscountCodeDTO, DiscountCodePatchRequest } from '@/types/contract';
import { DiscountConfigFields, EMPTY_CONFIG, type ConfigDraft, type FieldErrors } from './DiscountConfigFields';
import { fromDTO, serverFieldError, toConfig } from './discount-config';
import { CODE_RE, randomCode } from './dsc-format';
import { StateTag } from './DiscountCodesView';

interface Draft extends ConfigDraft {
  code: string;
  maxTotalUses: string;
  maxUsesPerCustomer: string;
}

const EMPTY: Draft = { ...EMPTY_CONFIG, code: '', maxTotalUses: '', maxUsesPerCustomer: '1' };

/** `/admin/codes/new` y `/admin/codes/[id]` (§DSC-UX.5 D3-D5, D7). */
export function DiscountCodeForm({ id }: { id?: string }) {
  const editing = !!id;
  const existing = useQuery({ queryKey: ['admin-discount-code', id], queryFn: () => getDiscountCode(id!), enabled: editing });
  if (!editing) return <CodeFormBody />;
  return (
    <QueryState isLoading={existing.isLoading} isError={existing.isError} error={existing.error} onRetry={() => existing.refetch()}>
      {existing.data && <CodeFormBody key={existing.data.id} existing={existing.data} />}
    </QueryState>
  );
}

function CodeFormBody({ existing }: { existing?: DiscountCodeDTO }) {
  const t = useTranslations('admin.discounts');
  const getMessage = useErrorMessage('operator');
  const router = useRouter();
  const queryClient = useQueryClient();
  const lockedId = useId();
  const locked = existing?.locked ?? false;
  const inUse = existing ? existing.usage.consumed + existing.usage.reservedNow : 0;
  const [draft, setDraft] = useState<Draft>(() =>
    existing
      ? {
          ...fromDTO(existing),
          code: existing.code,
          maxTotalUses: existing.maxTotalUses != null ? String(existing.maxTotalUses) : '',
          maxUsesPerCustomer: existing.maxUsesPerCustomer != null ? String(existing.maxUsesPerCustomer) : '',
        }
      : EMPTY,
  );
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const patch = (p: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...p }));
    setSaved(false);
  };

  const save = useMutation({
    mutationFn: async (): Promise<DiscountCodeDTO | null> => {
      const fieldErrors: FieldErrors = {};
      const uses = draft.maxTotalUses.trim() === '' ? null : Number(draft.maxTotalUses);
      if (uses !== null && (!Number.isInteger(uses) || uses < 1)) fieldErrors.maxTotalUses = t('errors.validation');
      if (existing && uses !== null && uses < inUse) fieldErrors.maxTotalUses = t('errors.limitBelow', { n: inUse });
      if (locked && existing) {
        // Tras el primer uso solo viajan `endsAt` y `maxTotalUses` (§DSC.7, 912): lo demás ni se manda.
        const conf = toConfig({ ...draft }, t);
        if (conf.errors.endsAt) fieldErrors.endsAt = conf.errors.endsAt;
        if (Object.keys(fieldErrors).length) throw { fieldErrors };
        const body: DiscountCodePatchRequest = { endsAt: conf.body?.endsAt ?? null, maxTotalUses: uses };
        return patchDiscountCode(existing.id, body);
      }
      const conf = toConfig(draft, t);
      Object.assign(fieldErrors, conf.errors);
      const perCustomer = draft.maxUsesPerCustomer.trim() === '' ? null : Number(draft.maxUsesPerCustomer);
      if (perCustomer !== null && (!Number.isInteger(perCustomer) || perCustomer < 1)) fieldErrors.maxUsesPerCustomer = t('errors.validation');
      const code = draft.code.trim().toUpperCase();
      if (!existing && !CODE_RE.test(code)) fieldErrors.code = t('errors.validation');
      if (Object.keys(fieldErrors).length || !conf.body) throw { fieldErrors };
      if (existing) {
        return patchDiscountCode(existing.id, { ...conf.body, endsAt: conf.body.endsAt ?? null, maxTotalUses: uses, ...(perCustomer !== null ? { maxUsesPerCustomer: perCustomer } : {}) });
      }
      const body: DiscountCodeCreateRequest = {
        code,
        ...conf.body,
        ...(uses !== null ? { maxTotalUses: uses } : {}),
        ...(perCustomer !== null ? { maxUsesPerCustomer: perCustomer } : {}),
      };
      return createDiscountCode(body);
    },
    onMutate: () => {
      setErrors({});
      setFormError(null);
    },
    onSuccess: (dto) => {
      void queryClient.invalidateQueries({ queryKey: ['admin-discount-codes'] });
      if (!existing) {
        router.push('/admin/codes');
        return;
      }
      if (dto) queryClient.setQueryData(['admin-discount-code', dto.id], dto);
      setSaved(true);
    },
    onError: (e: unknown) => {
      if (e && typeof e === 'object' && 'fieldErrors' in e) {
        setErrors((e as { fieldErrors: FieldErrors }).fieldErrors);
        return;
      }
      const err = asApiError(e);
      if (err?.code === 'DISCOUNT_CODE_TAKEN') setErrors({ code: t('errors.taken') });
      else if (err?.code === 'DISCOUNT_CODE_LIMIT_BELOW_USES') {
        const n = typeof err.details?.inUse === 'number' ? err.details.inUse : inUse;
        setErrors({ maxTotalUses: t('errors.limitBelow', { n }) });
      } else if (err?.code === 'DISCOUNT_CODE_LOCKED') setFormError(t('errors.locked'));
      else if (err?.code === 'VALIDATION_ERROR') {
        const f = serverFieldError(err.details, t);
        if (Object.keys(f).length) setErrors(f);
        else setFormError(getMessage(e));
      } else setFormError(getMessage(e));
    },
  });

  const toggle = useMutation({
    mutationFn: () => setDiscountCodePaused(existing!.id, existing!.status !== 'paused'),
    onSuccess: (dto) => {
      queryClient.setQueryData(['admin-discount-code', dto.id], dto);
      void queryClient.invalidateQueries({ queryKey: ['admin-discount-codes'] });
    },
    onError: (e) => setFormError(getMessage(e)),
  });

  // Tras guardar, el aviso se anuncia una vez.
  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(false), 6000);
    return () => clearTimeout(timer);
  }, [saved]);

  const lockProps = locked ? { disabled: true, 'aria-disabled': true as const, 'aria-describedby': lockedId } : {};

  return (
    <form
      className="max-w-[760px] pb-24"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
      noValidate
    >
      <Link href="/admin/codes" className="font-mono text-[11px] uppercase tracking-label text-muted hover:text-text">
        ← {t('back')}
      </Link>
      <div className="mt-3 flex flex-wrap items-center gap-4">
        <h1 className="font-serif text-3xl text-text [overflow-wrap:anywhere]">{existing ? existing.code : t('form.newTitle')}</h1>
        {existing && <StateTag state={existing.state} />}
        {existing && (
          <Link href={`/admin/codes/${existing.id}/report`} className="text-sm underline underline-offset-4">
            {t('viewReport')}
          </Link>
        )}
      </div>

      {locked && existing && (
        <Banner variant="danger" className="mt-6">
          <span id={lockedId}>{t('form.lockedBanner', { n: existing.usage.consumed, m: existing.usage.reservedNow })}</span>
        </Banner>
      )}
      {formError && (
        <p role="alert" className="mt-4 font-mono text-xs text-accent">
          {formError}
        </p>
      )}

      <fieldset className="mt-8" disabled={locked || !!existing}>
        <legend className="eyebrow text-text">{t('form.sectionCode')}</legend>
        <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <Input
            label={t('form.codeLabel')}
            hint={t('form.codeHint')}
            value={draft.code}
            maxLength={20}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            className="font-mono uppercase"
            onChange={(e) => patch({ code: e.target.value.toUpperCase().replace(/\s+/g, '') })}
            error={errors.code}
            {...(existing ? { disabled: true, 'aria-disabled': true as const } : {})}
          />
          {!existing && (
            <Button type="button" variant="secondary" size="sm" className="min-h-[44px]" onClick={() => patch({ code: randomCode() })}>
              {t('generateRandom')}
            </Button>
          )}
        </div>
      </fieldset>

      <div className="mt-8 grid gap-8">
        <DiscountConfigFields draft={draft} onChange={patch} errors={errors} lockedAll={locked} lockedReasonId={lockedId}>
          <Input
            label={t('form.maxTotalUses')}
            hint={locked ? t('form.maxTotalUsesMin', { n: inUse }) : t('form.maxTotalUsesHint')}
            inputMode="numeric"
            value={draft.maxTotalUses}
            onChange={(e) => patch({ maxTotalUses: e.target.value.replace(/[^\d]/g, '') })}
            error={errors.maxTotalUses}
            {...(existing?.batchId ? { disabled: true, 'aria-disabled': true as const } : {})}
          />
          <div className="flex flex-col">
            <Input
              label={t('form.maxPerCustomer')}
              hint={locked ? undefined : t('form.maxPerCustomerHint')}
              inputMode="numeric"
              value={draft.maxUsesPerCustomer}
              onChange={(e) => patch({ maxUsesPerCustomer: e.target.value.replace(/[^\d]/g, '') })}
              error={errors.maxUsesPerCustomer}
              {...lockProps}
            />
            {locked && (
              <p className="mt-1 inline-flex items-center gap-1 font-mono text-xs text-muted">
                <Lock size={12} aria-hidden /> {t('form.lockedReason')}
              </p>
            )}
          </div>
        </DiscountConfigFields>
      </div>

      {!locked && <p className="rule-note mt-8 text-[13px] leading-[1.7] text-muted">{t('form.lockNote')}</p>}

      <p role="status" aria-live="polite" className="mt-4 text-sm text-text empty:hidden">
        {saved ? t('form.saved') : ''}
      </p>

      {/* «Guardar» abajo; fijo en móvil (§DSC-UX.5). */}
      <div className="sticky bottom-0 z-10 -mx-5 mt-6 flex flex-wrap gap-3 border-t border-border bg-bg px-5 py-3 lg:static lg:mx-0 lg:border-0 lg:px-0">
        <Button type="submit" variant="accent" loading={save.isPending} className="min-h-[48px]">
          {existing ? t('saveChanges') : t('saveCode')}
        </Button>
        {existing && (
          <Button type="button" variant="secondary" loading={toggle.isPending} className="min-h-[48px]" onClick={() => toggle.mutate()}>
            {existing.status === 'paused' ? t('resume') : t('pause')}
          </Button>
        )}
        <Link href="/admin/codes" className="inline-flex min-h-[48px] items-center px-3 text-sm underline underline-offset-4">
          {t('cancel')}
        </Link>
      </div>
    </form>
  );
}
