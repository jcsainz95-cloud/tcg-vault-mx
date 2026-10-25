import { SuperAdminOnly } from '@/components/domain/SuperAdminOnly';
import { DiscountReportView } from '../../../DiscountReportView';

/** `/admin/codes/batch/[id]/report` — reporte de un lote (§DSC-UX.5 D9: «Códigos usados: n de N»). */
export default async function DiscountBatchReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <SuperAdminOnly>
      <DiscountReportView kind="batch" id={id} />
    </SuperAdminOnly>
  );
}
