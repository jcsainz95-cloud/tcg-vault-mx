'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { getKyc, updateKyc } from '@/lib/api';
import { getBadgeSpec } from '@/lib/status-map';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { PhotoUploader } from '@/components/ui/PhotoUploader';
import { KycStateBlock } from '@/components/domain/kyc/KycStateBlock';
import { SaveStatus, SectionError, SectionShell } from './SectionShell';

/** Misma `CLABE_RE` que `BuylistKycForm`. */
const CLABE_RE = /^\d{18}$/;

/**
 * e · Verificación de identidad y CLABE (`#kyc`) — **reescrita por P-78** (DESIGN_SYSTEM §34.8,
 * que supersede §33.6e en este bloque; contrato §M6-K.7, tabla normativa).
 *
 * **El callejón que cierra:** la condición para ofrecer los uploaders era `!ineOnFile`
 * (`KycSection.tsx:162` antes de este pase), así que **quien ya había subido su INE veía
 * «Pendiente» y no podía hacer absolutamente nada** — ni cuando se la rechazábamos. Ahora la
 * condición es **el ESTADO**: `none`/`rejected` los muestran solos, `verified` los ofrece bajo
 * demanda (foto vencida) y en `pending` **no hay uploader** porque todavía no hay nada que
 * corregir — y eso **se dice con todas las letras**.
 *
 * ⛔ **Ninguna cifra de tope** (§34.9, decisión (c) del dueño): las dos filas de topes se retiraron
 * junto con sus claves. El número **ni aparece ni llega**: lo que llega es `ineRequiredForTotal`.
 * ⛔ **Ninguna fecha**: `GET /users/me/kyc` no trae ninguna y lo que no tenemos no se pinta.
 */
export function KycSection() {
  const t = useTranslations('account.kyc');
  const tAcc = useTranslations('account');
  const tAll = useTranslations();
  const tIne = useTranslations('ine');
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['kyc'], queryFn: () => getKyc() });

  const [clabeOpen, setClabeOpen] = useState(false);
  const [clabe, setClabe] = useState('');
  const [clabeError, setClabeError] = useState<string | undefined>();
  const [clabeSaved, setClabeSaved] = useState(false);
  const [ineFront, setIneFront] = useState<string | null>(null);
  const [ineBack, setIneBack] = useState<string | null>(null);
  const [ineSaved, setIneSaved] = useState(false);
  /** `verified` + «Actualizar mi identificación»: los uploaders bajo demanda. */
  const [updateOpen, setUpdateOpen] = useState(false);
  const blockRef = useRef<HTMLDivElement>(null);

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
      // La lista de requisitos del cotizador lee el mismo endpoint con el total cotizado.
      qc.invalidateQueries({ queryKey: ['kyc'] });
      setIneSaved(true);
      setUpdateOpen(false);
      setIneFront(null);
      setIneBack(null);
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
  const status = data?.kycStatus ?? 'none';

  /**
   * Al aterrizar con `#kyc` (el enlace que le mandamos cuando le rechazamos la INE), el bloque
   * recibe el foco: el cliente cae **en el motivo**, no en la cabecera de la página (patrón P-4).
   */
  useEffect(() => {
    if (!data || typeof window === 'undefined') return;
    if (window.location.hash !== '#kyc') return;
    blockRef.current?.focus();
    blockRef.current?.scrollIntoView({ block: 'center' });
  }, [data]);

  const ineLine =
    status === 'verified'
      ? { text: t('ineVerified'), cls: 'text-success' }
      : status === 'rejected'
        ? { text: t('ineRejected'), cls: 'text-accent' }
        : status === 'pending'
          ? { text: t('ineReceived'), cls: 'text-text' }
          : { text: t('ineMissing'), cls: 'text-muted' };

  // La regla que cierra el callejón (§34.8.1): la condición es el ESTADO, no `ineOnFile`.
  const showUploaders = status === 'none' || status === 'rejected' || (status === 'verified' && updateOpen);

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
          {/* Tres filas. Ni una más: las dos de topes se retiraron (§34.9). */}
          <dl className="grid grid-cols-1 sm:grid-cols-2">
            <div className="border-b border-border py-3">
              <dt className="eyebrow">{t('status')}</dt>
              {/* Rótulo de `status.kyc.*`, nunca el enum crudo (§9.2) — y NUNCA solo. */}
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
              <dd className={`mt-1 text-sm ${ineLine.cls}`}>{ineLine.text}</dd>
            </div>
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

          {/* El bloque de estado: qué pasó, qué le toca a él (aunque sea nada) y cuándo lo sabrá. */}
          <div className="mt-8">
            <KycStateBlock
              kycStatus={status}
              rejectionReason={data.rejectionReason}
              focusable
              blockRef={blockRef}
            >
              {status === 'verified' && !updateOpen && (
                <div className="flex flex-col gap-1">
                  <button
                    type="button"
                    onClick={() => setUpdateOpen(true)}
                    className="self-start text-sm text-accent hover:text-text"
                  >
                    {t('verified.update')}
                  </button>
                  <p className="text-xs text-muted">{t('verified.updateHint')}</p>
                </div>
              )}

              {showUploaders && (
                <div className="flex flex-col gap-4">
                  <p className="eyebrow">{t('uploadTitle')}</p>
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
                      {ineMut.isPending
                        ? tAcc('saving')
                        : status === 'none'
                          ? tAcc('save')
                          : /* «Volver a subir», no «Añadir»: no se acumulan intentos — al guardar,
                               la foto anterior se borra del almacenamiento (§M6-K.4.1). */
                            t('uploadAgain')}
                    </Button>
                    <SaveStatus saved={false} error={ineMut.isError ? ineMut.error : null} />
                  </div>
                </div>
              )}
            </KycStateBlock>
          </div>
        </div>
      )}
    </SectionShell>
  );
}
