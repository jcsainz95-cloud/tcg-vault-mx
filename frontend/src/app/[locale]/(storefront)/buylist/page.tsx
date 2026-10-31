import { BuylistView } from './BuylistView';
import { RouteMessages } from '@/components/i18n/RouteMessages';

export default function BuylistPage() {
  // §DYN.6.7 (c1): el ámbito `storefront` de esta página (`RouteMessages`; la raíz manda solo `SHELL`).
  return (
    <RouteMessages scope="storefront">
      <BuylistView />
    </RouteMessages>
  );
}
