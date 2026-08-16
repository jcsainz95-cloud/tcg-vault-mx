import { SuperAdminOnly } from '@/components/domain/SuperAdminOnly';
import { M9View } from './M9View';

export default function M9Page() {
  return (
    <SuperAdminOnly>
      <M9View />
    </SuperAdminOnly>
  );
}
