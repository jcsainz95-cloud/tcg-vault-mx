import { SpendAlertsView } from './SpendAlertsView';
import { parseSpendAlertFilters } from './filters';

/**
 * `/admin/spend-alerts` — «Avisos de gasto» (`DESIGN_SYSTEM §43.19.8`, contrato `§M4-SHIP.19.29.9`). Solo súper-admin
 * (el servidor lo impone con `@MoneyOut()`). Los filtros viven en la URL; la página de servidor los lee y la vista
 * arranca con ellos (al volver del detalle se re-pinta igual).
 */
export default async function SpendAlertsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  return <SpendAlertsView initial={parseSpendAlertFilters(sp)} />;
}
