import { parseBuyListUrl } from '../../m9/buyListParams';
import { parsePeriod } from '@/lib/reports/period';
import { StockView } from '../StockView';

/** `/admin/reportes/inventario` — Reportes › Inventario (§REPORTES-CEO F1). Todo el personal en unidades; dinero y «Qué reponer» solo súper-admin. */
export default async function StockPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = (await searchParams) ?? {};
  return <StockView initialBuyList={parseBuyListUrl(sp)} initialPeriod={parsePeriod(sp)} />;
}
