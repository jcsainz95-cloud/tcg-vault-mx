import { SuperAdminOnly } from '@/components/domain/SuperAdminOnly';
import { DiscountCodeForm } from '../DiscountCodeForm';

/** `/admin/codes/new` — «Nuevo código» (§DSC-UX.5 D3-D5). */
export default function NewDiscountCodePage() {
  return (
    <SuperAdminOnly>
      <DiscountCodeForm />
    </SuperAdminOnly>
  );
}
