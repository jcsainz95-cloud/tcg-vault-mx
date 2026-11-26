'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { getAdminUserNotes, getAdminUserOverview, type RefundRef, type ShipmentRef } from '@/lib/api/customer-file';
import type { AdminUserDetailDTO } from '@/types/contract';
import type { AppLocale } from '@/i18n/routing';
import { formatDate, formatMoneyCents } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Skeleton } from '@/components/ui/Skeleton';
import { NotesPanel } from './NotesPanel';
import { PhoneField, whatsappHref } from './PhoneField';
import { NameField } from './NameField';
import { normalizeMxPhone, formatMxPhone } from '@/lib/phone';
import { safeHttpUrl } from '@/lib/safe-href';

const SECTIONS = ['attention', 'notes', 'contact', 'addresses', 'orders', 'shipments', 'vault', 'sells', 'refunds', 'identity', 'activity'] as const;
type SectionKey = (typeof SECTIONS)[number];
const ROWS = 5;
const TERMINAL_SELL = ['pagada', 'rechazada', 'abandonada', 'expirada'];
const q = encodeURIComponent;
const m4Href = (userId: string) => `/admin/m4?tab=envios&userId=${q(userId)}`;
const m5Href = (userId: string) => `/admin/m5?userId=${q(userId)}`;

