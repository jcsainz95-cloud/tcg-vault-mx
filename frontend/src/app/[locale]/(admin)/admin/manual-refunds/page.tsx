import { ManualRefundsView } from './ManualRefundsView';

/**
 * `/admin/manual-refunds` — la cubeta «Reembolsos manuales (SPEI)» (`DESIGN_SYSTEM §37.9`, contrato
 * `§M4-SHIP.15.13`). **Solo súper-admin**: la vista se gatea con `SuperAdminOnly`; el backend es la autoridad
 * (`403 MONEY_OUT_FORBIDDEN` para el operador, auditado).
 */
export default function ManualRefundsPage() {
  return <ManualRefundsView />;
}
