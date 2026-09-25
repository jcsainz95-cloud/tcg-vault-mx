'use client';

import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { getAdminVaultPhysicalInventory } from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { Banner } from '@/components/ui/Banner';
import { EmptyState } from '@/components/ui/EmptyState';
import { QueryState } from '@/components/ui/QueryState';
import { Skeleton } from '@/components/ui/Skeleton';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { AppLocale } from '@/i18n/routing';
import type { CustomerPhysicalInventoryDTO, PhysicalInventoryItemDTO, PhysicalState } from '@/types/contract';
import { CardInfo, LABEL, TAG, useZoneName, useZonedLabel } from '../../m4/prep-shared';
import { CustomerNameBlock } from '../CustomerNameBlock';

export const physicalInventoryQueryKey = (userId: string) => ['admin-vault-physical', userId] as const;

type Group = PhysicalState['state'];

/**
 * ⭐ **El orden en que se VEN los grupos (§36.11, PV-11): anomalías primero** — faltantes → sin ubicar
 * → en su cajón → por colocar → en un retiro. ⚠️ Es OTRO orden que la precedencia con que el servidor
 * decide el estado de cada carta (`physicalStateOf`), y ⛔ la pantalla no recalcula esa precedencia:
 * solo agrupa por `physical.state` tal cual llega.
 */
export const PHYSICAL_GROUP_ORDER: Group[] = ['missing', 'unlocated', 'in_drawer', 'pending_placement', 'in_withdrawal'];

const COUNT_KEY: Record<Group, keyof CustomerPhysicalInventoryDTO['counts']> = {
  missing: 'missing',
  unlocated: 'unlocated',
  in_drawer: 'inDrawer',
  pending_placement: 'pendingPlacement',
  in_withdrawal: 'inWithdrawal',
};

/**
 * **«Qué debe haber»** — la bóveda física de un cliente (`DESIGN_SYSTEM §36.11` · contrato
 * `§M4-VAULT.11`, `GET /admin/vaults/:userId/physical-inventory`). El operador la usa **delante del
 * cajón**, comprobando el archivero contra el sistema. ⛔ **Lectura pura**: ni un botón que corrija
 * nada. ⛔ Sin precios (no es valuación). Sin paginar.
 */
