'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { getShipments, getAdminInventory } from '@/lib/api';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { PipelineStepper } from '@/components/ui/PipelineStepper';
import { QueryState } from '@/components/ui/QueryState';
import { useShipmentSteps } from '@/lib/pipelines';
import type { InventoryItemDTO, ShipmentDTO } from '@/types/contract';

export function M4View() {
  const t = useTranslations('admin.m4');
  const ts = useTranslations('shipments');
  const steps = useShipmentSteps();
  const shipments = useQuery({ queryKey: ['shipments'], queryFn: getShipments });
  const inventory = useQuery({ queryKey: ['admin-inventory'], queryFn: getAdminInventory });

  const pickingColumns: Column<InventoryItemDTO>[] = [
    { key: 'location', header: 'Ubicación', render: (i) => <span className="tabular">{i.location?.label ?? '—'}</span> },
    { key: 'folio', header: 'Folio', render: (i) => <span className="tabular">{i.folio}</span> },
    { key: 'card', header: 'Carta', render: (i) => <span lang="en">{i.card.name}</span> },
    { key: 'status', header: 'Estado', render: (i) => <StatusBadge domain="inventory" value={i.status} /> },
  ];

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-h1 font-bold">{t('title')}</h1>

      <section className="flex flex-col gap-4">
        <h2 className="text-h2 font-semibold">{ts('myShipments')}</h2>
        <QueryState
          isLoading={shipments.isLoading}
          isError={shipments.isError}
          error={shipments.error}
          onRetry={() => shipments.refetch()}
        >
          {(shipments.data ?? []).map((s: ShipmentDTO) => (
            <div key={s.id} className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
              <div className="flex items-center gap-2">
                <span className="tabular text-sm font-medium">{s.id}</span>
                <StatusBadge domain="shipment" value={s.status} />
              </div>
              <PipelineStepper steps={steps} current={s.status} />
            </div>
          ))}
        </QueryState>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-h2 font-semibold">{t('pickingList')}</h2>
        <QueryState
          isLoading={inventory.isLoading}
          isError={inventory.isError}
          error={inventory.error}
          onRetry={() => inventory.refetch()}
        >
          {inventory.data && (
            <div className="rounded-lg border border-border bg-surface p-2">
              <DataTable
                columns={pickingColumns}
                rows={[...inventory.data].sort((a, b) =>
                  (a.location?.label ?? '').localeCompare(b.location?.label ?? ''),
                )}
                rowKey={(i) => i.id}
              />
            </div>
          )}
        </QueryState>
      </section>
    </div>
  );
}
