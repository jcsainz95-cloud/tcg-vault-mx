'use client';

import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { getOrders } from '@/lib/api';
import { useSession } from '@/lib/session';
import type { AppLocale } from '@/i18n/routing';
import { formatMoneyCents, formatDate } from '@/lib/format';
import { Link } from '@/i18n/navigation';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { QueryState } from '@/components/ui/QueryState';
import { ClaimableOrdersNotice } from '@/components/domain/claimable/ClaimableOrdersNotice';
import type { OrderSummaryDTO } from '@/types/contract';
import { MyRequestsSection } from '../buylist/MyRequestsSection';
import { ResumePaymentAction } from './ResumePaymentAction';

/** Pestañas-enlace de «Compras y ventas» (§33.3): `/orders` ⇆ `/orders?tab=ventas`. */
export type OrdersTab = 'compras' | 'ventas';

/** Valor de `?tab=` que activa «Ventas»; cualquier otro (o ninguno) es «Compras». */
export const ORDERS_SALES_TAB = 'ventas';

const TAB_LINK_BASE = '-mb-px inline-flex min-h-[44px] items-center border-b-2 px-1 text-sm';
const TAB_LINK_ACTIVE = 'border-text text-text';
const TAB_LINK_IDLE = 'border-transparent text-muted hover:text-text';

/**
 * 6f — La tabla pierde el fondo y se apoya solo en reglas y en la numeración
 * monoespaciada; el folio del pedido es el único elemento en bermellón, porque
 * es lo único accionable del renglón.
 *
 * §33.3 (Stream A · P-57c): «Compras y ventas» es UNA página con DOS pestañas que son ENLACES
 * (cambian la URL: `/orders` y `/orders?tab=ventas`), no estado de cliente — por eso NO llevan
 * `role="tablist"` (§33.15.9). «Ventas» monta `MyRequestsSection` tal cual (se muda desde
 * `/buylist`). Arriba de «Compras» vive el aviso de pedidos reclamables (§33.9), que no pinta
 * nada mientras no haya nada que ofrecer.
 */
export function OrdersView() {
  const t = useTranslations('orders');
  const locale = useLocale() as AppLocale;
  const searchParams = useSearchParams();
  const tab: OrdersTab = searchParams.get('tab') === ORDERS_SALES_TAB ? 'ventas' : 'compras';
  const session = useSession();
  // La tabla de compras solo se consulta en su pestaña (la de ventas tiene su propia query).
  const query = useQuery({ queryKey: ['orders'], queryFn: getOrders, enabled: tab === 'compras' });

  const columns: Column<OrderSummaryDTO>[] = [
    {
      key: 'id',
      header: t('orderNumber', { id: '' }).trim(),
      render: (o) => (
        <Link href={`/orders/${o.id}`} className="tabular font-mono text-accent hover:text-text">
          {/* Folio REAL (contrato v1.68 §4-R.5: `orderNumber: string | null`); el id solo cuando
              el servidor manda `null` (pedido anterior al folio). */}
          {o.orderNumber ?? o.id}
        </Link>
      ),
    },
    { key: 'date', header: t('date'), render: (o) => formatDate(o.createdAt, locale) },
    {
      key: 'status',
      header: t('status'),
      render: (o) => (
        <div>
          <StatusBadge domain="order" value={o.status} />
          {/* v1.68 §4-R.5: `pending` con reserva viva ⇒ «reservada hasta HH:MM» + «Reanudar pago». */}
          <ResumePaymentAction order={o} className="mt-2" />
        </div>
      ),
    },
    {
      key: 'total',
      header: t('total'),
      numeric: true,
      render: (o) => formatMoneyCents(o.totalCents, locale),
    },
  ];

  return (
    <div>
      <h1 className="gutter pb-6 pt-10 font-serif text-[30px] leading-[1.1] text-text lg:pt-[46px] lg:text-[40px]">
        {t('title')}
      </h1>

      {/* Pestañas = navegación de contenido (piel de las tabs de bóveda: 14px, subrayado tinta). */}
      <nav aria-label={t('tabs.label')} className="gutter flex gap-5 border-b border-border">
        <Link
          href="/orders"
          aria-current={tab === 'compras' ? 'page' : undefined}
          className={`${TAB_LINK_BASE} ${tab === 'compras' ? TAB_LINK_ACTIVE : TAB_LINK_IDLE}`}
        >
          {t('tabs.purchases')}
        </Link>
        <Link
          href={`/orders?tab=${ORDERS_SALES_TAB}`}
          aria-current={tab === 'ventas' ? 'page' : undefined}
          className={`${TAB_LINK_BASE} ${tab === 'ventas' ? TAB_LINK_ACTIVE : TAB_LINK_IDLE}`}
        >
          {t('tabs.sales')}
        </Link>
      </nav>

      {tab === 'compras' ? (
        <div className="gutter pb-14 pt-6">
          {/* §33.9: los pedidos a domicilio nunca pasan por la bóveda; aquí es donde se reclaman. */}
          <ClaimableOrdersNotice surface="orders" className="mb-6" />
          <QueryState
            isLoading={query.isLoading}
            isError={query.isError}
            error={query.error}
            onRetry={() => query.refetch()}
          >
            {(query.data?.data.length ?? 0) === 0 ? (
              <EmptyState
                title={t('noOrders')}
                action={
                  <Link
                    href="/catalog"
                    className="inline-flex min-h-[44px] items-center border border-text px-6 text-[11px] font-medium uppercase tracking-label text-text hover:bg-text hover:text-primary-fg"
                  >
                    {t('emptyCta')}
                  </Link>
                }
              />
            ) : (
              <DataTable columns={columns} rows={query.data!.data} rowKey={(o) => o.id} />
            )}
          </QueryState>
        </div>
      ) : (
        /* «Ventas»: el contenido de «Mis solicitudes» se muda aquí tal cual (§33.3). */
        <MyRequestsSection
          ready={session.ready}
          isAuthenticated={session.isAuthenticated}
          emptyAction={
            <Link
              href="/buylist"
              className="inline-flex min-h-[44px] items-center border border-text px-6 text-[11px] font-medium uppercase tracking-label text-text hover:bg-text hover:text-primary-fg"
            >
              {t('sales.emptyCta')}
            </Link>
          }
        />
      )}
    </div>
  );
}
