'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/Badge';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { QueryState } from '@/components/ui/QueryState';
import { Select } from '@/components/ui/Select';
import { Skeleton } from '@/components/ui/Skeleton';
import { ApiErrorBanner } from '@/components/supplier/ApiErrorBanner';
import { CardLine } from '@/components/supplier/CardLine';
import { Expiry } from '@/components/supplier/Expiry';
import { REQUEST_TONE } from '@/components/supplier/supplier-labels';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useRole } from '@/lib/role';
import { formatMoneyCents } from '@/lib/format';
import { pesosToCents } from '@/lib/money-input';
import type { AppLocale } from '@/i18n/routing';
import type { Finish } from '@/types/contract';
import {
  SUPPLY_CONDITIONS,
  createSupplyRequest,
  listSupplyRequests,
  patchSupplyRequest,
  searchSupplyCards,
  supplyMarketCheck,
  type RequestStatus,
  type SupplyCardHit,
  type SupplyCondition,
  type SupplyRequestAdmin,
} from '@/lib/api/suppliers';

const STATUSES: RequestStatus[] = ['open', 'filled', 'closed', 'expired'];

export function RequestsTab() {
  const t = useTranslations('admin.suppliers.requests');
  const ts = useTranslations('admin.suppliers.requestStatus');
  const { isSuperAdmin } = useRole();
  const [status, setStatus] = useState<RequestStatus | ''>('open');
  const [creating, setCreating] = useState(false);
  const query = useQuery({
    queryKey: ['admin', 'supply-requests', status],
    queryFn: () => listSupplyRequests({ status: status || undefined }),
  });
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <Select
          label={t('status')}
          value={status}
          onChange={(e) => setStatus(e.target.value as RequestStatus | '')}
          options={[{ value: '', label: t('allStatuses') }, ...STATUSES.map((s) => ({ value: s, label: ts(s) }))]}
        />
        {isSuperAdmin && !creating && <Button onClick={() => setCreating(true)}>{t('new')}</Button>}
      </div>
      {creating && <CreateRequestForm onDone={() => setCreating(false)} />}
      <QueryState isLoading={query.isLoading} isError={query.isError} error={query.error} onRetry={() => query.refetch()} loading={<Skeleton className="h-32 w-full" />}>
        {query.data && query.data.data.length === 0 ? (
          <EmptyState title={t('emptyTitle')} body={t('emptyBody')} />
        ) : (
          <ul className="divide-y divide-border border-y border-border">
            {query.data?.data.map((r) => (
              <li key={r.id} className="py-5">
                <RequestRow r={r} canEdit={isSuperAdmin} />
              </li>
            ))}
          </ul>
        )}
      </QueryState>
    </div>
  );
}

