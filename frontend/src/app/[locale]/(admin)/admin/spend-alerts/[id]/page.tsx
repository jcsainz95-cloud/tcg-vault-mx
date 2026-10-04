import { SpendAlertDetailView } from './SpendAlertDetailView';

/** `/admin/spend-alerts/[id]` — el detalle de un aviso de gasto (a donde lleva el correo, §19.29.5 / SDX-I-8). */
export default async function SpendAlertPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SpendAlertDetailView id={id} />;
}