function SectionCard({ id, title, count, aside, children }: { id: SectionKey; title: string; count?: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id={`ficha-${id}`} aria-labelledby={`ficha-h-${id}`} className="flex scroll-mt-4 flex-col gap-3 border border-border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id={`ficha-h-${id}`} className="font-serif text-lg text-text">
          {title}
          {count && <span className="ml-2 font-mono text-[11px] text-muted">{count}</span>}
        </h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted">{children}</p>;
}

const SHIP_TONE = { solicitado: 'neutral', picking: 'info', guia: 'info', enviado: 'warning', entregado: 'success', cancelado: 'neutral' } as const;
const REFUND_TONE = { requested: 'warning', submitted: 'warning', succeeded: 'success', failed: 'danger', pending: 'warning', paid: 'success', cancelled: 'neutral' } as const;

export interface CustomerFichaProps {
  d: AdminUserDetailDTO;
  isSuperAdmin: boolean;
  /** Insignias de estado/rol del encabezado (se arman en `M6View`, que ya las tiene). */
  badges: React.ReactNode;
  /** Bloque de KYC existente (estado, CLABE/RFC enmascarados, tope mensual). */
  identity: React.ReactNode;
  vault: React.ReactNode;
  activity: React.ReactNode;
  /** Notas de cuenta (dueño), bloqueo y gestión de cuenta. */
  account: React.ReactNode;
}

/** §FICHA-CLIENTE · diseño A — ficha completa del cliente en una sola página. */
export function CustomerFicha({ d, isSuperAdmin, badges, identity, vault, activity, account }: CustomerFichaProps) {
  const t = useTranslations('admin.m6.ficha');
  const locale = useLocale() as AppLocale;
  const qc = useQueryClient();
  const overview = useQuery({ queryKey: ['admin-user-overview', d.id], queryFn: () => getAdminUserOverview(d.id) });
  const notes = useQuery({ queryKey: ['admin-user-notes', d.id, 'first'], queryFn: () => getAdminUserNotes(d.id, { limit: 50 }) });
  const ov = overview.data;
  const pinned = notes.data?.items.find((n) => n.pinned);
  const [openLists, setOpenLists] = useState<Record<string, boolean>>({});
  const toggle = (k: string) => setOpenLists((s) => ({ ...s, [k]: !s[k] }));

  const phone = d.phone ?? null;
  const wa = whatsappHref(phone);
  const orders = d.orders ?? [];
  const sells = d.sellRequests ?? [];
  const disputes = d.disputes ?? [];
  const addresses = d.addresses ?? [];
  const pendingOrder = orders.find((o) => o.status === 'pending');
  const openSell = sells.find((s) => !TERMINAL_SELL.includes(s.status));
  const days = Math.max(0, Math.floor((Date.now() - new Date(ov?.summary.customerSince ?? d.createdAt).getTime()) / 86_400_000));
  const lt = ov?.summary.lifetime;
  const money = (c: number) => formatMoneyCents(c, locale);

  const counts: Partial<Record<SectionKey, number>> = {
    attention: ov ? Object.values({ a: ov.attention.ordersPending, b: ov.attention.shipmentsOpen, c: ov.attention.sellRequestsNeedingStore, d: ov.attention.disputesOpen, e: ov.attention.refundsOpen }).reduce((x, y) => x + y, 0) : undefined,
    addresses: addresses.length,
    orders: ov?.totals.orders ?? orders.length,
    shipments: ov?.shipments.total,
    vault: ov?.totals.ownedItems ?? d.ownedItems?.length,
    sells: ov?.totals.sellRequests ?? sells.length,
    refunds: ov ? ov.refunds.total + ov.totals.disputes : undefined,
  };

  function go(id: SectionKey) {
    const el = document.getElementById(`ficha-${id}`);
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el?.scrollIntoView?.({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  }

  const blockError = (onRetry: () => void) => (
    <div role="alert" className="flex items-center gap-3 text-sm text-muted">
      <span>{t('blockError')}</span>
      <Button size="sm" variant="secondary" onClick={onRetry}>
        {t('retry')}
      </Button>
    </div>
  );
  const loadingBlock = (
    <div aria-busy="true" className="flex flex-col gap-2">
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-4 w-1/2" />
    </div>
  );

  // ---- Cabecera ----
  const header = (
    <header className="flex flex-col gap-4 border border-border p-4 lg:flex-row lg:items-start lg:justify-between" data-testid="ficha-header">
      <div className="flex min-w-0 flex-col gap-2">
        <span className="eyebrow">{t('clientLabel')}</span>
        <div className="flex flex-wrap items-center gap-2">
          <NameField
            userId={d.id}
            name={d.name}
            missing={!d.name?.trim() || d.nameSource === 'derived'}
            canEdit={isSuperAdmin}
            onSaved={() => {
              void qc.invalidateQueries({ queryKey: ['admin-user', d.id] });
            }}
          />
          {badges}
          {pinned && <Badge tone="accent" shape="outline">{t('pinnedBadge')}</Badge>}
        </div>
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-6 gap-y-1 text-sm">
          <dt className="text-muted">{t('phoneLabel')}</dt>
          <dd>
            <PhoneField
              userId={d.id}
              name={d.name}
              phone={phone}
              canEdit={isSuperAdmin}
              onSaved={() => {
                void qc.invalidateQueries({ queryKey: ['admin-user', d.id] });
              }}
            />
          </dd>
          <dt className="text-muted">{t('email')}</dt>
          <dd className="tabular">{d.email ?? (d.username ? t('usernameLine', { username: d.username }) : '—')}</dd>
          <dt className="text-muted">{t('customerSinceShort')}</dt>
          <dd className="tabular">{t('customerSince', { date: formatDate(ov?.summary.customerSince ?? d.createdAt, locale), days })}</dd>
        </dl>
      </div>
      <div className="flex shrink-0 flex-col gap-2 lg:w-56">
        {wa ? (
          <a
            href={wa}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t('whatsappLabel', { name: d.name })}
            className="inline-flex min-h-[44px] items-center justify-center bg-primary px-4 font-mono text-xs uppercase tracking-[0.14em] text-white focus-visible:shadow-focus focus-visible:outline-none"
          >
            {t('whatsapp')}
          </a>
        ) : (
          <span className="border border-dashed border-border px-3 py-2 text-center text-xs text-accent" data-testid="whatsapp-missing">
            {t('phoneMissing')}
          </span>
        )}
        {pendingOrder && (
          <Link href={m4Href(d.id)} className="inline-flex min-h-[44px] items-center justify-center border border-border px-3 text-center text-sm hover:bg-surface-2 focus-visible:shadow-focus focus-visible:outline-none">
            {t('openOrder', { n: pendingOrder.orderNumber ?? pendingOrder.id })}
          </Link>
        )}
        {openSell && (
          <Link href={m5Href(d.id)} className="inline-flex min-h-[44px] items-center justify-center border border-border px-3 text-center text-sm hover:bg-surface-2 focus-visible:shadow-focus focus-visible:outline-none">
            {t('openSell', { n: openSell.id })}
          </Link>
        )}
      </div>
    </header>
  );

  // ---- Cuatro cifras (los dos roles ven totales: HECHOS 2026-11-22) ----
  const attentionTotal = counts.attention ?? 0;
  const strip = (
    <div role="group" aria-label={t('stripLabel')} className="grid grid-cols-2 border border-border lg:grid-cols-4" data-testid="summary-strip">
      {overview.isError ? (
        <div className="col-span-full p-4">{blockError(() => overview.refetch())}</div>
      ) : !ov || !lt ? (
        <div className="col-span-full p-4">{loadingBlock}</div>
      ) : (
        <>
          <div className="flex flex-col gap-1 border-b border-r border-border p-4 lg:border-b-0">
            <span className="eyebrow">{t('purchases')}</span>
            <span className="tabular font-serif text-2xl" data-testid="strip-purchases">{money(lt.purchasesCents)}</span>
            <span className="text-xs text-muted">
              {ov.summary.lastOrderAt
                ? t('purchasesSub', { count: lt.purchasesCount, date: formatDate(ov.summary.lastOrderAt, locale) })
                : t('purchasesSubNone', { count: lt.purchasesCount })}
              {lt.refundedCents > 0 && ` · ${t('refundedSub', { amount: money(lt.refundedCents) })}`}
            </span>
          </div>
          <div className="flex flex-col gap-1 border-b border-border p-4 lg:border-b-0 lg:border-r">
            <span className="eyebrow">{t('sales')}</span>
            <span className="tabular font-serif text-2xl" data-testid="strip-sales">{money(lt.salesPaidCents)}</span>
            <span className="text-xs text-muted">{t('salesSub', { count: lt.salesPaidCount, inProgress: money(lt.salesInProgressCents) })}</span>
          </div>
          <div className="flex flex-col gap-1 border-r border-border p-4">
            <span className="eyebrow">{t('vault')}</span>
            <span className="tabular font-serif text-2xl" data-testid="strip-vault">
              {ov.vault.valueCents != null ? money(ov.vault.valueCents) : '—'}
            </span>
            <span className="text-xs text-muted">
              {ov.vault.valueCents == null && ov.vault.piecesCount > 0
                ? t('vaultNoValue')
                : ov.vault.piecesCount > ov.vault.pricedCount
                  ? t('vaultSub', { count: ov.vault.piecesCount, unpriced: ov.vault.piecesCount - ov.vault.pricedCount })
                  : t('vaultSubAll', { count: ov.vault.piecesCount })}
            </span>
          </div>
          <div className={cn('flex flex-col gap-1 p-4', attentionTotal > 0 && 'bg-accent/10')}>
            <span className={cn('eyebrow', attentionTotal > 0 && 'text-accent')}>{t('attention')}</span>
            <span className={cn('tabular font-serif text-2xl', attentionTotal > 0 && 'text-accent')} data-testid="strip-attention">{attentionTotal}</span>
            <span className="text-xs text-muted">{t('attentionSub')}</span>
          </div>
        </>
      )}
    </div>
  );

  // ---- Necesita atención ----
  const attItems = ov
    ? ([
        ['ordersPending', ov.attention.ordersPending],
        ['shipmentsOpen', ov.attention.shipmentsOpen],
        ['sellRequestsNeedingStore', ov.attention.sellRequestsNeedingStore],
        ['disputesOpen', ov.attention.disputesOpen],
        ['refundsOpen', ov.attention.refundsOpen],
      ] as const)
    : [];
  const attention = (
    <SectionCard id="attention" title={t('sections.attention')}>
      {overview.isError ? (
        blockError(() => overview.refetch())
      ) : !ov ? (
        loadingBlock
      ) : (
        <ul className="grid grid-cols-1 border border-border sm:grid-cols-2">
          {attItems.map(([k, n]) => (
            <li key={k} className="flex items-center justify-between gap-3 border-b border-border px-3 py-3 last:border-b-0">
              <span className={cn('text-sm', n === 0 && 'text-muted')}>{t(`att.${k}`)}</span>
              <span className={cn('tabular font-serif text-xl', n > 0 ? 'text-accent' : 'text-muted')}>{n}</span>
            </li>
          ))}
          <li className="flex items-center justify-between gap-3 px-3 py-3">
            <span className="text-sm text-muted">{t('att.wishlist')}</span>
            <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-muted">
              {t('att.wishlistCards', { count: ov.wishlist.itemCount })} · {ov.wishlist.alertsPaused ? t('att.wishlistPaused') : t('att.wishlistActive')}
            </span>
          </li>
        </ul>
      )}
    </SectionCard>
  );

  const notesCard = (
    <SectionCard id="notes" title={t('sections.notes')}>
      <NotesPanel userId={d.id} />
    </SectionCard>
  );

  // ---- Contacto y cuenta ----
  const contact = (
    <SectionCard id="contact" title={t('sections.contact')}>
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm md:grid-cols-[auto_1fr_auto_1fr]">
        <dt className="text-muted">{t('phoneLabel')}</dt>
        <dd className="tabular font-mono">{phone ? formatMxPhone(phone) : '—'} {normalizeMxPhone(phone ?? '') ? <span className="text-success">· {t('phoneValid')}</span> : <span className="text-accent">· {t('phoneMissing')}</span>}</dd>
        <dt className="text-muted">{t('contactLabels.wishlist')}</dt>
        <dd>{ov ? t('contactLabels.wishlistValue', { count: ov.wishlist.itemCount, state: ov.wishlist.alertsPaused ? t('contactLabels.alertsOff') : t('contactLabels.alertsOn') }) : '—'}</dd>
        <dt className="text-muted">{t('email')}</dt>
        <dd className="tabular">{d.email ?? d.username ?? '—'}</dd>
        {isSuperAdmin ? (
          <>
            <dt className="text-muted">{t('contactLabels.billing')} <span className="font-mono text-[10px] uppercase text-accent">{t('contactLabels.superOnly')}</span></dt>
            <dd>{d.billingProfile ? [d.billingProfile.razonSocial, d.billingProfile.usoCfdi, d.billingProfile.postalCode].filter(Boolean).join(' · ') : '—'}</dd>
          </>
        ) : (
          <><dt /><dd /></>
        )}
        <dt className="text-muted">{t('enteredVia')}</dt>
        <dd>{d.authProvider === 'google' ? t('enteredGoogle') : t('enteredLocal')}</dd>
        {isSuperAdmin ? (
          <>
            <dt className="text-muted">{t('contactLabels.recipients')} <span className="font-mono text-[10px] uppercase text-accent">{t('contactLabels.superOnly')}</span></dt>
            <dd>{(d.recentShipmentRecipients ?? []).map((r) => `${r.recipientName ?? t('contactLabels.noRecipient')} (${r.city})`).join(' · ') || '—'}</dd>
          </>
        ) : (
          <><dt /><dd /></>
        )}
        <dt className="text-muted">{t('language')}</dt>
        <dd>{d.locale === 'en' ? t('langEn') : t('langEs')}</dd>
      </dl>
    </SectionCard>
  );

  const addressesCard = (
    <SectionCard id="addresses" title={t('sections.addresses')} count={String(addresses.length)}>
      {addresses.length === 0 ? (
        <Empty>{t('empty.addresses')}</Empty>
      ) : (
        <ul className="flex flex-col text-sm">
          {addresses.map((a) => (
            <li key={a.id} className="border-t border-border py-2 first:border-t-0">
              <span className="text-muted">{a.recipientName ?? t('contactLabels.noRecipient')}</span>{' · '}
              {a.line1}{a.line2 ? `, ${a.line2}` : ''}, {a.city}, {a.state} {a.postalCode}
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );

  // ---- Listas de 5 filas + «Ver todos (N)» ----
  const moreLink = (key: string, loaded: number, total: number, href: string, label: string) => {
    if (total <= ROWS) return null;
    const expanded = !!openLists[key];
    const beyond = total > loaded;
    return (
      <div className="flex items-center justify-between text-xs text-muted">
        <span>{t('shownOf', { shown: expanded ? loaded : Math.min(ROWS, loaded), total })}</span>
        <span className="flex items-center gap-3">
          {loaded > ROWS && (
            <Button size="sm" variant="ghost" onClick={() => toggle(key)}>
              {expanded ? t('seeLess') : t('seeAll', { count: total })}
            </Button>
          )}
          {beyond && (expanded || loaded <= ROWS) && (
            <Link href={href} className="text-accent underline underline-offset-2">
              {label}
            </Link>
          )}
        </span>
      </div>
    );
  };
  const rowsOf = <T,>(key: string, items: T[]) => (openLists[key] ? items : items.slice(0, ROWS));

  const th = 'px-2 py-2 text-left font-mono text-[11px] font-normal uppercase tracking-[0.12em] text-muted';
  const td = 'px-2 py-2 align-top';

  const ordersCard = (
    <SectionCard id="orders" title={t('sections.orders')} count={`${Math.min(ROWS, orders.length)} / ${ov?.totals.orders ?? orders.length}`}>
      {orders.length === 0 ? (
        <Empty>{t('empty.orders')}</Empty>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr><th className={th}>{t('cols.order')}</th><th className={th}>{t('cols.status')}</th><th className={th}>{t('cols.date')}</th><th className={cn(th, 'text-right')}>{t('cols.total')}</th><th className={th} /></tr></thead>
              <tbody>
                {rowsOf('orders', orders).map((o) => (
                  <tr key={o.id} className="border-t border-border">
                    <td className={cn(td, 'tabular font-mono')}>
                      <Link href={`/admin/m3/${o.id}`} className="underline underline-offset-4 hover:text-accent focus-visible:shadow-focus focus-visible:outline-none" data-testid={`ficha-order-link-${o.id}`}>
                        {o.orderNumber ?? o.id}
                      </Link>
                    </td>
                    <td className={td}><StatusBadge domain="order" value={o.status} /></td>
                    <td className={td}>{formatDate(o.createdAt, locale)}</td>
                    <td className={cn(td, 'tabular text-right')}>{money(o.totalCents)}</td>
                    <td className={cn(td, 'text-right')}>
                      <Link href={m4Href(d.id)} aria-label={t('openOrderRow', { n: o.orderNumber ?? o.id })} className="inline-block border border-border px-2 py-1 text-xs hover:bg-surface-2 focus-visible:shadow-focus focus-visible:outline-none">{t('openM4')}</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {moreLink('orders', orders.length, ov?.totals.orders ?? orders.length, m4Href(d.id), t('viewAllM4'))}
        </>
      )}
    </SectionCard>
  );

  const trackBtns = (s: ShipmentRef) =>
    s.trackingNumber ? (
      <span className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" onClick={() => void navigator.clipboard?.writeText(s.trackingNumber ?? '')}>{t('shipment.copyGuide')}</Button>
        {safeHttpUrl(s.trackingUrl) && (
          <a href={safeHttpUrl(s.trackingUrl) ?? undefined} target="_blank" rel="noopener noreferrer" className="inline-block border border-border px-2 py-1 text-xs hover:bg-surface-2 focus-visible:shadow-focus focus-visible:outline-none">{t('shipment.openTracking')}</a>
        )}
      </span>
    ) : null;

  const shipmentsCard = (
    <SectionCard id="shipments" title={t('sections.shipments')} count={ov ? `${Math.min(ROWS, ov.shipments.items.length)} / ${ov.shipments.total}` : undefined}>
      {overview.isError ? (
        blockError(() => overview.refetch())
      ) : !ov ? (
        loadingBlock
      ) : ov.shipments.items.length === 0 ? (
        <Empty>{t('empty.shipments')}</Empty>
      ) : (
        <>
          <ul className="flex flex-col">
            {ov.shipments.items.slice(0, ROWS).map((s) => (
              <li key={s.id} className="grid gap-2 border-t border-border py-3 first:border-t-0 md:grid-cols-[1.4fr_auto_auto_1.6fr_auto] md:items-start">
                <div className="flex flex-col">
                  {s.mode === 'withdrawal' || !s.orderId ? (
                    <span>{s.mode === 'withdrawal' ? t('shipment.withdrawal') : t('shipment.direct', { order: s.orderNumber ?? s.orderId ?? '—' })}</span>
                  ) : (
                    <Link href={`/admin/m3/${s.orderId}`} className="underline underline-offset-4 hover:text-accent focus-visible:shadow-focus focus-visible:outline-none" data-testid={`ficha-shipment-order-link-${s.id}`}>
                      {t('shipment.direct', { order: s.orderNumber ?? s.orderId })}
                    </Link>
                  )}
                  <span className="text-xs text-muted">{t('shipment.requestedOn', { date: formatDate(s.requestedAt, locale) })}</span>
                </div>
                <Badge tone={SHIP_TONE[s.status]} shape="outline">{t(`shipment.status.${s.status}`)}</Badge>
                <span className="text-sm">{t('shipment.items', { count: s.itemsCount })}</span>
                <div className="flex flex-col gap-1 text-sm">
                  {s.carrier || s.trackingNumber ? (
                    <span>
                      {s.carrier && <span>{s.carrier}</span>}
                      {s.carrier && s.trackingNumber ? ' · ' : null}
                      {s.trackingNumber && <span className="tabular font-mono" data-testid="ship-tracking-number">{s.trackingNumber}</span>}
                    </span>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                  {trackBtns(s)}
                  {s.deliveredAt && <span className="text-xs text-muted">{t('shipment.deliveredOn', { date: formatDate(s.deliveredAt, locale) })}</span>}
                </div>
                <span className="tabular text-right text-sm">{money(s.totalCents)}</span>
              </li>
            ))}
          </ul>
          {ov.shipments.total > ROWS && (
            <Link href={m4Href(d.id)} className="self-end text-xs text-accent underline underline-offset-2">{t('viewAllM4')}</Link>
          )}
        </>
      )}
    </SectionCard>
  );

  const vaultCard = (
    <SectionCard
      id="vault"
      title={t('sections.vault')}
      count={ov ? String(ov.vault.piecesCount) : undefined}
      aside={<Link href={`/admin/vaults/${q(d.id)}`} className="border border-border px-2 py-1 text-xs hover:bg-surface-2 focus-visible:shadow-focus focus-visible:outline-none">{t('openVault')}</Link>}
    >
      {ov && ov.vault.asOf && (
        <p className="bg-surface-2 px-3 py-2 text-xs text-muted">
          {t('vaultRef', { date: formatDate(ov.vault.asOf, locale), priced: ov.vault.pricedCount, count: ov.vault.piecesCount })}
        </p>
      )}
      {vault}
    </SectionCard>
  );

  const sellsCard = (
    <SectionCard id="sells" title={t('sections.sells')} count={`${Math.min(ROWS, sells.length)} / ${ov?.totals.sellRequests ?? sells.length}`}>
      {sells.length === 0 ? (
        <Empty>{t('empty.sells')}</Empty>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr><th className={th}>{t('cols.request')}</th><th className={th}>{t('cols.status')}</th><th className={th}>{t('cols.date')}</th><th className={cn(th, 'text-right')}>{t('cols.quoted')}</th><th className={th} /></tr></thead>
              <tbody>
                {rowsOf('sells', sells).map((s) => (
                  <tr key={s.id} className="border-t border-border">
                    <td className={cn(td, 'tabular font-mono')}>{s.id}</td>
                    <td className={td}><StatusBadge domain="sellRequest" value={s.status} /></td>
                    <td className={td}>{formatDate(s.createdAt, locale)}</td>
                    <td className={cn(td, 'tabular text-right')}>{money(s.quotedTotalCents)}</td>
                    <td className={cn(td, 'text-right')}>
                      <Link href={m5Href(d.id)} aria-label={t('openSellRow', { n: s.id })} className="inline-block border border-border px-2 py-1 text-xs hover:bg-surface-2 focus-visible:shadow-focus focus-visible:outline-none">{t('openM5')}</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {moreLink('sells', sells.length, ov?.totals.sellRequests ?? sells.length, m5Href(d.id), t('viewAllM5'))}
        </>
      )}
    </SectionCard>
  );

  const refundRows: RefundRef[] = ov?.refunds.items ?? [];
  const refundsCard = (
    <SectionCard id="refunds" title={t('sections.refunds')} count={ov ? `${ov.refunds.total} · ${ov.totals.disputes}` : undefined}>
      {overview.isError ? (
        blockError(() => overview.refetch())
      ) : !ov ? (
        loadingBlock
      ) : (
        <>
          {refundRows.length === 0 ? (
            <Empty>{t('empty.refunds')}</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr><th className={th}>{t('cols.refund')}</th><th className={th}>{t('cols.channel')}</th><th className={th}>{t('cols.status')}</th><th className={th}>{t('cols.order')}</th><th className={th}>{t('cols.date')}</th><th className={cn(th, 'text-right')}>{t('cols.amount')}</th></tr></thead>
                <tbody>
                  {refundRows.slice(0, ROWS).map((r) => (
                    <tr key={r.id} className="border-t border-border">
                      <td className={cn(td, 'tabular font-mono')}>{r.id}</td>
                      <td className={td}>{t(`refund.${r.channel}`)}</td>
                      <td className={td}><Badge tone={REFUND_TONE[r.status]} shape="outline">{t(`refund.status.${r.status}`)}</Badge></td>
                      <td className={cn(td, 'tabular font-mono')}>{r.orderId ?? '—'}</td>
                      <td className={td}>{formatDate(r.createdAt, locale)}</td>
                      <td className={cn(td, 'tabular text-right')}>{money(r.amountCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {ov.refunds.total > ROWS && (
            <span className="flex gap-4 self-end text-xs">
              <Link href={`/admin/refunds?userId=${q(d.id)}`} className="text-accent underline underline-offset-2">{t('viewAllRefunds')}</Link>
            </span>
          )}
          {disputes.length === 0 ? (
            <p className="border-t border-border pt-2 text-xs text-muted">{t('empty.disputes')}</p>
          ) : (
            <ul className="flex flex-col border-t border-border">
              {disputes.slice(0, ROWS).map((x) => (
                <li key={x.id} className="flex flex-wrap items-center gap-3 border-b border-border py-2 text-sm last:border-b-0">
                  <span className="tabular font-mono">{x.id}</span>
                  <StatusBadge domain="dispute" value={x.status} />
                  <span className="text-muted">{formatDate(x.createdAt, locale)}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </SectionCard>
  );

  const identityCard = (
    <SectionCard id="identity" title={t('sections.identity')} aside={<span className="text-xs text-muted">{t('identity.ineNotShown')}</span>}>
      {identity}
    </SectionCard>
  );
  const activityCard = (
    <SectionCard id="activity" title={t('sections.activity')} aside={<span className="text-xs text-muted">{t('activityNote')}</span>}>
      {activity}
    </SectionCard>
  );

  return (
    <div className="flex flex-col gap-4" data-testid="customer-ficha">
      {header}
      {strip}
      <div className="flex flex-col gap-4 lg:flex-row">
        <nav aria-label={t('navLabel')} className="hidden w-48 shrink-0 lg:block">
          <ul className="sticky top-0 flex flex-col border-l border-border text-sm">
            {SECTIONS.map((k) => (
              <li key={k}>
                <button
                  type="button"
                  onClick={() => go(k)}
                  className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-muted hover:text-text focus-visible:shadow-focus focus-visible:outline-none"
                >
                  <span>{t(`sections.${k}`)}</span>
                  {counts[k] != null && <span className="font-mono text-[11px]">{counts[k]}</span>}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <label className="flex flex-col gap-1 lg:hidden">
          <span className="sr-only">{t('goTo')}</span>
          <select
            aria-label={t('goTo')}
            defaultValue=""
            onChange={(e) => {
              if (e.target.value) go(e.target.value as SectionKey);
              e.target.value = '';
            }}
            className="min-h-[44px] border border-border bg-bg px-2 text-sm"
          >
            <option value="">{t('goTo')}</option>
            {SECTIONS.map((k) => (
              <option key={k} value={k}>{t(`sections.${k}`)}</option>
            ))}
          </select>
        </label>
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <div className="grid gap-4 lg:grid-cols-2">
            {attention}
            {notesCard}
          </div>
          {contact}
          {addressesCard}
          {ordersCard}
          {shipmentsCard}
          {vaultCard}
          {sellsCard}
          {refundsCard}
          {identityCard}
          {activityCard}
          {account}
        </div>
      </div>
    </div>
  );
}
