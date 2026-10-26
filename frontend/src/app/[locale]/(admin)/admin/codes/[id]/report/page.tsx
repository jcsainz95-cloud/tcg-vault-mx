import { SuperAdminOnly } from '@/components/domain/SuperAdminOnly';
import { DiscountReportView } from '../../DiscountReportView';

/** `/admin/codes/[id]/report` — reporte de un código (§DSC-UX.5 D9). */
export default async function DiscountCodeReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <SuperAdminOnly>
      <DiscountReportView kind="code" id={id} />
    </SuperAdminOnly>
  );
}
