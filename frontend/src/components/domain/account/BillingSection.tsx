'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { getBillingProfile, putBillingProfile } from '@/lib/api';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import type { BillingProfileDTO, BillingProfileInput } from '@/types/contract';
import { SaveStatus, SectionError, SectionShell } from './SectionShell';

type FieldKey = keyof BillingProfileInput;
const FIELDS: FieldKey[] = ['rfc', 'razonSocial', 'regimenFiscal', 'usoCfdi', 'postalCode', 'email'];

function emptyForm(email: string): BillingProfileInput {
  return { rfc: '', razonSocial: '', regimenFiscal: '', usoCfdi: '', postalCode: '', email };
}

/**
 * d · Facturación CFDI (`#billing`, DESIGN_SYSTEM §33.6d). `GET /users/me/billing-profile` (404 ⇒
 * vacío con CTA que abre el formulario EN LÍNEA, no modal); `PUT` con los seis campos, todos
 * obligatorios. ⚠ Los dos «clave SAT» son `Input` + hint: este front NO inventa el catálogo del
 * SAT (decisión R7b de product-owner). Con perfil: retícula de dos columnas + «Editar». El RFC del
 * GET viene ENMASCARADO (`rfcMasked`); al editar hay que teclearlo completo (`rfcHint`).
 */
export function BillingSection({ accountEmail }: { accountEmail: string }) {
  const t = useTranslations('account.billing');
  const tAcc = useTranslations('account');
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['billing-profile'], queryFn: getBillingProfile });
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<BillingProfileInput>(() => emptyForm(accountEmail));
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [saved, setSaved] = useState(false);

  const mut = useMutation({
    mutationFn: (input: BillingProfileInput) => putBillingProfile(input),
    onSuccess: (profile) => {
      qc.setQueryData(['billing-profile'], profile);
      setEditing(false);
      setSaved(true);
    },
  });

  function startEdit(profile: BillingProfileDTO | null) {
    setSaved(false);
    setErrors({});
    setForm(
      profile
        ? {
            rfc: '',
            razonSocial: profile.razonSocial,
            regimenFiscal: profile.regimenFiscal,
            usoCfdi: profile.usoCfdi,
            postalCode: profile.postalCode,
            email: profile.email || accountEmail,
          }
        : emptyForm(accountEmail),
    );
    setEditing(true);
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const next: Partial<Record<FieldKey, string>> = {};
    for (const k of FIELDS) if (!form[k].trim()) next[k] = tAcc('required');
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    mut.mutate({ ...form, rfc: form.rfc.trim().toUpperCase() });
  }

  const set = (k: FieldKey) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <SectionShell id="billing" title={t('title')}>
      {query.isLoading ? (
        <div className="flex flex-col gap-3" aria-busy="true">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/3" />
        </div>
      ) : query.isError ? (
        <SectionError error={query.error} onRetry={() => query.refetch()} />
      ) : editing ? (
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          <Input
            label={t('rfc')}
            name="rfc"
            value={form.rfc}
            onChange={set('rfc')}
            maxLength={13}
            hint={t('rfcHint')}
            error={errors.rfc}
            className="font-mono uppercase"
            autoCapitalize="characters"
          />
          <Input label={t('razonSocial')} name="razonSocial" value={form.razonSocial} onChange={set('razonSocial')} error={errors.razonSocial} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label={t('regimenFiscal')} name="regimenFiscal" value={form.regimenFiscal} onChange={set('regimenFiscal')} hint={t('satHint')} error={errors.regimenFiscal} />
            <Input label={t('usoCfdi')} name="usoCfdi" value={form.usoCfdi} onChange={set('usoCfdi')} hint={t('satHint')} error={errors.usoCfdi} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label={t('postalCode')} name="postalCode" inputMode="numeric" value={form.postalCode} onChange={set('postalCode')} error={errors.postalCode} />
            <Input label={t('email')} name="billingEmail" type="email" autoComplete="email" value={form.email} onChange={set('email')} error={errors.email} />
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button type="submit" size="sm" variant="secondary" loading={mut.isPending} className="w-full sm:w-auto">
              {mut.isPending ? tAcc('saving') : tAcc('save')}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)} className="w-full sm:w-auto">
              {t('cancel')}
            </Button>
            <SaveStatus saved={false} error={mut.isError ? mut.error : null} />
          </div>
        </form>
      ) : query.data ? (
        <div>
          <dl className="grid grid-cols-1 sm:grid-cols-2">
            {(
              [
                ['rfc', query.data.rfcMasked, true],
                ['razonSocial', query.data.razonSocial, false],
                ['regimenFiscal', query.data.regimenFiscal, true],
                ['usoCfdi', query.data.usoCfdi, true],
                ['postalCode', query.data.postalCode, true],
                ['email', query.data.email, false],
              ] as [FieldKey, string, boolean][]
            ).map(([k, v, mono]) => (
              <div key={k} className="border-b border-border py-3">
                <dt className="eyebrow">{t(k)}</dt>
                <dd className={mono ? 'tabular mt-1 font-mono text-sm text-text' : 'mt-1 text-sm text-text'}>
                  {v || '—'}
                </dd>
              </div>
            ))}
          </dl>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button size="sm" variant="secondary" onClick={() => startEdit(query.data ?? null)} className="w-full sm:w-auto">
              {t('edit')}
            </Button>
            <SaveStatus saved={saved} error={null} />
          </div>
        </div>
      ) : (
        <EmptyState
          title={t('emptyTitle')}
          body={t('emptyBody')}
          action={
            <Button variant="secondary" onClick={() => startEdit(null)}>
              {t('add')}
            </Button>
          }
        />
      )}
    </SectionShell>
  );
}
