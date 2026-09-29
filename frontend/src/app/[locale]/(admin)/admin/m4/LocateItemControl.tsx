'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { getLocations, moveInventoryItem } from '@/lib/api';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { QueryState, useErrorMessage } from '@/components/ui/QueryState';
import type { InventoryItemDTO, PreparationItemDTO, PreparationOrderDTO } from '@/types/contract';

/**
 * **Hueco 1 (auditoría del operador, 2026-09-29) — «Ubicar» una carta de un pedido de ENVÍO.**
 *
 * La tarjeta de envío de «Pedidos a preparar» mostraba «Sin ubicar» sin ningún camino para
 * resolverlo: la pieza está vendida (`picking`) y el detalle de M1 solo dejaba mover `in_stock|listed`.
 * Este control abre un selector de ubicaciones de **stock de plataforma** activas
 * (`GET /admin/locations`, la misma consulta `['locations']` que M1) y llama al endpoint EXISTENTE
 * `POST /admin/inventory/items/:id/move` (contrato §M1; el backend lo acepta en `picking`, medido 200).
 *
 * ⛔ No toca dinero ni el estado de la pieza: solo `locationId` (+ el `InventoryMovement` que registra
 * el backend). Con la respuesta se **reescribe la tarjeta en caché** (`currentLocation`), sin esperar
 * a otra ida a `picking-list`.
 */
export function LocateItemControl({ item }: { item: PreparationItemDTO }) {
  const t = useTranslations('admin.m4.prep.locate');
  const tc = useTranslations('common');
  const tZone = useTranslations('admin.m1.zone');
  const getError = useErrorMessage('operator');
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [toLocationId, setToLocationId] = useState('');
  const cancelRef = useRef<HTMLButtonElement>(null);

  const locations = useQuery({ queryKey: ['locations'], queryFn: getLocations, enabled: open });
  const currentLabel = item.currentLocation.kind === 'assigned' ? item.currentLocation.label : null;
  // Solo stock de plataforma activo: una carta vendida que aún no sale sigue en el stock de la tienda.
  // La guarda real es el backend; filtrar aquí es presentación.
  const options = (locations.data ?? [])
    .filter((l) => l.zone === 'platform_stock' && l.isActive)
    .map((l) => ({
      value: l.id,
      label: `${tZone(l.zone)} · ${l.label}`,
    }));

  const move = useMutation({
    mutationFn: () => moveInventoryItem(item.inventoryItemId, { toLocationId }),
    onSuccess: (res: InventoryItemDTO) => {
      const label = res.location?.label?.trim();
      if (label) {
        qc.setQueriesData<PreparationOrderDTO[]>({ queryKey: ['admin-preparation-queue'] }, (prev) =>
          prev?.map((o) =>
            o.destination !== 'ship'
              ? o
              : {
                  ...o,
                  items: o.items.map((it) =>
                    it.inventoryItemId === item.inventoryItemId
                      ? { ...it, currentLocation: { kind: 'assigned' as const, label } }
                      : it,
                  ),
                },
          ),
        );
      } else {
        // Respuesta sin ubicación (no debería ocurrir tras un move): se pide la cola al servidor.
        void qc.invalidateQueries({ queryKey: ['admin-preparation-queue'] });
      }
      void qc.invalidateQueries({ queryKey: ['admin-inventory'] });
      void qc.invalidateQueries({ queryKey: ['admin-inventory-item', item.inventoryItemId] });
      setOpen(false);
    },
  });

  // El foco va a «Cancelar» al abrir: el efecto del padre corre DESPUÉS del de `Modal` (que enfoca
  // su contenedor), así que este gana.
  useEffect(() => {
    if (open) cancelRef.current?.focus();
  }, [open]);

  function openDialog() {
    setToLocationId('');
    move.reset();
    setOpen(true);
  }

  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        onClick={openDialog}
        aria-label={t('actionAria', { folio: item.folio })}
        data-testid={`prep-locate-${item.shipmentItemId}`}
      >
        {t('action')}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t('title')}
        footer={
          <>
            <Button ref={cancelRef} variant="ghost" onClick={() => setOpen(false)}>
              {tc('cancel')}
            </Button>
            <Button
              onClick={() => move.mutate()}
              disabled={!toLocationId || move.isPending}
              loading={move.isPending}
            >
              {t('confirm')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-sm text-text">
            <span lang="en" className="font-medium">
              {item.card.name}
            </span>{' '}
            · {t('folio')} <span className="tabular">{item.folio}</span>
          </p>
          <p className="text-sm text-text">
            {t('current')}{' '}
            {currentLabel ? <span className="tabular">{currentLabel}</span> : <span className="text-accent">{t('none')}</span>}
          </p>
          <QueryState
            isLoading={locations.isLoading}
            isError={locations.isError}
            error={locations.error}
            onRetry={() => locations.refetch()}
          >
            {options.length === 0 ? (
              <p className="text-sm text-text">{t('noLocations')}</p>
            ) : (
              <Select
                label={t('target')}
                placeholder={t('targetPlaceholder')}
                options={options}
                value={toLocationId}
                onChange={(e) => setToLocationId(e.target.value)}
              />
            )}
          </QueryState>
          {move.isError && (
            <Banner variant="danger" role="alert" title={t('error')}>
              {getError(move.error)}
            </Banner>
          )}
        </div>
      </Modal>
    </>
  );
}
