'use client';

import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { getDashboard } from '@/lib/api';
import { useRole } from '@/lib/role';
import { Link } from '@/i18n/navigation';
import type { AppLocale } from '@/i18n/routing';
import { formatMoneyCents, formatDate } from '@/lib/format';
import { StatCard } from '@/components/ui/StatCard';
import { QueryState } from '@/components/ui/QueryState';
import { Skeleton } from '@/components/ui/Skeleton';

/**
 * §7.8 — Los conteos de la cola de trabajo son ENLACES accionables a su módulo
 * (envíos→M4, buylist→M5, precios pendientes→M2), no cifras muertas. F-26 (§PNL.10.7, `DESIGN_SYSTEM §60.8`):
 * M8 se retiró de la interfaz ⇒ `workQueue.disputes` ya no se suma ni enlaza (el DTO lo sigue trayendo).
 * Subrayado en hover + anillo bermellón en foco (DESIGN_SYSTEM §8.2); el número va
 * en `tabular` para que StatCard lo tiña cuando corresponde.
 */
function QueueLink({ href, label, count }: { href: string; label: string; count: number }) {
  return (
    <Link
      href={href}
      className="underline-offset-2 hover:text-text hover:underline focus-visible:shadow-focus focus-visible:outline-none"
    >
      {label} <span className="tabular font-medium text-text">{count}</span>
    </Link>
  );
}

/** Días enteros desde una fecha ISO (la «más vieja» de la cubeta SPEI); ilegible ⇒ 0. */
function daysSince(iso: string, now: Date = new Date()): number {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((now.getTime() - t) / 86_400_000));
}

/**
 * 6i — Las tarjetas de métricas se vuelven una retícula de celdas con regla: más
 * datos por pantalla y ninguna caja redondeada. La regla la pone la retícula
 * (`divide-*`), no la celda, para que no se dupliquen los filetes. Fuera los
 * iconos: cada métrica ya se identifica por su etiqueta.
 */