function CreateRequestForm({ onDone }: { onDone: () => void }) {
  const t = useTranslations('admin.suppliers.create');
  const tf = useTranslations('finish');
  const locale = useLocale() as AppLocale;
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const dq = useDebouncedValue(q, 300);
  const [hit, setHit] = useState<SupplyCardHit | null>(null);
  const [finish, setFinish] = useState<Finish | ''>('');
  const [minCondition, setMinCondition] = useState<SupplyCondition>('NM');
  const [qty, setQty] = useState('1');
  const [mode, setMode] = useState<'pct' | 'fixed'>('pct');
  const [pct, setPct] = useState('70');
  const [fixed, setFixed] = useState('');

  const hits = useQuery({ queryKey: ['admin', 'supply-card-search', dq], queryFn: () => searchSupplyCards(dq), enabled: !hit && dq.trim().length >= 2 });
  const market = useQuery({
    queryKey: ['admin', 'supply-market', hit?.cardId, finish],
    queryFn: () => supplyMarketCheck(hit!.cardId, finish as Finish),
    enabled: !!hit && !!finish,
  });
  const mk = market.data;
  const needsFixed = !!mk && !mk.hasMarket;
  const fixedCents = fixed.trim() === '' ? null : pesosToCents(fixed);
  const fixedBad = fixedCents !== null && Number.isNaN(fixedCents);
  // Tope duro: solo se COMPARA contra `capCents` del servidor (no se calcula precio). El servidor vuelve a validar (422).
  const aboveCap = !!mk && mk.capCents != null && fixedCents != null && !Number.isNaN(fixedCents) && fixedCents > mk.capCents;
  const pctN = Number(pct);
  const pctOk = Number.isInteger(pctN * 100) && pctN > 0 && pctN <= 100;
  const qtyN = Number(qty);
  const priceOk = mode === 'fixed' || needsFixed ? fixedCents != null && !fixedBad && fixedCents > 0 && !aboveCap : pctOk;
  const canSubmit = !!hit && !!finish && !!mk && Number.isInteger(qtyN) && qtyN >= 1 && priceOk;

  const m = useMutation({
    mutationFn: () =>
      createSupplyRequest({
        cardId: hit!.cardId,
        finish: finish as Finish,
        minCondition,
        qty: qtyN,
        ...(mode === 'fixed' || needsFixed ? { fixedUnitCents: fixedCents as number } : { pctBps: Math.round(pctN * 100) }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'supply-requests'] });
      onDone();
    },
  });

  return (
    <form
      className="grid gap-4 border-l-2 border-accent pl-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) m.mutate();
      }}
    >
      <h2 className="font-serif text-xl sm:col-span-2">{t('title')}</h2>
      <div className="sm:col-span-2 flex flex-col gap-2">
        {hit ? (
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-text">{hit.name} · {hit.setName} · {hit.number}</p>
            <Button type="button" variant="ghost" size="sm" onClick={() => { setHit(null); setFinish(''); }}>{t('change')}</Button>
          </div>
        ) : (
          <>
            <Input label={t('searchCard')} value={q} onChange={(e) => setQ(e.target.value)} hint={t('searchHint')} />
            <ul className="flex flex-col">
              {hits.data?.map((h) => (
                <li key={h.cardId}>
                  <button
                    type="button"
                    className="min-h-[44px] w-full border-b border-border px-1 py-2 text-left text-sm hover:text-accent"
                    onClick={() => { setHit(h); setFinish(h.finishes[0] ?? ''); }}
                  >
                    {h.name} · {h.setName} · {h.number}
                  </button>
                </li>
              ))}
            </ul>
            {hits.data && hits.data.length === 0 && <p className="text-sm text-muted">{t('noHits')}</p>}
          </>
        )}
      </div>
      {hit && (
        <Select label={t('finish')} value={finish} onChange={(e) => setFinish(e.target.value as Finish)} options={hit.finishes.map((f) => ({ value: f, label: tf(f) }))} />
      )}
      <Select label={t('minCondition')} value={minCondition} onChange={(e) => setMinCondition(e.target.value as SupplyCondition)} options={SUPPLY_CONDITIONS.map((c) => ({ value: c, label: c }))} />
      <Input label={t('qty')} type="number" min={1} inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} />
      {market.isError && <div className="sm:col-span-2"><ApiErrorBanner error={market.error} /></div>}
      {mk && (
        <div className="sm:col-span-2 flex flex-col gap-3">
          <p className="font-mono text-sm text-text">
            {mk.hasMarket
              ? t('market', { market: formatMoneyCents(mk.marketCents ?? 0, locale), cap: formatMoneyCents(mk.capCents ?? 0, locale) })
              : t('noMarket')}
          </p>
          {!needsFixed && (
            <Select
              label={t('priceMode')}
              value={mode}
              onChange={(e) => setMode(e.target.value as 'pct' | 'fixed')}
              options={[
                { value: 'pct', label: t('modePct', { pct: mk.defaultPctBps / 100 }) },
                { value: 'fixed', label: t('modeFixed') },
              ]}
            />
          )}
          {!needsFixed && mode === 'pct' && (
            <Input label={t('pct')} type="number" min={1} max={100} step="0.01" suffix="%" value={pct} onChange={(e) => setPct(e.target.value)} hint={mk.suggestedUnitCents != null ? t('suggested', { price: formatMoneyCents(mk.suggestedUnitCents, locale) }) : undefined} />
          )}
          {(needsFixed || mode === 'fixed') && (
            <Input label={t('fixed')} inputMode="decimal" prefix="MX$" value={fixed} onChange={(e) => setFixed(e.target.value)} error={fixedBad ? t('fixedInvalid') : aboveCap ? t('aboveCap', { cap: formatMoneyCents(mk.capCents ?? 0, locale) }) : undefined} />
          )}
          <p className="text-xs text-muted">{t('capNote')}</p>
        </div>
      )}
      <div className="sm:col-span-2 flex flex-col gap-3">
        <ApiErrorBanner error={m.error} />
        <div className="flex gap-3">
          <Button type="submit" loading={m.isPending} disabled={!canSubmit}>{t('publish')}</Button>
          <Button type="button" variant="ghost" onClick={onDone}>{t('cancel')}</Button>
        </div>
      </div>
    </form>
  );
}

