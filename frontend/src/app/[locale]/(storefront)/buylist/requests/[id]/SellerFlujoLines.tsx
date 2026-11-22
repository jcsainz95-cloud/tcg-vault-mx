'use client';

/**
 * §BUYLIST-FLUJO F2 (diseño A) — portal del vendedor: responder una BAJA de precio con Aceptar / Rechazar grandes y elegir
 * cómo recoger una carta no aceptada. `accept` manda `expectedRevisedPriceCents` = el monto que el vendedor VIO (409
 * `REVISION_CHANGED` si cambió); el front muestra lo que manda el servidor y no suma nada. Anexo §3 y §5 de `docs/API_CONTRACT_BUYLIST_FLUJO.md`.
 */
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { chooseBuylistPickup, respondBuylistRevision } from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { formatDate, formatMoneyCents } from '@/lib/format';
import type { AppLocale } from '@/i18n/routing';
import type { BuylistPickupMethod, SellItemDTO, SellRequestDetailDTO } from '@/types/contract';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { CardImage } from '@/components/ui/CardImage';
import { cn } from '@/lib/cn';

const DAY_MS = 86_400_000;

function RevisionCard({
  sellRequestId,
  line,
  onChanged,
  onConflict,
}: {
  sellRequestId: string;
  line: SellItemDTO;
  onChanged: (fresh?: SellRequestDetailDTO) => void;
  /** 409 `REVISION_CHANGED` / `REVISION_ALREADY_RESOLVED`: el padre recarga y conserva el aviso aunque la tarjeta desaparezca. */
  onConflict: (itemId: string, kind: 'changed' | 'alreadyResolved', currentCents?: number) => void;
}) {
  const t = useTranslations('sellerFlujo');
  const locale = useLocale() as AppLocale;
  const rev = line.revision!;
  const [confirmDecline, setConfirmDecline] = useState(false);
  const respond = useMutation({
    mutationFn: (decision: 'accept' | 'decline') =>
      // `accept` manda el monto que ESTA pantalla mostró (CAS del servidor); `decline` no lleva monto.
      respondBuylistRevision(sellRequestId, line.id, decision, decision === 'accept' ? (rev.proposedCents ?? undefined) : undefined),
    onSuccess: (fresh) => onChanged(fresh),
    onError: (e) => {
      if (e instanceof ApiClientError && e.status === 409) {
        setConfirmDecline(false);
        if (e.code === 'REVISION_CHANGED') {
          const cur = (e.details as { currentRevisedPriceCents?: unknown } | undefined)?.currentRevisedPriceCents;
          onConflict(line.id, 'changed', typeof cur === 'number' ? cur : undefined);
        } else onConflict(line.id, 'alreadyResolved');
      }
    },
  });
  const err = respond.error;
  const errText =
    err instanceof ApiClientError
      ? err.status === 409
        ? null // lo explica el aviso del padre (sobrevive a la recarga)
        : err.status === 404
          ? t('revision.errors.notFound')
          : t('revision.errors.generic')
      : err
        ? t('revision.errors.generic')
        : null;
  const days = rev.expiresAt ? Math.max(0, Math.ceil((new Date(rev.expiresAt).getTime() - Date.now()) / DAY_MS)) : null;
  const proposed = rev.proposedCents != null ? formatMoneyCents(rev.proposedCents, locale) : '';
  return (
    <article className="border border-border-strong p-5 lg:p-6" data-testid={`seller-revision-${line.id}`}>
      <h3 className="font-serif text-[22px] leading-tight">{t('revision.title', { card: line.card.name })}</h3>
      <div className="mt-4 flex flex-col gap-4 sm:flex-row">
        <CardImage src={line.card.imageSmallUrl} alt={line.card.name} className="w-[96px] shrink-0" />
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted">{rev.reasonText || t('revision.reasonFallback')}</p>
          <p className="eyebrow">{t('revision.now')}</p>
          <p className="tabular font-serif text-4xl leading-none" data-testid={`seller-revision-amount-${line.id}`}>
            {proposed}
          </p>
          {rev.previousCents != null && (
            <p className="text-sm text-muted">{t('revision.before', { amount: formatMoneyCents(rev.previousCents, locale) })}</p>
          )}
        </div>
      </div>
      {days != null && <p className="mt-4 text-sm text-muted">{t('revision.deadline', { count: days })}</p>}
      <div className="mt-3 grid gap-3 sm:grid-cols-[3fr_2fr]">
        <Button
          size="lg"
          variant="accent"
          loading={respond.isPending && respond.variables === 'accept'}
          disabled={respond.isPending}
          onClick={() => respond.mutate('accept')}
          data-testid={`seller-revision-accept-${line.id}`}
        >
          {t('revision.accept', { amount: proposed })}
        </Button>
        <Button
          size="lg"
          variant="secondary"
          disabled={respond.isPending}
          aria-expanded={confirmDecline}
          onClick={() => setConfirmDecline(true)}
          data-testid={`seller-revision-decline-${line.id}`}
        >
          {t('revision.decline')}
        </Button>
      </div>
      {confirmDecline && (
        <div
          role="alertdialog"
          aria-label={t('revision.declineConfirmTitle', { amount: proposed })}
          className="mt-3 flex flex-col gap-3 border border-text p-4"
          data-testid={`seller-revision-decline-confirm-${line.id}`}
        >
          <p className="font-medium">{t('revision.declineConfirmTitle', { amount: proposed })}</p>
          <p className="text-sm text-muted">{t('revision.declineConfirmBody', { card: line.card.name })}</p>
          <div className="flex flex-wrap gap-3">
            <Button
              variant="destructive"
              loading={respond.isPending && respond.variables === 'decline'}
              disabled={respond.isPending}
              onClick={() => respond.mutate('decline')}
              data-testid={`seller-revision-decline-yes-${line.id}`}
            >
              {t('revision.declineConfirmYes')}
            </Button>
            <Button variant="secondary" disabled={respond.isPending} onClick={() => setConfirmDecline(false)} data-testid={`seller-revision-decline-no-${line.id}`}>
              {t('revision.declineConfirmNo')}
            </Button>
          </div>
        </div>
      )}
      {errText && (
        <Banner variant="danger" role="alert" className="mt-3">
          {errText}
        </Banner>
      )}
    </article>
  );
}