export function AdminDashboard() {
  const t = useTranslations('admin.dashboard');
  const tm = useTranslations('admin');
  const locale = useLocale() as AppLocale;
  const { isSuperAdmin } = useRole();
  const query = useQuery({ queryKey: ['dashboard'], queryFn: getDashboard });

  // -mx-* rompe el margen del shell: las reglas de la retícula llegan a los bordes.
  const grid =
    'grid -mx-5 lg:-mx-10 border-y border-border divide-y sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4 [&>*:nth-child(n+5)]:sm:border-t';

  return (
    <div>
      <div className="pb-6">
        <h1 className="font-serif text-[26px] leading-[1.1] text-text lg:text-[36px]">
          {tm('modules.dashboard')}
        </h1>
      </div>
      <QueryState
        isLoading={query.isLoading}
        isError={query.isError}
        error={query.error}
        onRetry={() => query.refetch()}
        loading={
          <div className={grid}>
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="px-6 py-7 sm:px-10">
                <Skeleton className="h-16" />
              </div>
            ))}
          </div>
        }
      >
        {query.data && (
          <div className={grid}>
            <StatCard
              label={t('profit')}
              value={formatMoneyCents(query.data.profitPeriodCents ?? 0, locale)}
              masked={!isSuperAdmin}
              maskedLabel={tm('masked')}
            />
            {/*
             * ⭐⭐ **§M10-IVA.7 — LA TARJETA PASA DE UNA CIFRA A DOS: BRUTO Y NETO** (D55(b),
             * pregunta **70** del dueño: *«Hagamos ventas brutas con iva y ventas netas sin iva»*).
             *
             * `amountCents` **desapareció** del DTO y fue el compilador quien trajo aquí — que es
             * justo lo que el rename buscaba: *un «amount» conviviendo con otro «amount» distinto
             * es la ambigüedad que este pase existe para matar*.
             *
             * **Qué es cada una, dicho donde se pinta:**
             * - **bruto** = `Σ Order.totalCents` = **lo que el cliente pagó**, con comisión y envío
             *   dentro.
             * - **neto**  = `Σ netRevenueCents(o)` = **mercancía**, sin IVA, sin comisión y sin
             *   envío. ⭐ Sale **del mismo helper** que `pnl.incomeCents`, así que **es el mismo
             *   número** que el P&L de M7 (candado `IVA-10(b)` lo asierta como igualdad entre los
             *   dos endpoints). *El dueño preguntó si era el mismo número; lo es por construcción.*
             *
             * ⛔ **El front NO calcula ninguna de las dos, ni la diferencia entre ellas.** La
             * identidad `bruto ≡ neto + envío neto + IVA + comisión` la garantiza el servidor; si
             * esta pantalla la recompusiera, estaría publicando **una tercera definición de neto**,
             * que es exactamente lo que §M10-IVA.7 rechaza por escrito.
             */}
            <StatCard
              label={t('sales')}
              value={query.data.salesPeriod.count}
              sub={
                <span className="flex flex-col gap-0.5">
                  <span data-testid="sales-gross">
                    {t('salesGross')}: {formatMoneyCents(query.data.salesPeriod.grossAmountCents, locale)}
                  </span>
                  {/* Hueco 9 (2026-09-29): el backend OMITE `netAmountCents` al no-súper-admin (el neto
                      es la cifra del P&L, `admin.service.ts` · `dashboard`). Sin el campo la línea no
                      se pinta: nunca «MX$NaN». ⛔ No se deriva del bruto (sería otra definición de neto). */}
                  {Number.isFinite(query.data.salesPeriod.netAmountCents) && (
                    <span data-testid="sales-net">
                      {t('salesNet')}: {formatMoneyCents(query.data.salesPeriod.netAmountCents, locale)}
                    </span>
                  )}
                </span>
              }
            />
            <StatCard
              label={t('workQueue')}
              value={
                query.data.workQueue.shipments +
                query.data.workQueue.buylist
              }
              sub={
                <span className="flex flex-wrap gap-x-3 gap-y-1">
                  <QueueLink href="/admin/m4" label={t('shipments')} count={query.data.workQueue.shipments} />
                  <QueueLink href="/admin/m5" label="Buylist" count={query.data.workQueue.buylist} />
                  <QueueLink href="/admin/m2" label={t('pendingPrices')} count={query.data.workQueue.pendingPrices} />
                </span>
              }
            />
            {/*
             * v1.80 (§M4-SHIP.11 · `DESIGN_SYSTEM §37.11b`): «Pedidos por preparar» INCLUYE bóveda y los casos
             * «Por reponer» (el mismo cuerpo que el `summary`); los vencidos van en bermellón y enlazan a la
             * pestaña filtrada. ⛔ `workQueue.shipments` («envíos vivos») no cambia de cifra ni de rótulo.
             * Opcional en el tipo (aditivo): un backend anterior no la manda y la tarjeta no se pinta.
             */}
            {query.data.workQueue.toPrepare && (
              <StatCard
                label={t('toPrepare.title')}
                value={
                  query.data.workQueue.toPrepare.ship +
                  query.data.workQueue.toPrepare.vault +
                  query.data.workQueue.toPrepare.toReplace
                }
                sub={
                  <span className="flex flex-wrap gap-x-3 gap-y-1" data-testid="dashboard-to-prepare">
                    <Link
                      href="/admin/m4"
                      className="underline-offset-2 hover:text-text hover:underline focus-visible:shadow-focus focus-visible:outline-none"
                    >
                      {t('toPrepare.detail', {
                        ship: query.data.workQueue.toPrepare.ship,
                        vault: query.data.workQueue.toPrepare.vault,
                        toReplace: query.data.workQueue.toPrepare.toReplace,
                      })}
                    </Link>
                    {query.data.workQueue.toPrepare.toReplaceOverdue > 0 && (
                      <Link
                        href="/admin/m4?tab=reponer"
                        className="text-accent underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
                        data-testid="dashboard-to-prepare-overdue"
                      >
                        {t('toPrepare.overdue', { count: query.data.workQueue.toPrepare.toReplaceOverdue })}
                      </Link>
                    )}
                  </span>
                }
              />
            )}
            {/* v1.80.2 (§37.11b): solo súper-admin; `null` (operador) ⇒ la tarjeta NO existe (S6). */}
            {isSuperAdmin && query.data.workQueue.manualRefunds && (
              <StatCard
                label={t('manualRefunds.title')}
                value={query.data.workQueue.manualRefunds.pending}
                sub={
                  <Link
                    href="/admin/refunds"
                    className="underline-offset-2 hover:text-text hover:underline focus-visible:shadow-focus focus-visible:outline-none"
                    data-testid="dashboard-manual-refunds"
                  >
                    {query.data.workQueue.manualRefunds.pending > 0 && query.data.workQueue.manualRefunds.oldestCreatedAt
                      ? t('manualRefunds.detail', {
                          amount: formatMoneyCents(query.data.workQueue.manualRefunds.pendingCents, locale),
                          days: daysSince(query.data.workQueue.manualRefunds.oldestCreatedAt),
                        })
                      : t('manualRefunds.detailNone')}
                  </Link>
                }
              />
            )}
            {/* 💰 v1.80.8.6 (§M4-SHIP.18.12 (7), DESIGN_SYSTEM §40.3 e): solo súper-admin; `null` ⇒ la tarjeta NO existe. */}
            {isSuperAdmin && query.data.workQueue.refundReviews && (
              <StatCard
                label={t('refundReviews.title')}
                value={query.data.workQueue.refundReviews.pending}
                sub={
                  <Link
                    href="/admin/m3?refundReview=pending"
                    className="underline-offset-2 hover:text-text hover:underline focus-visible:shadow-focus focus-visible:outline-none"
                    data-testid="dashboard-refund-reviews"
                  >
                    {query.data.workQueue.refundReviews.pending > 0 && query.data.workQueue.refundReviews.oldestRefundedAt
                      ? t('refundReviews.detail', { days: daysSince(query.data.workQueue.refundReviews.oldestRefundedAt) })
                      : t('refundReviews.detailNone')}
                  </Link>
                }
              />
            )}
            {/* v1.80.3 (SEC-SHIP-M1, D-13 «solo verlo en el panel»): el tablero ES el aviso; ⛔ sin correo. */}
            {isSuperAdmin && query.data.workQueue.operatorRefunds && (
              <StatCard
                label={t('operatorRefunds.title')}
                value={formatMoneyCents(query.data.workQueue.operatorRefunds.last24hCents, locale)}
                sub={
                  <Link
                    href="/admin/refunds?tab=operadores"
                    className="underline-offset-2 hover:text-text hover:underline focus-visible:shadow-focus focus-visible:outline-none"
                    data-testid="dashboard-operator-refunds"
                  >
                    {t('operatorRefunds.detail', {
                      count: query.data.workQueue.operatorRefunds.last24hCount,
                      amount30d: formatMoneyCents(query.data.workQueue.operatorRefunds.last30dCents, locale),
                    })}
                  </Link>
                }
              />
            )}
            <StatCard
              label={t('inventoryValue')}
              value={formatMoneyCents(query.data.inventoryValueCents ?? 0, locale)}
              masked={!isSuperAdmin}
              maskedLabel={tm('masked')}
            />
            <StatCard
              label={t('custodyValue')}
              value={formatMoneyCents(query.data.custodyValueCents ?? 0, locale)}
              masked={!isSuperAdmin}
              maskedLabel={tm('masked')}
            />
            <StatCard
              label={t('buylist')}
              value={query.data.buylistPeriod.count}
              sub={formatMoneyCents(query.data.buylistPeriod.amountCents, locale)}
            />
            <StatCard
              label={t('dataHealth')}
              // La única cifra en bermellón del tablero: lo que exige intervención.
              className="[&_span.tabular]:text-accent"
              value={query.data.dataHealth.pendingPriceCount}
              sub={
                <>
                  <Link
                    href="/admin/m2"
                    className="underline-offset-2 hover:text-text hover:underline focus-visible:shadow-focus focus-visible:outline-none"
                  >
                    {t('pendingPrices')}
                  </Link>
                  <br />
                  {t('lastSync')} {formatDate(query.data.dataHealth.lastPriceSyncAt, locale)} ·{' '}
                  {t('lastFx')} {formatDate(query.data.dataHealth.lastFxAt, locale)}
                </>
              }
            />
            <StatCard
              label={t('launch')}
              value={query.data.launchProgress.salesSettled}
              sub={
                <>
                  {t('goalPending')}
                  <br />
                  {t('users')} {query.data.launchProgress.users} · {t('buylistPaid')}{' '}
                  {query.data.launchProgress.buylistPaid} · {t('withdrawals')}{' '}
                  {query.data.launchProgress.withdrawalsNoDispute}
                </>
              }
            />
          </div>
        )}
      </QueryState>
    </div>
  );
}
