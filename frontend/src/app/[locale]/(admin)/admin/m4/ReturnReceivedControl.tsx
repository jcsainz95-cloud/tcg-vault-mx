'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { ApiClientError } from '@/lib/api-client';
import { markShipmentReturnReceived } from '@/lib/api/shipments-return-received';
import { useErrorMessage } from '@/components/ui/QueryState';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';

/** §RETIRO-SALIDA.3 — botón + confirmación de «Recibimos la devolución». Autocontenido (ver `shipments-return-received.ts`). */
export function ReturnReceivedControl({
  id,
  refLabel,
  onDone,
  onFail,
}: {
  id: string;
  refLabel: string;
  onDone: (id: string) => void;
  onFail: (id: string, text: string) => void;
}) {
  const t = useTranslations('admin.m4.statusActions.returnReceived');
  const tc = useTranslations('common');
  const getError = useErrorMessage('operator');
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const mutation = useMutation({
    mutationFn: () => markShipmentReturnReceived(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-shipments'] });
      setOpen(false);
      onDone(id);
    },
    onError: (e) => {
      setOpen(false);
      const code = e instanceof ApiClientError && e.status === 409 ? e.code : null;
      onFail(
        id,
        code === 'RETURN_NOT_APPLICABLE' ? t('errNotApplicable') : code === 'RETURN_NOTHING_TO_RESTORE' ? t('errNothingToRestore') : code ? t('errConflict') : getError(e),
      );
      void qc.invalidateQueries({ queryKey: ['admin-shipments'] });
    },
  });
  const close = () => {
    if (!mutation.isPending) setOpen(false);
  };

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        {t('button')}
      </Button>
      <Modal
        open={open}
        onClose={close}
        title={t('title', { ref: refLabel })}
        footer={
          <>
            <Button variant="secondary" disabled={mutation.isPending} onClick={close}>
              {tc('cancel')}
            </Button>
            <Button loading={mutation.isPending} onClick={() => mutation.mutate()}>
              {t('confirm')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-text">{t('body')}</p>
      </Modal>
    </>
  );
}
