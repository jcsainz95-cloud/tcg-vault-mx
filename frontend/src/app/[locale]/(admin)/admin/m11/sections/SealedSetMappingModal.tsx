'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { setSealedSetMainGroup, deleteSealedSetGroup } from '@/lib/api';
import type { SealedPriceStatusRowDTO } from '@/types/contract';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Banner } from '@/components/ui/Banner';
import { useErrorMessage } from '@/components/ui/QueryState';

/**
 * §diseño §11 — mapeo manual set → grupo TCGCSV (`super_admin`), escape de P-46. Permite:
 *  - **Fijar/corregir** el grupo `set_main` (`PUT .../sealed-sets/:setId/set-main-group`), que
 *    REESCRIBE `CardSet.tcgcsvGroupId` aunque ya haya uno (lo que `linkGroup` no puede).
 *  - **Desenlazar** un grupo mal asignado (`DELETE .../sealed-sets/:setId/groups/:groupId`), que
 *    deja el set en «SIN emparejar» (honesto).
 *
 * NO fabrica precio (I-2): solo dice de qué grupo saldrá; el precio lo trae el job §9, gateado por
 * el dial. Todo cambio queda en `AuditLog` con `before/after` (lo escribe el backend).
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

  const setMain = useMutation({
    mutationFn: () =>
      setSealedSetMainGroup(row.set.id, {
        tcgplayerGroupId: parsed,
        reason: reason.trim() || undefined,
      }),
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
      title={t('title')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button
            disabled={!groupValid || setMain.isPending}
            loading={setMain.isPending}
            onClick={() => setMain.mutate()}
          >
            {t('setMainCta')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">
          {t('setName', { name: row.set.name })}
        </p>
        <Input
          label={t('groupIdLabel')}
          hint={t('groupIdHint')}
          type="text"
          inputMode="numeric"
          value={groupId}
          onChange={(e) => setGroupId(e.target.value)}
        />
        <Input
          label={t('reasonLabel')}
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <p className="text-xs text-muted">{t('note')}</p>

        {/* Desenlazar el `set_main` actual — vuelve a «SIN emparejar» (honesto). */}
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

        {setMain.isError && (
          <Banner variant="danger" role="alert" title={tc('errorTitle')}>
            {getError(setMain.error)}
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