function RequestRow({ r, canEdit }: { r: SupplyRequestAdmin; canEdit: boolean }) {
  const t = useTranslations('admin.suppliers.requests');
  const ts = useTranslations('admin.suppliers.requestStatus');
  const locale = useLocale() as AppLocale;
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [qty, setQty] = useState(String(r.qtyWanted));
  const [pct, setPct] = useState(r.pctBps != null ? String(r.pctBps / 100) : '');
  const [fixed, setFixed] = useState('');
  const m = useMutation({
    mutationFn: (body: Parameters<typeof patchSupplyRequest>[1]) => patchSupplyRequest(r.id, body),
    onSuccess: () => {
      setEditing(false);
      void qc.invalidateQueries({ queryKey: ['admin', 'supply-requests'] });
    },
  });
  const active = r.status === 'open';
  const fixedCents = fixed.trim() === '' ? null : pesosToCents(fixed);
  const fixedBad = fixedCents !== null && Number.isNaN(fixedCents);
  const aboveCap = r.capCents != null && fixedCents != null && !Number.isNaN(fixedCents) && fixedCents > r.capCents;

  function save() {
    const body: Parameters<typeof patchSupplyRequest>[1] = {};
    if (Number(qty) !== r.qtyWanted) body.qtyWanted = Number(qty);
    if (fixedCents != null && !fixedBad) body.fixedUnitCents = fixedCents;
    else if (pct !== '' && Math.round(Number(pct) * 100) !== r.pctBps) body.pctBps = Math.round(Number(pct) * 100);
    if (Object.keys(body).length) m.mutate(body);
    else setEditing(false);
  }

  return (
    <div className="flex flex-col gap-3">
      <CardLine card={r.card} />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <Badge tone={REQUEST_TONE[r.status]}>{ts(r.status)}</Badge>
        <span className="font-mono text-sm text-text">{t('price', { price: formatMoneyCents(r.unitCents, locale) })}</span>
        <span className="font-mono text-sm text-muted">
          {r.fixedPrice ? t('fixedLabel') : r.pctBps != null ? t('pctLabel', { pct: r.pctBps / 100 }) : ''}
          {r.marketCents != null ? ` · ${t('marketLabel', { market: formatMoneyCents(r.marketCents, locale) })}` : ` · ${t('noMarketLabel')}`}
        </span>
      </div>
      <p className="font-mono text-sm text-text">
        {t('qtys', { wanted: r.qtyWanted, reserved: r.qtyReserved, received: r.qtyReceived, open: r.qtyOpen })} · {t('offersCount', { count: r.offersCount })}
        {r.bestOfferUnitCents != null ? ` · ${t('best', { price: formatMoneyCents(r.bestOfferUnitCents, locale) })}` : ''}
      </p>
      {r.aboveCap && <Banner variant="danger">{t('aboveCapWarn', { cap: formatMoneyCents(r.capCents ?? 0, locale) })}</Banner>}
      {active && <Expiry iso={r.expiresAt} />}
      <ApiErrorBanner error={m.error} />
      {canEdit && active && !editing && (
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>{t('edit')}</Button>
          <Button variant="ghost" size="sm" loading={m.isPending} onClick={() => m.mutate({ status: 'closed' })}>{t('close')}</Button>
        </div>
      )}
      {editing && (
        <form className="grid gap-4 border-l-2 border-border-strong pl-4 sm:grid-cols-3" onSubmit={(e) => { e.preventDefault(); save(); }}>
          <Input label={t('qtyWanted')} type="number" min={Math.max(1, r.qtyReserved)} value={qty} onChange={(e) => setQty(e.target.value)} />
          {r.marketCents != null && <Input label={t('pct')} hint={r.fixedPrice ? t('backToPct') : undefined} type="number" min={1} max={100} step="0.01" suffix="%" value={pct} onChange={(e) => setPct(e.target.value)} />}
          <Input label={t('fixedOptional')} inputMode="decimal" prefix="MX$" value={fixed} onChange={(e) => setFixed(e.target.value)} error={fixedBad ? t('fixedInvalid') : aboveCap ? t('aboveCap', { cap: formatMoneyCents(r.capCents ?? 0, locale) }) : undefined} />
          <div className="sm:col-span-3 flex gap-3">
            <Button type="submit" loading={m.isPending} disabled={fixedBad || aboveCap}>{t('save')}</Button>
            <Button type="button" variant="ghost" onClick={() => setEditing(false)}>{t('cancel')}</Button>
          </div>
        </form>
      )}
    </div>
  );
}
