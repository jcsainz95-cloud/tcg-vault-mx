'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { QueryState } from '@/components/ui/QueryState';
import { Select } from '@/components/ui/Select';
import { Skeleton } from '@/components/ui/Skeleton';
import { ApiErrorBanner } from '@/components/supplier/ApiErrorBanner';
import { CardLine } from '@/components/supplier/CardLine';
import { Expiry } from '@/components/supplier/Expiry';
import { PURCHASE_TONE } from '@/components/supplier/supplier-labels';
import { useRole } from '@/lib/role';
import { formatMoneyCents } from '@/lib/format';
import { useIdemKey } from '@/lib/api/use-idem-key';
import type { AppLocale } from '@/i18n/routing';
import {
  SUPPLY_CONDITIONS,
  listSupplyPurchases,
  paySupplyPurchase,
  receiveSupplyPurchase,
  verifySupplyPurchase,
  type PurchaseStatus,
  type SupplyCondition,
  type SupplyPurchase,
} from '@/lib/api/suppliers';

const STATUSES: PurchaseStatus[] = ['agreed', 'collected', 'verified', 'paid', 'cancelled'];

/** Acuerdos: recogida (staff) → verificación de estado (staff) → pago (super_admin). */
export function PurchasesTab() {
  const t = useTranslations('admin.suppliers.purchases');
  const ts = useTranslations('supplier.purchaseStatus');
  const [status, setStatus] = useState<PurchaseStatus | ''>('');
  const query = useQuery({ queryKey: ['admin', 'supply-purchases', status], queryFn: () => listSupplyPurchases({ status: status || undefined }) });
  return (
    <div className="flex flex-col gap-5">
      <Select label={t('status')} value={status} onChange={(e) => setStatus(e.target.value as PurchaseStatus | '')} options={[{ value: '', label: t('allStatuses') }, ...STATUSES.map((s) => ({ value: s, label: ts(s) }))]} />
      <QueryState isLoading={query.isLoading} isError={query.isError} error={query.error} onRetry={() => query.refetch()} loading={<Skeleton className="h-32 w-full" />}>
        {query.data && query.data.data.length === 0 ? (
          <EmptyState title={t('emptyTitle')} body={t('emptyBody')} />
        ) : (
          <ul className="divide-y divide-border border-y border-border">
            {query.data?.data.map((p) => (
              <li key={p.id} className="py-5">
                <PurchaseRow p={p} />
              </li>
            ))}
          </ul>
        )}
      </QueryState>
    </div>
  );
}

type VerifyChoice = { result: 'ok' | 'adjusted' | 'returned'; adjust: string };