function PickupChoice({ sellRequestId, line, onChanged }: { sellRequestId: string; line: SellItemDTO; onChanged: (fresh?: SellRequestDetailDTO) => void }) {
  const t = useTranslations('sellerFlujo.pickup');
  const locale = useLocale() as AppLocale;
  const pickup = line.pickup!;
  const choose = useMutation({
    mutationFn: (method: BuylistPickupMethod) => chooseBuylistPickup(sellRequestId, line.id, method),
    onSuccess: (fresh) => onChanged(fresh),
  });
  const done = !!pickup.doneAt;
  const options: { method: BuylistPickupMethod; label: string; hint: string }[] = [
    { method: 'in_person', label: t('inPerson'), hint: t('inPersonHint') },
    { method: 'ship_back', label: t('shipBack'), hint: t('shipBackHint') },
  ];
  const err = choose.error;
  const errText = err
    ? err instanceof ApiClientError && err.code === 'PICKUP_ALREADY_DONE'
      ? t('errors.alreadyDone')
      : t('errors.generic')
    : null;
  return (
    <article className="border border-border p-5" data-testid={`seller-pickup-${line.id}`}>
      <h3 className="font-serif text-xl leading-tight">{t('title', { card: line.card.name })}</h3>
      {done ? (
        <p className="mt-3 text-sm text-text" data-testid={`seller-pickup-done-${line.id}`}>
          {t('done', { date: formatDate(pickup.doneAt as string, locale) })}
        </p>
      ) : (
        <>
          <p className="mt-2 text-sm text-muted">{t('intro')}</p>
          <div role="radiogroup" aria-label={t('intro')} className="mt-3 grid gap-3 sm:grid-cols-2">
            {options.map((o) => {
              const on = pickup.method === o.method;
              return (
                <button
                  key={o.method}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={choose.isPending}
                  onClick={() => choose.mutate(o.method)}
                  data-testid={`seller-pickup-${o.method}-${line.id}`}
                  className={cn(
                    'min-h-[64px] border px-4 py-3 text-left focus-visible:shadow-focus focus-visible:outline-none',
                    on ? 'border-text bg-text text-bg' : 'border-border-strong bg-surface hover:border-text',
                  )}
                >
                  <span className="block text-sm font-medium">
                    <span aria-hidden>{on ? '● ' : '○ '}</span>
                    {o.label}
                  </span>
                  <span className={cn('block text-xs', on ? 'text-bg' : 'text-muted')}>{o.hint}</span>
                </button>
              );
            })}
          </div>
          {pickup.returnDeadlineAt && pickup.abandonDeadlineAt && (
            <p className="mt-3 text-xs text-muted">
              {t('deadlines', {
                returnDate: formatDate(pickup.returnDeadlineAt, locale),
                abandonDate: formatDate(pickup.abandonDeadlineAt, locale),
              })}
            </p>
          )}
        </>
      )}
      {errText && (
        <Banner variant="danger" role="alert" className="mt-3">
          {errText}
        </Banner>
      )}
    </article>
  );
}

