'use client';

import { useTranslations } from 'next-intl';
import { Lock } from 'lucide-react';
import { useRole } from '@/lib/role';
import { EmptyState } from '@/components/ui/EmptyState';

/**
 * Guarda de módulo solo-super-admin (M2/M6/M10). El backend ya rechaza por rol
 * (403 FORBIDDEN / MONEY_OUT_FORBIDDEN); esto es la defensa de UI para navegación
 * directa por URL cuando el rol activo es vault_operator (patrón useRole).
 */
export function SuperAdminOnly({ children }: { children: React.ReactNode }) {
  const t = useTranslations('admin');
  const { isSuperAdmin } = useRole();
  if (!isSuperAdmin) {
    return (
      <EmptyState
        icon={<Lock size={40} />}
        title={t('superAdminGateTitle')}
        body={t('superAdminGateBody')}
      />
    );
  }
  return <>{children}</>;
}
