'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { ChevronLeft, Lock } from 'lucide-react';
import { getAdminUser, getAdminUserIneLinks, updateUserKyc } from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { Link } from '@/i18n/navigation';
import { formatDate } from '@/lib/format';
import type { AppLocale } from '@/i18n/routing';
import type { KycStatus } from '@/types/contract';
import { Button } from '@/components/ui/Button';
import { Banner } from '@/components/ui/Banner';
import { Modal } from '@/components/ui/Modal';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { useErrorMessage } from '@/components/ui/QueryState';
import { IdDocumentViewer, type IdDocumentState } from '@/components/domain/kyc/IdDocumentViewer';
import { IdDocumentLightbox } from '@/components/domain/kyc/IdDocumentLightbox';
import { KycIdentityPanel } from '@/components/domain/kyc/KycIdentityPanel';
import { KycRejectDialog } from '@/components/domain/kyc/KycRejectDialog';

/** Segundos que el botón queda apagado tras un `429` (el contrato acota a 10 emisiones/min). */
const RATE_LIMIT_COOLDOWN_SECONDS = 60;

type Side = 'front' | 'back';

/**
 * **La pantalla de revisión de identidad** (DESIGN_SYSTEM §34 · contrato §M6-K).
 *
 * El defecto que cierra, en una línea: *guardamos la INE y nadie podía verla, así que el panel
 * dejaba marcar «verificado» sin haber visto nada*. Aquí se ve el documento **junto al nombre y las
 * direcciones**, que es lo que el dueño pidió para poder cotejar contra el destino de envío.
 *
 * Tres decisiones que NO son estilo y conviene no deshacer:
 * 1. **Dos `QueryState` independientes** (ficha / enlaces): que la imagen tarde no puede dejar la
 *    pantalla sin el nombre, y que falle el cotejo no puede tapar la INE (§34.2d).
 * 2. **Los enlaces se piden UNA vez al montar y nunca automáticamente** (§34.3c.4): cada emisión es
 *    **una fila de bitácora** y una de las **10 por minuto**. Por eso `staleTime: Infinity`,
 *    `refetchOnWindowFocus/Reconnect: false` y —lo más importante— **`retry: false`**: un reintento
 *    silencioso serían tres filas de «quién miró» por un acto que nadie pidió.
 * 3. **Tras decidir, la página no navega sola y las imágenes siguen a la vista** (§34.6c): el
 *    revisor puede querer mirar otra vez lo que acaba de juzgar.
 */
