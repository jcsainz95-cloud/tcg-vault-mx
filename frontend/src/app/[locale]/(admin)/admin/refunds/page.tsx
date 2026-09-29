import { OperatorRefundsView } from './OperatorRefundsView';

/**
 * `/admin/refunds` — «Reembolsos de operadores» (`DESIGN_SYSTEM §37.11b`, contrato `§M4-SHIP.17.5`, D-13 «Solo
 * verlo en el panel»): resumen por operador + el libro filtrable. Solo súper-admin.
 */
export default function OperatorRefundsPage() {
  return <OperatorRefundsView />;
}
