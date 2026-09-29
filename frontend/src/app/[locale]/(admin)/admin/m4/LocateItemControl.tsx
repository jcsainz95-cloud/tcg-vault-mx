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
import type { PreparationItemDTO, PreparationOrderDTO } from '@/types/contract';

/**
 * **Hueco 1 (auditoría del operador, 2026-09-29) — «Ubicar» una carta de un pedido de ENVÍO.**
 *
 * La tarjeta de envío de «Pedidos a preparar» mostraba «Sin ubicar» sin ningún camino para
 * resolverlo: la pieza está vendida (`picking`) y el detalle de M1 solo dejaba mover `in_stock|listed`.
 * Este control abre un selector de ubicaciones de **stock de plataforma** activas
 * (`GET /admin/locations`, la misma consulta `['locations']` que M1) y llama al endpoint EXISTENTE
 * `POST /admin/inventory/items/:id/move` (contrato §M1; el backend lo acepta en `picking`, medido 200).
 *
 * ⛔⛔ **Solo se monta en tarjetas de ENVÍO DIRECTO** (`orderId !== null`, pieza de la plataforma
 * vendida). En un **retiro de bóveda** (`orderId === null`) la carta es DEL CLIENTE (`in_custody`, en
 * su cajón `customer_custody`): moverla al estante de la tienda rompe §M4-VAULT (un cliente = un
 * cajón). QA lo midió contra el stack el 2026-09-29 (200 y `ownerType=customer` en `platform_stock`).
 * La decisión de montarlo la toma `PreparationQueue` (`canLocate`); candado en
 * `M4View.operator-gaps.test.tsx` («un RETIRO no ofrece Ubicar»).
 *
 * ⛔ No toca dinero ni el estado de la pieza: solo `locationId` (+ el `InventoryMovement` que registra
 * el backend). Tras el 200 se **reescribe la tarjeta en caché** (`currentLocation`) con la etiqueta de
 * la ubicación **elegida**, no con la respuesta: el backend de esta rama (`6e3b1b7`,
 * `inventory.service.ts · moveItem`) ya devuelve `location`, pero production `a2da420` aún sirve la
 * fila de `toAdminInventoryItemRow` (solo `locationId`), y front y back se publican por separado.
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
  // ⚠️ C-1 (techlead, 2026-09-29): el backend de production (`a2da420`) NO restringe hoy la zona del
  // destino ni el dueño de la pieza en `move` (QA: carta de cliente al estante ⇒ 200). La guarda llega
  // en esta rama: `backend/src/modules/inventory/item-location.rules.ts` · `assertMoveDestination`
  // (plataforma ⇒ solo `platform_stock` activo, si no `422 LOCATION_NOT_AVAILABLE`) y
  // `assertOperable`/`inActiveWithdrawalError` (carta de cliente en un retiro cobrado ⇒ `409`). Con
  // ese backend desplegado, este filtro —y el `canLocate` de `PreparationQueue`— son presentación;
  // hasta entonces son la única barrera.
  const options = (locations.data ?? [])
    .filter((l) => l.zone === 'platform_stock' && l.isActive)
    .map((l) => ({
      value: l.id,
      label: `${tZone(l.zone)} · ${l.label}`,
    }));

  const move = useMutation({
    mutationFn: (to: string) => moveInventoryItem(item.inventoryItemId, { toLocationId: to }),
    onSuccess: (_res, to) => {
      // La etiqueta es la de la ubicación ELEGIDA (vale con y sin `location` en la respuesta, ver arriba).
      const label = (locations.data ?? []).find((l) => l.id === to)?.label?.trim();
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
        // Ubicación elegida ya no está en la lista (no debería ocurrir): se pide la cola al servidor.
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
              onClick={() => move.mutate(toLocationId)}
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
