import { SuperAdminOnly } from '@/components/domain/SuperAdminOnly';
import { M7View } from './M7View';

export default function M7Page() {
  return (
    <SuperAdminOnly>
      <M7View />
    </SuperAdminOnly>
  );
}