/** Clave del texto de una baja resuelta: nunca contradice el estado de la carta (`itemStatus`). */
function revisionKey(l: SellItemDTO): string {
  const state = l.revision!.state;
  if (state !== 'cancelled') return `revision.${state}`;
  if (l.itemStatus === 'aprobada') return 'revision.cancelled';
  if (l.itemStatus === 'rechazada') return l.rejectionCode === 'not_received' ? 'revision.cancelledNotReceived' : 'revision.cancelledRejected';
  return 'revision.cancelledNeutral';
}

/** Bloque del portal (`/buylist/requests/:id`) con las propuestas de baja pendientes y las cartas por recoger. */
export function SellerFlujoLines({ sellRequestId, lines }: { sellRequestId: string; lines: SellItemDTO[] }) {
  const t = useTranslations('sellerFlujo');
  const locale = useLocale() as AppLocale;
  const qc = useQueryClient();
  const [notice, setNotice] = useState<{ itemId: string; text: string } | null>(null);
  const changed = (fresh?: SellRequestDetailDTO) => {
    if (fresh) qc.setQueryData(['sell-request', sellRequestId], fresh); // la solicitud completa que devolvió el servidor
    void qc.invalidateQueries({ queryKey: ['sell-request', sellRequestId] });
    void qc.invalidateQueries({ queryKey: ['sell-requests'] });
  };
  const conflict = (itemId: string, kind: 'changed' | 'alreadyResolved', currentCents?: number) => {
    setNotice({
      itemId,
      text:
        kind === 'changed'
          ? t('revision.errors.changed', { amount: currentCents != null ? formatMoneyCents(currentCents, locale) : '—' })
          : t('revision.errors.alreadyResolved'),
    });
    changed(); // recarga la tarjeta: muestra la propuesta nueva, o «retirada»/«aceptada»
  };
  const pending = lines.filter((l) => l.revision?.state === 'pending');
  const resolved = lines.filter((l) => l.revision && l.revision.state !== 'pending');
  // «No llegó» y las líneas sin `pickup` no tienen nada que recoger (el servidor manda `pickup: null`).
  const pickups = lines.filter((l) => l.itemStatus === 'rechazada' && l.pickup != null);
  if (pending.length + resolved.length + pickups.length === 0 && !notice) return null;
  return (
    <section className="gutter mt-10 flex flex-col gap-4" data-testid="seller-flujo">
      <h2 className="eyebrow">{t('eyebrow', { id: sellRequestId })}</h2>
      {notice && (
        <div data-testid="seller-revision-notice">
          <Banner variant="warning" role="status">
            {notice.text}
          </Banner>
        </div>
      )}
      {pending.map((l) => (
        <RevisionCard key={l.id} sellRequestId={sellRequestId} line={l} onChanged={changed} onConflict={conflict} />
      ))}
      {resolved.map((l) => {
        const rev = l.revision!;
        const amount = rev.proposedCents != null ? formatMoneyCents(rev.proposedCents, locale) : '';
        return (
          <p key={l.id} className="text-sm text-muted" data-testid={`seller-revision-resolved-${l.id}`}>
            {t(revisionKey(l), { card: l.card.name, amount })}
          </p>
        );
      })}
      {pickups.map((l) => (
        <PickupChoice key={l.id} sellRequestId={sellRequestId} line={l} onChanged={changed} />
      ))}
    </section>
  );
}
