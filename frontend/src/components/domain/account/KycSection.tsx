'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { getKyc, updateKyc } from '@/lib/api';
import { formatMoneyCents } from '@/lib/format';
import { getBadgeSpec } from '@/lib/status-map';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { PhotoUploader } from '@/components/ui/PhotoUploader';
import type { AppLocale } from '@/i18n/routing';
import { SaveStatus, SectionError, SectionShell } from './SectionShell';

/** Misma `CLABE_RE` que `BuylistKycForm`. */
const CLABE_RE = /^\d{18}$/;

/**
 * e · Verificación de identidad y CLABE (`#kyc`, DESIGN_SYSTEM §33.6e). Lectura de `GET
 * /users/me/kyc` (estado con rótulo de `status.kyc.*`, nunca el enum crudo §9.2; CLABE
 * enmascarada tal cual; INE en archivo o no; topes SOLO si el DTO los trae). «Cambiar CLABE» y, si
 * `ineOnFile === false`, dos `PhotoUploader` + «Guardar». ⛔ No se ofrece re-subir el INE en archivo.
 */
export function KycSection() {
  const t = useTranslations('account.kyc');
  const tAcc = useTranslations('account');
  const tAll = useTranslations();
  const tIne = useTranslations('ine');
  const locale = useLocale() as AppLocale;
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['kyc'], queryFn: getKyc });

  const [clabeOpen, setClabeOpen] = useState(false);
  const [clabe, setClabe] = useState('');
  const [clabeError, setClabeError] = useState<string | undefined>();
  const [clabeSaved, setClabeSaved] = useState(false);
  const [ineFront, setIneFront] = useState<string | null>(null);
  const [ineBack, setIneBack] = useState<string | null>(null);
  const [ineSaved, setIneSaved] = useState(false);

  const clabeMut = useMutation({
    mutationFn: (value: string) => updateKyc({ clabe: value }),
    onSuccess: (kyc) => {
      qc.setQueryData(['kyc'], kyc);
      setClabeOpen(false);
      setClabe('');
      setClabeSaved(true);
    },
  });
  const ineMut = useMutation({
    mutationFn: (keys: { front: string; back: string }) =>
      updateKyc({ ineFrontUploadKey: keys.front, ineBackUploadKey: keys.back }),
    onSuccess: (kyc) => {
      qc.setQueryData(['kyc'], kyc);
      setIneSaved(true);
    },
  });

  function submitClabe(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setClabeSaved(false);
    if (!CLABE_RE.test(clabe)) return setClabeError(t('clabeInvalid'));
    setClabeError(undefined);
    clabeMut.mutate(clabe);
  }

  const data = query.data;
  const statusLabel = data ? tAll(getBadgeSpec('kyc', data.kycStatus).i18nKey) : '';

  return (
    <SectionShell id="kyc" title={t('title')}>
      {query.isLoading ? (
        <div className="flex flex-col gap-3" aria-busy="true">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ) : query.isError || !data ? (
        <SectionError error={query.error} onRetry={() => query.refetch()} />
      ) : (
        <div>
          <dl className="grid grid-cols-1 sm:grid-cols-2">
            <div className="border-b border-border py-3">
              <dt className="eyebrow">{t('status')}</dt>
              <dd className="mt-1 text-sm text-text">{statusLabel}</dd>
            </div>
            <div className="border-b border-border py-3">
              <dt className="eyebrow">{t('clabe')}</dt>
              <dd className="mt-1 text-sm text-text">
                {data.clabeMasked ? (
                  <span className="tabular font-mono">{data.clabeMasked}</span>
                ) : (
                  <span className="text-muted">{t('clabeNone')}</span>
                )}
                {!clabeOpen && (
                  <button
                    type="button"
                    onClick={() => {
                      setClabeOpen(true);
                      setClabeSaved(false);
                    }}
                    className="ml-3 font-mono text-[11px] text-accent hover:text-text"
                  >
                    {t('clabeChange')}
                  </button>
                )}
              </dd>
            </div>
            <div className="border-b border-border py-3">
              <dt className="eyebrow">{t('ine')}</dt>
              <dd className={data.ineOnFile ? 'mt-1 text-sm text-success' : 'mt-1 text-sm text-muted'}>
                {data.ineOnFile ? t('ineOnFile') : t('ineMissing')}
              </dd>
            </div>
            {typeof data.capPerRequestCents === 'number' && (
              <div className="border-b border-border py-3">
                <dt className="eyebrow">{t('capPerRequest')}</dt>
                <dd className="tabular mt-1 font-mono text-sm text-text">
                  {formatMoneyCents(data.capPerRequestCents, locale)}
                </dd>
              </div>
            )}
            {typeof data.capPerMonthCents === 'number' && (
              <div className="border-b border-border py-3">
                <dt className="eyebrow">{t('capPerMonth')}</dt>
                <dd className="tabular mt-1 font-mono text-sm text-text">
                  {formatMoneyCents(data.capPerMonthCents, locale)}
                </dd>
              </div>
            )}
          </dl>
          <div className="mt-2">
            <SaveStatus saved={clabeSaved || ineSaved} error={null} />
          </div>

          {clabeOpen && (
            <form onSubmit={submitClabe} noValidate className="mt-6 flex flex-col gap-4">
              <Input
                label={t('clabe')}
                name="clabe"
                inputMode="numeric"
                maxLength={18}
                autoComplete="off"
                value={clabe}
                onChange={(e) => setClabe(e.target.value.replace(/\D/g, ''))}
                hint={t('clabeHint')}
                error={clabeError}
                className="font-mono"
              />
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <Button type="submit" size="sm" variant="secondary" loading={clabeMut.isPending} className="w-full sm:w-auto">
                  {clabeMut.isPending ? tAcc('saving') : tAcc('save')}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setClabeOpen(false)} className="w-full sm:w-auto">
                  {tAll('addresses.cancel')}
                </Button>
                <SaveStatus saved={false} error={clabeMut.isError ? clabeMut.error : null} />
              </div>
            </form>
          )}

          {!data.ineOnFile && (
            <div className="mt-8 flex flex-col gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <PhotoUploader label={t('ineFront')} purpose="kyc_ine" onUploaded={setIneFront} onCleared={() => setIneFront(null)} />
                <PhotoUploader label={t('ineBack')} purpose="kyc_ine" onUploaded={setIneBack} onCleared={() => setIneBack(null)} />
              </div>
              <p className="text-xs text-muted">{tIne('privacy')}</p>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={!ineFront || !ineBack}
                  loading={ineMut.isPending}
                  onClick={() => ineFront && ineBack && ineMut.mutate({ front: ineFront, back: ineBack })}
                  className="w-full sm:w-auto"
                >
                  {ineMut.isPending ? tAcc('saving') : tAcc('save')}
                </Button>
                <SaveStatus saved={false} error={ineMut.isError ? ineMut.error : null} />
              </div>
            </div>
          )}
        </div>
      )}
    </SectionShell>
  );
}