export function PhysicalInventoryPanel({ userId }: { userId: string }) {
  const t = useTranslations('admin.vaults.physical');
  const tv = useTranslations('admin.m4.prep.vault');

  const q = useQuery({
    queryKey: physicalInventoryQueryKey(userId),
    queryFn: () => getAdminVaultPhysicalInventory(userId),
  });
  const notFound = q.error instanceof ApiClientError && q.error.status === 404;

  if (notFound) {
    return (
      <Banner variant="danger" role="alert" title={t('notFound')}>
        {null}
      </Banner>
    );
  }

  return (
    <QueryState
      isLoading={q.isLoading}
      isError={q.isError}
      error={q.error}
      onRetry={() => q.refetch()}
      loading={
        // §8.1: esqueleto con la forma final (persona, cajón, una línea de conteos, dos grupos).
        <div className="flex flex-col gap-4" data-testid="physical-loading">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-4 w-72" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      }
    >
      {q.data && <PhysicalInventoryBody data={q.data} t={t} tv={tv} />}
    </QueryState>
  );
}

type Translator = ReturnType<typeof useTranslations>;

function PhysicalInventoryBody({
  data,
  t,
  tv,
}: {
  data: CustomerPhysicalInventoryDTO;
  t: Translator;
  tv: Translator;
}) {
  const zoned = useZonedLabel();
  const { drawer, counts } = data;

  return (
    <div className="flex flex-col gap-5" data-testid="physical-inventory">
      {/* 1 · La persona — §36.4 tal cual (misma pieza que la tarjeta de la cola). */}
      <CustomerNameBlock name={data.owner.name} email={data.owner.email} testId="physical-owner" />

      {/* 2 · El cajón. */}
      <div className="flex flex-col gap-1" data-testid="physical-drawer">
        {drawer.kind === 'single' && (
          <>
            <span className={LABEL}>{t('drawer.own')}</span>
            <span className="tabular font-mono text-sm text-text">
              {zoned(drawer.location.zone, drawer.location.label)}
            </span>
          </>
        )}
        {drawer.kind === 'multiple' && (
          <>
            <p className={cn(TAG, 'text-accent')}>{tv('drawer.multipleTag')}</p>{' '}
            <p className="text-sm text-text">{t('drawer.multiple', { count: drawer.locations.length })}</p>
            <ul className="flex flex-col gap-0.5">
              {drawer.locations.map((l) => (
                <li key={l.id} className="text-sm text-text">
                  <span className="tabular font-mono">{zoned(l.zone, l.label)}</span> —{' '}
                  {tv('drawer.piecesThere', { count: l.customerPieceCount })}
                </li>
              ))}
            </ul>
          </>
        )}
        {drawer.kind === 'none' && (
          <>
            <p className="text-sm text-text">{t('drawer.none')}</p>
            {counts.pendingPlacement > 0 && <p className="text-sm text-text">{t('drawer.nonePending')}</p>}
          </>
        )}
      </div>

      {data.items.length === 0 ? (
        <EmptyState title={t('empty.title')} body={t('empty.body')} />
      ) : (
        <>
          {/* 3 · Resumen: un conteo en 0 SÍ se dice (es la respuesta a «¿falta algo?»). DOM: `dt`
              (qué) antes que `dd` (cuántos); a la vista, el número primero. */}
          <dl aria-label={t('counts.label')} data-testid="physical-counts" className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-text">
            {PHYSICAL_GROUP_ORDER.map((g) => {
              const n = counts[COUNT_KEY[g]];
              return (
                <div key={g} className="flex flex-row-reverse gap-1" data-count={g}>
                  <dt>{t(`counts.${COUNT_KEY[g]}`, { count: n })}</dt>
                  <dd className="tabular">{n}</dd>
                </div>
              );
            })}
            <div className="flex flex-row-reverse gap-1" data-count="total">
              <dt>{t('counts.total')}</dt>
              <dd className="tabular">{counts.total}</dd>
            </div>
          </dl>

          {/* 4 · Los grupos, anomalías primero. Un grupo vacío NO se pinta (su conteo sí, arriba). */}
          {PHYSICAL_GROUP_ORDER.map((g) => {
            const rows = data.items.filter((i) => i.physical.state === g);
            if (rows.length === 0) return null;
            const headingId = `physical-group-${g}`;
            return (
              <section key={g} aria-labelledby={headingId} data-testid={headingId} className="flex flex-col gap-3">
                <h3
                  id={headingId}
                  className={cn(TAG, g === 'missing' || g === 'unlocated' ? 'text-accent' : 'text-text')}
                >
                  {t(`group.${g}`)} ({rows.length})
                </h3>
                <ul className="flex flex-col gap-3">
                  {rows.map((item) => (
                    <PhysicalRow key={item.inventoryItemId} item={item} t={t} />
                  ))}
                </ul>
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}

function PhysicalRow({ item, t }: { item: PhysicalInventoryItemDTO; t: Translator }) {
  const tp = useTranslations('admin.m4.prep');
  const tv = useTranslations('admin.m4.prep.vault');
  const tShip = useTranslations('status.shipment');
  const zoneName = useZoneName();
  const zoned = useZonedLabel();
  const locale = useLocale() as AppLocale;
  const loc = item.currentLocation;
  const p = item.physical;
  const folio = item.origin?.orderNumber ?? item.origin?.orderId ?? null;

  let sentence: React.ReactNode = null;
  if (p.state === 'missing') {
    const orderFolio = folio ?? p.placementId;
    const date = (chunks: React.ReactNode) => <time dateTime={p.markedAt}>{chunks}</time>;
    const formatted = formatDate(p.markedAt, locale);
    sentence = p.markedBy.name?.trim()
      ? t.rich('row.missing', { name: p.markedBy.name.trim(), date: formatted, folio: orderFolio, d: date })
      : t.rich('row.missingNoName', { date: formatted, folio: orderFolio, d: date });
  } else if (p.state === 'unlocated') {
    sentence =
      p.reason === 'not_in_customer_drawer' && loc.kind === 'assigned' && item.currentZone
        ? t('row.notInCustomerDrawer', { location: zoned(item.currentZone, loc.label) })
        : t('row.noLocation');
  } else if (p.state === 'pending_placement') {
    const progress = p.prepared ? t('row.prepPrepared') : p.prepStatus === 'picked' ? t('row.prepPicked') : t('row.prepPending');
    sentence = (
      <>
        {t('row.pendingPlacement', { folio: folio ?? p.placementId })} · {progress}
      </>
    );
  } else if (p.state === 'in_withdrawal') {
    sentence = t('row.inWithdrawal', { status: tShip(p.shipmentStatus) });
  }

  return (
    <li
      data-testid={`physical-item-${item.inventoryItemId}`}
      className="flex flex-col gap-2 border-t border-border pt-3 first:border-t-0 first:pt-0"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:gap-4">
        {/* Ubicación PRIMERO, en columna, CON su zona (V3, §35.4). */}
        <div className="flex shrink-0 flex-col gap-0.5 sm:w-40" data-testid={`physical-location-${item.inventoryItemId}`}>
          {loc.kind === 'assigned' ? (
            <>
              <span className={LABEL}>
                {item.currentZone ? tv('item.locationLabel', { zone: zoneName(item.currentZone) }) : tp('location')}
              </span>
              <span className="tabular text-sm text-text">{loc.label}</span>
            </>
          ) : (
            <>
              <span className={LABEL}>{tp('location')}</span>
              <span className="text-sm text-accent">{tp('unassigned')}</span>
            </>
          )}
        </div>
        <div className="flex min-w-0 flex-1 gap-3">
          <CardInfo card={item.card} folio={item.folio} quantity={1} t={tp} />
        </div>
      </div>
      {sentence && <p className="text-sm text-text">{sentence}</p>}
    </li>
  );
}
