'use client';

import { useTranslations } from 'next-intl';
import { AddressManager, accountAddressDefaults } from '@/components/domain/AddressManager';
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
      {/* Paquete A (2026-11-02): nombre (regla `nameSource`) y teléfono de la cuenta, editables. */}
      <AddressManager hideTitle {...accountAddressDefaults(user)} />
    </SectionShell>
  );
}
