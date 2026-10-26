import { SuperAdminOnly } from '@/components/domain/SuperAdminOnly';
import { DiscountCodeForm } from '../DiscountCodeForm';

/** `/admin/codes/[id]` — editar un código (§DSC-UX.5 D7: tras el primer uso, solo fin de vigencia y usos totales). */
export default async function EditDiscountCodePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <SuperAdminOnly>
      <DiscountCodeForm id={id} />
    </SuperAdminOnly>
  );
}
