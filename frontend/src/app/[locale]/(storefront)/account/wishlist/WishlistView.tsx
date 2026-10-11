'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { addWishlistItem, getWishlist, removeWishlistItem, setWishlistAlertsPaused } from '@/lib/api';
import { asApiError } from '@/lib/api-client';
import { useResendVerification } from '@/hooks/useResendVerification';
import { Link } from '@/i18n/navigation';
import type { WishlistItemDTO, WishlistResponse } from '@/types/contract';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { Toaster, useToasts } from '@/components/ui/Toast';
import { useErrorMessage } from '@/components/ui/QueryState';
import { WishlistRow } from './WishlistRow';
import { WishlistSearch } from './WishlistSearch';

const KEY = ['wishlist'] as const;

const isFeatureOff = (e: unknown) => {
  const err = asApiError(e);
  return err?.status === 404 && err.code === 'FEATURE_DISABLED';
};

/**
 * «Mi lista de deseos» (`/account/wishlist`, DESIGN_SYSTEM §WSH-UX.3 · API_CONTRACT §WSH.4). Misma columna editorial que
 * «Mi cuenta». Orden de renglones = el del servidor (`createdAt` desc); sin paginación (≤ `limit`).
 * `404 FEATURE_DISABLED` ⇒ «aún no está disponible» (alguien entró por URL con el dial apagado, WSH-5).
 */
