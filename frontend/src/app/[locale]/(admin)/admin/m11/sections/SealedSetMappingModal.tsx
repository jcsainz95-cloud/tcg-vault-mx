'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import {
  setSealedSetMainGroup,
  deleteSealedSetGroup,
  triggerSealedPriceIngest,
} from '@/lib/api';
import type { SealedPriceStatusRowDTO } from '@/types/contract';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Banner } from '@/components/ui/Banner';
import { useErrorMessage } from '@/components/ui/QueryState';

/**
 * §diseño §4 — «Arreglar el precio de: {set}» (antes «Mapeo manual del grupo TCGCSV»). Es el MISMO
 * mapeo `super_admin` de siempre, solo re-rotulado a lenguaje llano: fijar/corregir el grupo
 * `set_main` (`PUT .../sealed-sets/:setId/set-main-group`, que REESCRIBE `CardSet.tcgcsvGroupId`
 * aunque ya haya uno) y desenlazar un grupo equivocado (`DELETE .../sealed-sets/:setId/groups/:id`).
 *
 * §diseño §3 / §6 D-3 (default aprobado 2026-09-17) — tras **Conectar** se dispara la actualización
 * de ESE set de inmediato: `triggerSealedPriceIngest(groupId)` acotado al grupo recién conectado
 * (el DTO del job ya acepta `groupId`). Así el usuario no tiene que volver a pulsar el botón grande.
 *
 * ⛔ No fabrica precio (I-2): conectar solo dice de qué grupo saldrá; el precio lo trae el job. Todo
 * cambio queda en `AuditLog` con `before/after` (lo escribe el backend). Sigue siendo `super_admin`
 * (el backend 403ea igualmente).
 */
export function SealedSetMappingModal({
  row,
  onClose,
}: {
  row: SealedPriceStatusRowDTO;
  onClose: () => void;
}) {
  const t = useTranslations('admin.m11.mapping');
  const tc = useTranslations('common');
  const qc = useQueryClient();
  const getError = useErrorMessage('operator');

  const [groupId, setGroupId] = useState('');
  const [reason, setReason] = useState('');
  const parsed = Number(groupId.trim());
  const groupValid = groupId.trim() !== '' && Number.isInteger(parsed) && parsed >= 1;

  function refresh() {
    qc.invalidateQueries({ queryKey: ['sealed-price-status'] });
    qc.invalidateQueries({ queryKey: ['sealed-sets'] });
  }

  // «Conectar y actualizar»: fija el grupo y, de una vez, dispara la ingesta acotada a ESE grupo
  // (§diseño §3/D-3). El precio real se lee al refrescar el estado por set.
  const connect = useMutation({
    mutationFn: async () => {
      const dto = await setSealedSetMainGroup(row.set.id, {
        tcgplayerGroupId: parsed,
        reason: reason.trim() || undefined,
      });
      await triggerSealedPriceIngest(dto.tcgplayerGroupId);
      return dto;
    },
    onSuccess: () => {
      refresh();
      onClose();
    },
  });

  const unlink = useMutation({
    mutationFn: (gid: number) => deleteSealedSetGroup(row.set.id, gid),
    onSuccess: () => {
      refresh();
      onClose();
    },
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={t('title', { set: row.set.name })}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button
            disabled={!groupValid || connect.isPending}
            loading={connect.isPending}
            onClick={() => connect.mutate()}
          >
            {t('setMainCta')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">{t('intro')}</p>
        <Input
          label={t('groupIdLabel')}
          hint={t('groupIdHint')}
          type="text"
          inputMode="numeric"
          value={groupId}
          onChange={(e) => setGroupId(e.target.value)}
        />
        <details className="text-xs">
          <summary className="cursor-pointer text-muted">{t('helpLabel')}</summary>
          <p className="mt-1 text-muted">{t('helpBody')}</p>
        </details>
        <Input
          label={t('reasonLabel')}
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <p className="text-xs text-muted">{t('note')}</p>

        {/* Desconectar el grupo actual — el set vuelve a «Sin conectar a la fuente» (honesto). */}
        {row.setMainGroupId != null && (
          <div className="flex flex-col gap-2 border-t border-border pt-4">
            <p className="text-xs text-muted">
              {t('currentGroup', { groupId: row.setMainGroupId })}
            </p>
            <Button
              variant="secondary"
              size="sm"
              loading={unlink.isPending}
              disabled={unlink.isPending}
              onClick={() => unlink.mutate(row.setMainGroupId!)}
            >
              {t('unlinkCta')}
            </Button>
          </div>
        )}

        {connect.isError && (
          <Banner variant="danger" role="alert" title={tc('errorTitle')}>
            {getError(connect.error)}
          </Banner>
        )}
        {unlink.isError && (
          <Banner variant="danger" role="alert" title={tc('errorTitle')}>
            {getError(unlink.error)}
          </Banner>
        )}
      </div>
    </Modal>
  );
}
