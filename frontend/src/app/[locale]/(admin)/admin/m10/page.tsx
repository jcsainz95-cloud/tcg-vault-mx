import { SuperAdminOnly } from '@/components/domain/SuperAdminOnly';
import { M10View } from './M10View';

export default function M10Page() {
  return (
    <SuperAdminOnly>
      <M10View />
    </SuperAdminOnly>
  );
}
