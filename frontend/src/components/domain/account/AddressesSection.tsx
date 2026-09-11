'use client';

import { useTranslations } from 'next-intl';
import { AddressManager } from '@/components/domain/AddressManager';
import type { UserDTO } from '@/types/contract';
import { SectionShell } from './SectionShell';

/**
 * c · Direcciones de envío (`#addresses`, DESIGN_SYSTEM §33.6c): `AddressManager` como libreta
 * simple (sin `selectable`), con destinatario (`recipientName`), «Editar» y la marca «Falta el
 * nombre de quien recibe» en filas anteriores a M-52. El prellenado del destinatario con
 * `user.name` SOLO si `nameSource !== 'derived'` (contrato v1.67).
 */
export function AddressesSection({ user }: { user: UserDTO }) {
  const t = useTranslations('account.addresses');
  return (
    <SectionShell id="addresses" title={t('title')}>
      <AddressManager
        hideTitle
        defaultRecipientName={user.nameSource !== 'derived' ? user.name : undefined}
      />
    </SectionShell>
  );
}
