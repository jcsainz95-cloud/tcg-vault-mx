import { ManualRefundDetailView } from './ManualRefundDetailView';

/** `/admin/manual-refunds/[id]` — revelar, pagar, cancelar, re-emitir (`DESIGN_SYSTEM §37.9b`). Solo súper-admin. */
export default async function ManualRefundPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ManualRefundDetailView id={id} />;
}
