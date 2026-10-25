import { SuperAdminOnly } from '@/components/domain/SuperAdminOnly';
import { DiscountBatchForm } from '../../DiscountBatchForm';

/** `/admin/codes/batch/new` — «Generar lote» (§DSC-UX.5 D8). */
export default function NewDiscountBatchPage() {
  return (
    <SuperAdminOnly>
      <DiscountBatchForm />
    </SuperAdminOnly>
  );
}