function PurchaseRow({ p }: { p: SupplyPurchase }) {
  const t = useTranslations('admin.suppliers.purchases');
  const ts = useTranslations('supplier.purchaseStatus');
  const tr = useTranslations('supplier.unitResult');
  const locale = useLocale() as AppLocale;
  const qc = useQueryClient();
  const { isSuperAdmin } = useRole();
  const done = () => qc.invalidateQueries({ queryKey: ['admin', 'supply-purchases'] });
  const kRecv = useIdemKey();
  const kVer = useIdemKey();
  const kPay = useIdemKey();

  // Recogida: una condición real por pieza entregada (por defecto, la declarada ⇒ NM; se baja a lo observado).
  const [received, setReceived] = useState<SupplyCondition[]>(() => Array.from({ length: p.qty }, () => 'NM'));
  const [count, setCount] = useState(String(p.qty));
  const countN = Math.min(p.qty, Math.max(0, Number(count) || 0));
  const recv = useMutation({
    mutationFn: () => receiveSupplyPurchase(p.id, received.slice(0, countN).map((condition, i) => ({ n: i + 1, condition })), kRecv.get()),
    onSuccess: () => {
      kRecv.renew();
      return done();
    },
  });

  // Verificación: ok / ajustar (% del precio acordado, lo calcula el servidor) / devolver.
  const [choices, setChoices] = useState<Record<number, VerifyChoice>>({});
  // B1: una pieza que no llegó en NM arranca en «devolver» (con `ok` el servidor da 422 OK_NOT_NM y el acuerdo se atora).
  const conditionOf = (n: number) => p.units.find((u) => u.n === n)?.condition;
  const choiceOf = (n: number): VerifyChoice => choices[n] ?? { result: conditionOf(n) === 'NM' ? 'ok' : 'returned', adjust: '' };
  /** `invalid` fuera de 0.01–99.99 %; `zero` si el servidor pagaría MX$0 (piso de centavos) ⇒ 400: se sugiere «devolver». */
  const adjustProblem = (n: number): 'invalid' | 'zero' | null => {
    const c = choiceOf(n);
    if (c.result !== 'adjusted') return null;
    const bps = Math.round(Number(c.adjust) * 100);
    if (!(bps >= 1 && bps <= 9999)) return 'invalid';
    return p.agreedUnitCents * bps < 10_000 ? 'zero' : null;
  };
  const adjustBad = p.units.some((u) => adjustProblem(u.n) !== null);
  const ver = useMutation({
    mutationFn: () =>
      verifySupplyPurchase(
        p.id,
        p.units.map((u) => {
          const c = choiceOf(u.n);
          return c.result === 'adjusted' ? { n: u.n, result: c.result, adjustBps: Math.round(Number(c.adjust) * 100) } : { n: u.n, result: c.result };
        }),
        kVer.get(),
      ),
    onSuccess: () => {
      kVer.renew();
      return done();
    },
  });

  const [method, setMethod] = useState<'cash' | 'transfer'>('transfer');
  const [reference, setReference] = useState('');
  const pay = useMutation({
    mutationFn: () => paySupplyPurchase(p.id, { method, ...(reference.trim() ? { reference: reference.trim() } : {}) }, kPay.get()),
    onSuccess: () => {
      kPay.renew();
      return done();
    },
  });

  return (
    <div className="flex flex-col gap-3">
      <CardLine card={p.card} />
      <p className="text-sm text-text">{p.supplier?.businessName}</p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <Badge tone={PURCHASE_TONE[p.status]}>{ts(p.status)}</Badge>
        <span className="font-mono text-sm text-text">{t('agreed', { qty: p.qty, unit: formatMoneyCents(p.agreedUnitCents, locale) })}</span>
        <span className="font-mono text-sm text-text">{t('total', { total: formatMoneyCents(p.totalCents, locale) })}</span>
      </div>
      {p.status === 'agreed' && <Expiry iso={p.pickupDueAt} />}
      {p.payableCents != null && <p className="font-mono text-base text-text">{t('payable', { amount: formatMoneyCents(p.payableCents, locale) })}</p>}

      {p.status === 'agreed' && (
        <form className="flex flex-col gap-3 border-l-2 border-accent pl-4" onSubmit={(e) => { e.preventDefault(); recv.mutate(); }}>
          <p className="text-sm font-medium">{t('receiveTitle')}</p>
          <Input label={t('receivedCount')} type="number" min={0} max={p.qty} value={count} onChange={(e) => setCount(e.target.value)} hint={t('receivedHint', { qty: p.qty })} />
          {Array.from({ length: countN }, (_, i) => (
            <Select
              key={i}
              label={t('pieceCondition', { n: i + 1 })}
              value={received[i] ?? 'NM'}
              onChange={(e) => setReceived((prev) => prev.map((c, j) => (j === i ? (e.target.value as SupplyCondition) : c)))}
              options={SUPPLY_CONDITIONS.map((c) => ({ value: c, label: c }))}
            />
          ))}
          <ApiErrorBanner error={recv.error} />
          <Button type="submit" size="sm" className="self-start" loading={recv.isPending}>{t('receive')}</Button>
        </form>
      )}

      {p.status === 'collected' && (
        <form className="flex flex-col gap-3 border-l-2 border-accent pl-4" onSubmit={(e) => { e.preventDefault(); if (!adjustBad) ver.mutate(); }}>
          <p className="text-sm font-medium">{t('verifyTitle')}</p>
          <p className="text-xs text-muted">{t('verifyNote')}</p>
          {p.units.map((u) => {
            const c = choiceOf(u.n);
            const canOk = u.condition === 'NM';
            return (
              <div key={u.n} className="grid gap-3 sm:grid-cols-2">
                <Select
                  label={t('pieceResult', { n: u.n, condition: u.condition })}
                  value={c.result}
                  onChange={(e) => setChoices((prev) => ({ ...prev, [u.n]: { ...c, result: e.target.value as VerifyChoice['result'] } }))}
                  options={[
                    ...(canOk ? [{ value: 'ok', label: tr('ok') }] : []),
                    ...(canOk ? [{ value: 'adjusted', label: tr('adjusted') }] : []),
                    { value: 'returned', label: tr('returned') },
                  ]}
                />
                {c.result === 'adjusted' && (
                  <Input label={t('adjustPct')} type="number" min={0.01} max={99.99} step="0.01" suffix="%" value={c.adjust} onChange={(e) => setChoices((prev) => ({ ...prev, [u.n]: { ...c, adjust: e.target.value } }))} hint={t('adjustHint')} error={adjustProblem(u.n) === 'zero' ? t('adjustZero') : undefined} />
                )}
              </div>
            );
          })}
          <ApiErrorBanner error={ver.error} />
          <Button type="submit" size="sm" className="self-start" loading={ver.isPending} disabled={adjustBad}>{t('verify')}</Button>
        </form>
      )}

      {p.units.length > 0 && p.status !== 'agreed' && p.status !== 'collected' && (
        <ul className="flex flex-col gap-1 text-sm">
          {p.units.map((u) => (
            <li key={u.n} className="flex flex-wrap justify-between gap-2 font-mono">
              <span>{t('unit', { n: u.n, condition: u.condition })}</span>
              <span className="text-muted">{tr(u.result)}{u.unitPayableCents != null ? ` · ${formatMoneyCents(u.unitPayableCents, locale)}` : ''}</span>
            </li>
          ))}
        </ul>
      )}

      {p.status === 'verified' && isSuperAdmin && (p.payableCents ?? 0) > 0 && (
        <form className="flex flex-col gap-3 border-l-2 border-accent pl-4" onSubmit={(e) => { e.preventDefault(); pay.mutate(); }}>
          <p className="text-sm font-medium">{t('payTitle')}</p>
          <Select label={t('method')} value={method} onChange={(e) => setMethod(e.target.value as 'cash' | 'transfer')} options={[{ value: 'transfer', label: t('methods.transfer') }, { value: 'cash', label: t('methods.cash') }]} />
          <Input label={t('reference')} maxLength={80} value={reference} onChange={(e) => setReference(e.target.value)} />
          <ApiErrorBanner error={pay.error} />
          <Button type="submit" size="sm" className="self-start" loading={pay.isPending}>{t('pay', { amount: formatMoneyCents(p.payableCents ?? 0, locale) })}</Button>
        </form>
      )}
      {p.status === 'cancelled' && <p className="text-sm text-muted">{p.reason ? t(`cancelledReason.${p.reason}`) : t('cancelled')}</p>}
      {p.status === 'paid' && <p className="text-sm text-muted">{t('paid', { method: p.method ? t(`methods.${p.method}`) : '' })}{p.reference ? ` · ${p.reference}` : ''}</p>}
    </div>
  );
}
