import { AccountView } from '@/components/domain/account/AccountView';

/** «Mi cuenta» del cliente (contrato v1.67 · DESIGN_SYSTEM §33.5). Privada: `PrivateRouteGuard`. */
export default function AccountPage() {
  return <AccountView surface="storefront" />;
}