export function KycReviewView({ userId }: { userId: string }) {
  const t = useTranslations('admin.m6.kycReview');
  const tm6 = useTranslations('admin.m6');
  const tc = useTranslations('common');
  const locale = useLocale() as AppLocale;
  const qc = useQueryClient();
  // Superficie de back-office ⇒ declara su audiencia (§26, candado de `error-audience.test.ts`).
  const getErrorMessage = useErrorMessage('operator');

  const detail = useQuery({
    queryKey: ['admin-user', userId],
    queryFn: () => getAdminUser(userId),
  });

  const links = useQuery({
    queryKey: ['admin-user-ine-links', userId],
    queryFn: () => getAdminUserIneLinks(userId),
    // ⛔ NADA de esto es negociable: ver el punto 2 del comentario de arriba.
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const d = detail.data;
  const kyc = d?.kycProfile ?? null;

  // --- Estado de lectura del documento: rotación por cara, cara visible y visor ---
  const [rotation, setRotation] = useState<{ front: number; back: number }>({ front: 0, back: 0 });
  const [lightboxSide, setLightboxSide] = useState<Side | null>(null);
  const [imageFailed, setImageFailed] = useState<{ front: boolean; back: boolean }>({ front: false, back: false });
  const frontEnlargeRef = useRef<HTMLButtonElement>(null);
  const backEnlargeRef = useRef<HTMLButtonElement>(null);

  const rotate = useCallback((side: Side, delta: number) => {
    setRotation((r) => ({ ...r, [side]: (r[side] + delta + 360) % 360 }));
  }, []);

  // --- `429`: el botón queda apagado ~60 s CON LA CUENTA A LA VISTA (§34.3c) ---
  const [cooldown, setCooldown] = useState(0);
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  const linksError = links.error instanceof ApiClientError ? links.error : null;
  useEffect(() => {
    if (linksError?.code === 'TOO_MANY_REQUESTS') setCooldown(RATE_LIMIT_COOLDOWN_SECONDS);
  }, [linksError]);

  /**
   * «Volver a pedir el enlace» — **acto del revisor, jamás automático**. Pide **las dos caras en
   * una sola llamada** (una fila de bitácora para un acto) y **sustituye el `src` sin desmontar**,
   * así que zoom, encuadre, rotación y cara sobreviven: el visor **no se cierra**.
   */
  const requestLinks = useCallback(() => {
    setImageFailed({ front: false, back: false });
    void links.refetch();
  }, [links]);

  const linkData = links.data;
  const expired = !!linkData && new Date(linkData.front.expiresAt).getTime() <= Date.now();

  function stateFor(side: Side): IdDocumentState {
    if (linksError?.code === 'TOO_MANY_REQUESTS' || cooldown > 0) return 'rateLimited';
    if (links.isFetching && !linkData) return 'loading';
    if (links.isError || !linkData) return 'error';
    const url = side === 'front' ? linkData.front.url : linkData.back.url;
    if (!url) return 'missing';
    // La carga NUEVA falló: si además el enlace ya venció, el revisor merece saber cuál de las dos
    // cosas pasó — «error» mandaría a buscar un fallo que no existe (§34.3c).
    if (imageFailed[side]) return expired ? 'expired' : 'error';
    return 'ready';
  }

  // --- Decidir (§34.6). Las DOS acciones llaman al MISMO `PATCH` que ya existía y ya se auditaba.
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [decision, setDecision] = useState<{ status: KycStatus; at: string; reason?: string } | null>(null);
  const [stale, setStale] = useState(false);
  const baselineRef = useRef<KycStatus | null>(null);

  // El estado DE PARTIDA con el que se abrió la pantalla. No hay código de conflicto en el
  // contrato (§34.15 A4), así que esto es **detección, no prevención** — y se dice así.
  useEffect(() => {
    if (!kyc || baselineRef.current !== null) return;
    baselineRef.current = kyc.kycStatus;
  }, [kyc]);

  const decideMutation = useMutation({
    mutationFn: (input: { kycStatus: KycStatus; rejectionReason?: string }) => updateUserKyc(userId, input),
    onSuccess: (updated, input) => {
      const profile = updated.kycProfile;
      if (profile && profile.kycStatus !== input.kycStatus) setStale(true);
      setDecision({
        status: input.kycStatus,
        at: profile?.reviewedAt ?? profile?.verifiedAt ?? new Date().toISOString(),
        reason: input.rejectionReason,
      });
      baselineRef.current = input.kycStatus;
      setVerifyOpen(false);
      setRejectOpen(false);
      // La ficha de atrás y la lista tienen que contar lo mismo (patrón de `M6View`).
      qc.invalidateQueries({ queryKey: ['admin-user', userId] });
      qc.invalidateQueries({ queryKey: ['admin-users'] });
    },
  });

  const decideError = decideMutation.error instanceof ApiClientError ? decideMutation.error : null;
  const reasonFieldError =
    decideError?.code === 'KYC_REJECTION_REASON_REQUIRED' ||
    (decideError?.code === 'VALIDATION_ERROR' && decideError.details?.field === 'rejectionReason');

  const currentStatus: KycStatus = decision?.status ?? kyc?.kycStatus ?? 'none';
  const backHref = `/admin/m6?user=${userId}`;

  // ---------- Estados de página ----------
  if (detail.isLoading) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-[320px] w-full max-w-[720px]" />
      </div>
    );
  }

  if (detail.isError || !d) {
    return (
      <div className="flex flex-col gap-4">
        <Banner variant="danger" role="alert" title={tc('errorTitle')}>
          {getErrorMessage(detail.error)}
        </Banner>
        <BackLink href={backHref} label={t('back')} />
      </div>
    );
  }

  const ineNotOnFile = linksError?.code === 'INE_NOT_ON_FILE';
  const frontOnFile = linksError?.details?.frontOnFile === true;
  const backOnFile = linksError?.details?.backOnFile === true;
  // `purged` no es teórico: hay un job de retención que borra los objetos y limpia las llaves. Si
  // la ficha dice que había INE y el servidor contesta que no queda ninguna cara, lo que pasó es
  // que se cumplió la retención — pintar «error de carga» mandaría a buscar un fallo inexistente.
  const purged = ineNotOnFile && !frontOnFile && !backOnFile && kyc?.ineOnFile === true;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <BackLink href={backHref} label={t('back')} />
        <p className="eyebrow">{t('eyebrow')}</p>
        {/* El NOMBRE es el h1: la pregunta de esta pantalla es «¿esta INE es de esta persona?». */}
        <h1 className="font-serif text-h1">{d.name}</h1>
        <div className="flex flex-wrap items-center gap-2 text-[15px] text-muted">
          <span className="tabular">{d.email}</span>
          <span aria-hidden>·</span>
          <span>
            {t('createdAt')} {formatDate(d.createdAt, locale)}
          </span>
          <StatusBadge domain="kyc" value={currentStatus} />
        </div>
      </div>

      {/* Regla 3: quien mira, sabe que se registra. UNA línea, encima del documento, sin sermón.
          Va en un <p> y no en un Banner: no es una alerta, es una condición del sitio. */}
      <p className="flex items-center gap-1 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
        <Lock size={12} aria-hidden /> {t('privacy')}
      </p>

      {linksError?.code === 'TOO_MANY_REQUESTS' && (
        <Banner variant="warning" role="alert">
          {cooldown > 0 ? t('imgRateLimitedCountdown', { seconds: cooldown }) : t('imgRateLimited')}
        </Banner>
      )}
      {linksError?.code === 'AUDIT_WRITE_FAILED' && (
        <Banner
          variant="danger"
          role="alert"
          action={
            <Button size="sm" variant="secondary" onClick={requestLinks}>
              {t('imgRetry')}
            </Button>
          }
        >
          {t('imgAuditFailed')}
        </Banner>
      )}
      {stale && (
        <Banner
          variant="warning"
          role="alert"
          action={
            <Button size="sm" variant="secondary" onClick={() => detail.refetch()}>
              {t('reload')}
            </Button>
          }
        >
          {t('stale')}
        </Banner>
      )}

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_360px]">
        <div className="flex min-w-0 flex-col gap-6">
          {ineNotOnFile ? (
            <EmptyState
              title={t('emptyTitle')}
              body={
                purged
                  ? t('imgPurged')
                  : frontOnFile
                    ? t('emptyOnlyFront')
                    : backOnFile
                      ? t('emptyOnlyBack')
                      : t('emptyBody')
              }
              action={<BackLink href={backHref} label={t('back')} />}
            />
          ) : (
            <>
              <IdDocumentViewer
                side="front"
                url={linkData?.front.url}
                holderName={d.name}
                state={stateFor('front')}
                rotation={rotation.front}
                onRotate={(delta) => rotate('front', delta)}
                onEnlarge={() => setLightboxSide('front')}
                onRequestLink={requestLinks}
                requesting={links.isFetching}
                rateLimitSeconds={cooldown}
                showRotateHint
                onImageError={() => setImageFailed((s) => ({ ...s, front: true }))}
                onImageLoad={() => setImageFailed((s) => ({ ...s, front: false }))}
                enlargeRef={frontEnlargeRef}
              />
              <IdDocumentViewer
                side="back"
                url={linkData?.back.url}
                holderName={d.name}
                state={stateFor('back')}
                rotation={rotation.back}
                onRotate={(delta) => rotate('back', delta)}
                onEnlarge={() => setLightboxSide('back')}
                onRequestLink={requestLinks}
                requesting={links.isFetching}
                rateLimitSeconds={cooldown}
                onImageError={() => setImageFailed((s) => ({ ...s, back: true }))}
                onImageLoad={() => setImageFailed((s) => ({ ...s, back: false }))}
                enlargeRef={backEnlargeRef}
              />
            </>
          )}
        </div>

        <KycIdentityPanel
          name={d.name}
          nameSource={d.nameSource}
          email={d.email}
          phone={d.phone}
          clabeMasked={kyc?.clabeMasked}
          createdAt={d.createdAt}
          addresses={d.addresses ?? []}
          recentShipmentRecipients={d.recentShipmentRecipients ?? []}
          locale={locale}
        />
      </div>

      {/* Barra de acciones. ⛔ No se pinta cuando no hay nada que revisar (§34.2d). */}
      {!ineNotOnFile && (
        <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-bg py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {decision ? (
            <div className="flex flex-1 flex-wrap items-center gap-3">
              <div className="flex flex-col gap-1">
                <p
                  role="status"
                  className={`font-mono text-[11px] uppercase tracking-[0.14em] ${
                    decision.status === 'verified'
                      ? 'text-success'
                      : decision.status === 'rejected'
                        ? 'text-accent'
                        : 'text-muted'
                  }`}
                >
                  {decision.status === 'verified'
                    ? t('verifiedResult', { date: formatDate(decision.at, locale) })
                    : decision.status === 'rejected'
                      ? t('rejectedResult', { date: formatDate(decision.at, locale) })
                      : t('undoDone')}
                </p>
                {decision.reason && <p className="text-sm text-text">«{decision.reason}»</p>}
              </div>
              {/* Deshacer, sin ceremonia: un clic equivocado no puede dejar al cliente con un
                  rechazo y al revisor sin marcha atrás visible. ⛔ No borra imágenes. */}
              <Button
                size="sm"
                variant="ghost"
                loading={decideMutation.isPending}
                onClick={() => decideMutation.mutate({ kycStatus: 'none' })}
              >
                {t('undo')}
              </Button>
              <BackLink href={backHref} label={t('back')} />
            </div>
          ) : (
            <>
              <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
                {t('statusNow')}: {tm6(`kycStatusOption.${currentStatus}`)}
              </span>
              <div className="flex flex-1 flex-wrap justify-end gap-2 sm:flex-none">
                <Button
                  variant="primary"
                  className="w-full sm:w-auto"
                  onClick={() => setVerifyOpen(true)}
                  disabled={decideMutation.isPending}
                >
                  {t('verify')}
                </Button>
                <Button
                  variant="accent"
                  className="w-full sm:w-auto"
                  onClick={() => setRejectOpen(true)}
                  disabled={decideMutation.isPending}
                >
                  {t('reject')}
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {decideError && !rejectOpen && !reasonFieldError && (
        <Banner variant="danger" role="alert">
          {getErrorMessage(decideError)}
        </Banner>
      )}

      <Modal
        open={verifyOpen}
        onClose={() => setVerifyOpen(false)}
        title={t('verifyTitle')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setVerifyOpen(false)}>
              {tc('cancel')}
            </Button>
            <Button
              variant="primary"
              loading={decideMutation.isPending}
              onClick={() => decideMutation.mutate({ kycStatus: 'verified' })}
            >
              {decideMutation.isPending ? t('verifying') : t('verifyConfirm')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-2">
          <p>{t('verifyBody1')}</p>
          <p>{t('verifyBody2')}</p>
        </div>
      </Modal>

      <KycRejectDialog
        open={rejectOpen}
        onClose={() => setRejectOpen(false)}
        onSubmit={(reason) => decideMutation.mutate({ kycStatus: 'rejected', rejectionReason: reason })}
        submitting={decideMutation.isPending}
        submitError={decideError ? getErrorMessage(decideError) : null}
        submitErrorOnField={reasonFieldError}
        initialPreset={linksError && ineNotOnFile ? 'missingSide' : undefined}
      />

      <IdDocumentLightbox
        open={lightboxSide !== null}
        side={lightboxSide ?? 'front'}
        onSideChange={setLightboxSide}
        urls={{ front: linkData?.front.url, back: linkData?.back.url }}
        states={{ front: stateFor('front'), back: stateFor('back') }}
        holderName={d.name}
        rotation={rotation}
        onRotate={rotate}
        onRequestLink={requestLinks}
        requesting={links.isFetching}
        onImageError={(side) => setImageFailed((s) => ({ ...s, [side]: true }))}
        onImageLoad={(side) => setImageFailed((s) => ({ ...s, [side]: false }))}
        onClose={() => {
          const opened = lightboxSide;
          setLightboxSide(null);
          // El foco vuelve al botón que lo abrió (§7.6).
          (opened === 'back' ? backEnlargeRef : frontEnlargeRef).current?.focus();
        }}
      />
    </div>
  );
}

function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1 text-sm text-accent hover:text-text">
      <ChevronLeft size={16} aria-hidden /> {label}
    </Link>
  );
}
