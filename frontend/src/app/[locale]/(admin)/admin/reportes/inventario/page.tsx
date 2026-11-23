import { parseBuyListUrl } from '../../m9/buyListParams';
import { StockView } from '../StockView';

/** `/admin/reportes/inventario` — Reportes › Inventario (§REPORTES-CEO F1). Todo el personal en unidades; dinero y «Qué reponer» solo súper-admin. */
export default async function StockPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <StockView initialBuyList={parseBuyListUrl((await searchParams) ?? {})} />;
}
