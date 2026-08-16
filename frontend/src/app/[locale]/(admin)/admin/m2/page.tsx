import { SuperAdminOnly } from '@/components/domain/SuperAdminOnly';
import { M2View } from './M2View';

export default function M2Page() {
  return (
    <SuperAdminOnly>
      <M2View />
    </SuperAdminOnly>
  );
}
