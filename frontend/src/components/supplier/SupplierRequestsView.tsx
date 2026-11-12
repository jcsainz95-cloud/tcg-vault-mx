'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { SupplierQueryState as QueryState } from './SupplierQueryState';
import { Select } from '@/components/ui/Select';
import { Skeleton } from '@/components/ui/Skeleton';
import { formatMoneyCents } from '@/lib/format';
import { useIdemKey } from '@/lib/api/use-idem-key';
import type { AppLocale } from '@/i18n/routing';
import {
  REOFFER_STATUSES,
  SUPPLY_TTL,
  conditionsAtLeast,
  createSupplierOffer,
  listSupplierRequests,
  type SupplierRequest,
  type SupplyCondition,
} from '@/lib/api/suppliers';
import { CardLine } from './CardLine';
import { Expiry } from './Expiry';
import { ApiErrorBanner } from './ApiErrorBanner';
import { OFFER_TONE } from './supplier-labels';

/** «Lo que buscamos»: solo pesos por pieza. ⛔ Ni mercado, ni %, ni margen (contrato §3). */
export function SupplierRequestsView() {
  const t = useTranslations('supplier.requests');
  const [q, setQ] = useState('');
  const query = useQuery({ queryKey: ['supplier', 'requests', q], queryFn: () => listSupplierRequests(q || undefined) });

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="font-serif text-3xl text-text">{t('title')}</h1>
        <p className="text-sm text-muted">{t('lead', { days: SUPPLY_TTL.requestDays })}</p>
      </header>
      <Input label={t('search')} type="search" value={q} onChange={(e) => setQ(e.target.value)} />
      <QueryState
        isLoading={query.isLoading}
        isError={query.isError}
        error={query.error}
        onRetry={() => query.refetch()}
        loading={<Skeleton className="h-40 w-full" />}
      >
        {query.data && query.data.data.length === 0 ? (
          <EmptyState title={t('emptyTitle')} body={t('emptyBody')} />
        ) : (
          <ul className="flex flex-col divide-y divide-border border-y border-border">
            {query.data?.data.map((r) => (
              <li key={r.id} className="py-5">
                <RequestRow req={r} />
              </li>
            ))}
          </ul>
        )}
      </QueryState>
    </div>
  );
}

function RequestRow({ req }: { req: SupplierRequest }) {
  const t = useTranslations('supplier.requests');
  const to = useTranslations('supplier.offerStatus');
  const locale = useLocale() as AppLocale;
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState('1');
  const [condition, setCondition] = useState<SupplyCondition>(req.minCondition);
  const qtyN = Number(qty);
  const idem = useIdemKey();
  const qtyOk = Number.isInteger(qtyN) && qtyN >= 1 && qtyN <= req.qtyOpen;

  const m = useMutation({
    mutationFn: () => createSupplierOffer(req.id, { qty: qtyN, condition }, idem.get()),
    onSuccess: () => {
      idem.renew();
      setOpen(false);
      void qc.invalidateQueries({ queryKey: ['supplier'] });
    },
  });

  return (
    <div className="flex flex-col gap-3">
      <CardLine card={req.card} />
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div>
          <dt className="eyebrow">{t('pay')}</dt>
          <dd className="font-mono text-xl text-text">{formatMoneyCents(req.unitCents, locale)}</dd>
          <dd className="text-xs text-muted">{t('perPiece')}</dd>
        </div>
        <div>
          <dt className="eyebrow">{t('wanted')}</dt>
          <dd className="font-mono text-xl text-text">{req.qtyOpen}</dd>
          <dd className="text-xs text-muted">{t('minCondition', { condition: req.minCondition })}</dd>
        </div>
      </dl>
      <Expiry iso={req.expiresAt} />
      {req.myOfferStatus && (
        <Badge tone={OFFER_TONE[req.myOfferStatus]} className="self-start">{t('myOffer', { status: to(req.myOfferStatus) })}</Badge>
      )}
      {req.myOfferStatus && !REOFFER_STATUSES.includes(req.myOfferStatus) ? null : open ? (
        <form
          className="flex flex-col gap-4 border-l-2 border-accent pl-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (qtyOk) m.mutate();
          }}
        >
          <ApiErrorBanner error={m.error} />
          <Input label={t('qty')} inputMode="numeric" type="number" min={1} max={req.qtyOpen} value={qty} onChange={(e) => setQty(e.target.value)} hint={t('qtyHint', { max: req.qtyOpen })} />
          <Select
            label={t('condition')}
            value={condition}
            onChange={(e) => setCondition(e.target.value as SupplyCondition)}
            options={conditionsAtLeast(req.minCondition).map((c) => ({ value: c, label: c }))}
          />
          <p className="text-xs text-muted">{t('offerNote', { hours: SUPPLY_TTL.offerHours })}</p>
          <div className="flex gap-3">
            <Button type="submit" loading={m.isPending} disabled={!qtyOk}>{t('send')}</Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>{t('cancel')}</Button>
          </div>
        </form>
      ) : (
        <Button className="self-start" onClick={() => setOpen(true)}>{req.myOfferStatus ? t('haveItAgain') : t('haveIt')}</Button>
      )}
    </div>
  );
}
