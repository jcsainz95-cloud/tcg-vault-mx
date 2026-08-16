import { SuperAdminOnly } from '@/components/domain/SuperAdminOnly';
import { M6View } from './M6View';

export default function M6Page() {
  return (
    <SuperAdminOnly>
      <M6View />
    </SuperAdminOnly>
  );
}