export function WishlistView() {
  const t = useTranslations('wishlist');
  const tc = useTranslations('common');
  const getMessage = useErrorMessage();
  const qc = useQueryClient();
  const { toasts, push, dismiss } = useToasts();
  const [status, setStatus] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef<Map<string, HTMLElement>>(new Map());

  const list = useQuery({ queryKey: KEY, queryFn: getWishlist, retry: false });

  function patchCache(fn: (d: WishlistResponse) => WishlistResponse) {
    qc.setQueryData<WishlistResponse>(KEY, (d) => (d ? fn(d) : d));
  }
  function dropLocally(id: string) {
    patchCache((d) => ({ ...d, items: d.items.filter((i) => i.id !== id), count: Math.max(0, d.count - 1) }));
  }
  /** El foco pasa al renglón siguiente, o al buscador si era el último (WSH-UX.4 e). */
  function focusAfter(id: string) {
    const items = list.data?.items ?? [];
    const i = items.findIndex((x) => x.id === id);
    const next = items[i + 1] ?? items[i - 1];
    requestAnimationFrame(() => {
      const el = next ? rowRefs.current.get(next.id) : null;
      (el ?? searchRef.current)?.focus();
    });
  }

  const alerts = useMutation({
    mutationFn: (paused: boolean) => setWishlistAlertsPaused(paused),
    onMutate: () => setStatus(null),
    onSuccess: (r) => {
      patchCache((d) => ({ ...d, alertsPaused: r.alertsPaused }));
      if (!r.alertsPaused) setStatus(t('page.resumed'));
    },
  });

  const undo = useMutation({
    mutationFn: (it: WishlistItemDTO) => addWishlistItem({ cardId: it.card.id, finish: it.finish, maxPct: it.maxPct }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
    onError: (e) => {
      const err = asApiError(e);
      push({
        variant: 'danger',
        message: err?.code === 'WISHLIST_LIMIT_REACHED' ? t('row.undoFull') : t('row.undoError'),
      });
      void qc.invalidateQueries({ queryKey: KEY });
    },
  });

  const remove = useMutation({
    mutationFn: (it: WishlistItemDTO) => removeWishlistItem(it.id),
    onMutate: () => setStatus(null),
    onSuccess: (_, it) => {
      focusAfter(it.id);
      dropLocally(it.id);
      push({
        variant: 'info',
        message: t('row.removedToast', { card: it.card.name }),
        undo: { label: t('row.undo'), onUndo: () => undo.mutate(it) },
      });
    },
    onError: (e, it) => {
      const err = asApiError(e);
      if (err?.status === 404 && err.code !== 'FEATURE_DISABLED') {
        focusAfter(it.id);
        dropLocally(it.id);
        setStatus(t('row.gone'));
        return;
      }
      push({ variant: 'danger', message: getMessage(e) });
    },
  });

  if (list.isLoading) {
    return (
      <Column>
        <div className="flex flex-col gap-4" aria-busy="true">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      </Column>
    );
  }

  if (list.isError) {
    if (isFeatureOff(list.error)) {
      return (
        <Column>
          <EmptyState
            title={t('page.disabled')}
            action={
              <Link href="/account" className="border-b border-text pb-0.5 text-sm text-text hover:text-accent">
                {t('page.back')}
              </Link>
            }
          />
        </Column>
      );
    }
    return (
      <Column>
        <Banner
          variant="danger"
          role="alert"
          title={tc('errorTitle')}
          action={
            <Button size="sm" variant="secondary" onClick={() => list.refetch()}>
              {tc('retry')}
            </Button>
          }
        >
          {getMessage(list.error)}
        </Banner>
      </Column>
    );
  }

  const data = list.data!;
  const full = data.count >= data.limit;

  return (
    <Column>
      <Link href="/account" className="font-mono text-xs tracking-[0.06em] text-muted hover:text-text">
        {t('page.back')}
      </Link>
      <p className="eyebrow mt-6">{t('page.eyebrow')}</p>
      <h1 className="mt-3 font-serif text-[30px] leading-[1.1] text-text lg:text-[40px]">{t('page.title')}</h1>
      <p className="mt-3 text-[15px] text-muted">{t('page.subtitle', { count: data.count, limit: data.limit })}</p>

      <div className="mt-6 flex flex-col gap-3">
        {data.alertsPaused && (
          <Banner
            variant="info"
            action={
              <Button size="sm" variant="secondary" loading={alerts.isPending} onClick={() => alerts.mutate(false)}>
                {t('page.resume')}
              </Button>
            }
          >
            <p className="text-text">{t('page.pausedBanner')}</p>
            <p className="mt-1">{t('page.pausedLost')}</p>
          </Banner>
        )}
        {!data.emailVerified && <UnverifiedBanner />}
        {status && (
          <p role="status" className="text-sm text-text">
            {status}
          </p>
        )}
      </div>

      <p className="rule-note mt-6 text-[13px] leading-[1.65] text-muted">{t('page.signalNote')}</p>

      <div className="mt-8">
        {full ? (
          <p className="text-sm text-text">{t('page.full', { count: data.count, limit: data.limit })}</p>
        ) : (
          <WishlistSearch ref={searchRef} />
        )}
      </div>

      <div className="mt-8 border-t border-border">
        {data.items.length === 0 ? (
          <EmptyState title={t('page.emptyTitle')} body={t('page.emptyBody')} />
        ) : (
          data.items.map((it) => (
            <WishlistRow
              key={it.id}
              ref={(el) => {
                if (el) rowRefs.current.set(it.id, el);
                else rowRefs.current.delete(it.id);
              }}
              item={it}
              ivaRatePct={data.ivaRatePct}
              removing={remove.isPending && remove.variables?.id === it.id}
              onPatched={(dto) => patchCache((d) => ({ ...d, items: d.items.map((x) => (x.id === dto.id ? dto : x)) }))}
              onGone={(id) => {
                focusAfter(id);
                dropLocally(id);
                setStatus(t('row.gone'));
              }}
              onRemove={(item) => remove.mutate(item)}
            />
          ))
        )}
      </div>

      <section aria-labelledby="wishlist-alerts-title" className="mt-12 border-t border-border pt-8">
        <h2 id="wishlist-alerts-title" className="font-serif text-2xl leading-tight text-text">
          {t('page.alertsTitle')}
        </h2>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
          <p className="max-w-md text-sm text-muted">{t('page.alertsBody')}</p>
          <Button
            size="sm"
            variant="secondary"
            loading={alerts.isPending}
            onClick={() => alerts.mutate(!data.alertsPaused)}
          >
            {data.alertsPaused ? t('page.resume') : t('page.pause')}
          </Button>
        </div>
        {alerts.isError && (
          <p role="alert" className="mt-3 text-sm text-accent">
            {getMessage(alerts.error)}
          </p>
        )}
      </section>

      <Toaster toasts={toasts} onDismiss={dismiss} />
    </Column>
  );
}

function Column({ children }: { children: React.ReactNode }) {
  return <div className="gutter mx-auto max-w-2xl py-10 lg:py-14">{children}</div>;
}

/** «Verifica tu correo» con los cuatro estados de `useResendVerification` (§33.6 b). */
function UnverifiedBanner() {
  const t = useTranslations('wishlist.page');
  const tv = useTranslations('verifyEmail');
  const { status, resend } = useResendVerification();
  return (
    <Banner
      variant="warning"
      action={
        status === 'sent' ? undefined : (
          <Button size="sm" variant="secondary" loading={status === 'sending'} onClick={resend}>
            {status === 'sending' ? tv('sending') : tv('resendCta')}
          </Button>
        )
      }
    >
      <p className="text-text">{t('unverifiedBanner')}</p>
      {status === 'sent' && (
        <p role="status" className="mt-1 text-success">
          {tv('sent')}
        </p>
      )}
      {status === 'rateLimited' && (
        <p role="alert" className="mt-1 text-accent">
          {tv('rateLimited')}
        </p>
      )}
      {status === 'error' && (
        <p role="alert" className="mt-1 text-accent">
          {tv('resendError')}
        </p>
      )}
    </Banner>
  );
}
