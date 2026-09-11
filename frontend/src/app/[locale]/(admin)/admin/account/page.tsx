import { AccountView } from '@/components/domain/account/AccountView';

/** «Mi cuenta» del staff, bajo `AdminShell` (contrato v1.67 · DESIGN_SYSTEM §33.5). */
export default function AdminAccountPage() {
  return <AccountView surface="admin" />;
}
