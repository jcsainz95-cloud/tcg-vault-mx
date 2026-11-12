'use client';

import { useTranslations } from 'next-intl';
import { Banner } from '@/components/ui/Banner';
import { QueryState, type QueryStateProps } from '@/components/ui/QueryState';
import { asApiError } from '@/lib/api-client';

/**
 * `QueryState` del portal: una cuenta suspendida (403 `SUPPLIER_SUSPENDED`) o un rol sin acceso se dicen con texto
 * claro del portal (`supplier.errors`), no con el aviso genérico de reintento.
 */
export function SupplierQueryState(props: QueryStateProps) {
  const te = useTranslations('supplier.errors');
  const code = props.isError ? asApiError(props.error)?.code : undefined;
  if (code === 'SUPPLIER_SUSPENDED' || code === 'FORBIDDEN_ROLE') {
    return (
      <Banner variant="danger" role="alert">
        {te(code)}
      </Banner>
    );
  }
  return <QueryState {...props} />;
}
