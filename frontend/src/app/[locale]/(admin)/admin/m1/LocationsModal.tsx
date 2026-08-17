'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Plus } from 'lucide-react';
import { createLocation } from '@/lib/api';
import type { VaultLocationDTO, VaultZone } from '@/types/contract';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { useErrorMessage } from '@/components/ui/QueryState';

const ZONES: VaultZone[] = ['platform_stock', 'customer_custody'];

export interface LocationsModalProps {
  open: boolean;
  onClose: () => void;
  locations: VaultLocationDTO[];
}

/**
 * Gestión mínima de ubicaciones de bóveda (contrato §M1 · GET/POST /admin/locations,
 * `{ zone, box, row, slot }`): lista las existentes y permite crear nuevas. Sin esto,
 * en una BD limpia el dropdown de ubicación del alta de items queda vacío.
 * Crear invalida ['locations'] para refrescar todos los dropdowns.
 */
export function LocationsModal({ open, onClose, locations }: LocationsModalProps) {
  const t = useTranslations('admin.m1.locations');
  const tz = useTranslations('admin.m1.zone');
  const tc = useTranslations('common');
  const qc = useQueryClient();
  const getError = useErrorMessage();

  const [zone, setZone] = useState<VaultZone>('platform_stock');
  const [box, setBox] = useState('');
  const [row, setRow] = useState('');
  const [slot, setSlot] = useState('');

  const create = useMutation({
    mutationFn: () =>
      createLocation({ zone, box: box.trim(), row: row.trim(), slot: slot.trim() }),
    onSuccess: () => {
      setBox('');
      setRow('');
      setSlot('');
      void qc.invalidateQueries({ queryKey: ['locations'] });
    },
  });

  const incomplete = box.trim() === '' || row.trim() === '' || slot.trim() === '';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('title')}
      footer={
        <Button variant="secondary" onClick={onClose}>
          {tc('close')}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">{t('subtitle')}</p>

        {create.isSuccess && create.data && (
          <Banner variant="success" role="status">
            {t('createSuccess', { label: create.data.label })}
          </Banner>
        )}

        {/* Alta: caja / fila / slot + zona (shape real del DTO del backend) */}
        <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
          <Select
            label={t('zone')}
            options={ZONES.map((z) => ({ value: z, label: tz(z) }))}
            value={zone}
            onChange={(e) => setZone(e.target.value as VaultZone)}
          />
          <div className="grid grid-cols-3 gap-2">
            <Input label={t('box')} value={box} onChange={(e) => setBox(e.target.value)} placeholder="C03" />
            <Input label={t('row')} value={row} onChange={(e) => setRow(e.target.value)} placeholder="F02" />
            <Input label={t('slot')} value={slot} onChange={(e) => setSlot(e.target.value)} placeholder="S15" />
          </div>
          {create.isError && (
            <Banner variant="danger" role="alert" title={t('createError')}>
              {getError(create.error)}
            </Banner>
          )}
          <div>
            <Button
              onClick={() => create.mutate()}
              disabled={incomplete || create.isPending}
              loading={create.isPending}
            >
              <Plus size={16} /> {t('create')}
            </Button>
          </div>
        </div>

        {/* Lista de ubicaciones existentes */}
        {locations.length === 0 ? (
          <p className="text-sm text-muted">{t('empty')}</p>
        ) : (
          <ul className="flex flex-col gap-1" aria-label={t('title')}>
            {locations.map((l) => (
              <li
                key={l.id}
                className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm"
              >
                <span className="tabular font-medium">{l.label}</span>
                <span className="text-xs text-muted">{tz(l.zone)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
