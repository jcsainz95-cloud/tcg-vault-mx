import type { Metadata } from 'next';
import { SellRequestStepView } from './SellRequestStepView';
import { RouteMessages } from '@/components/i18n/RouteMessages';

/** Paso con CLABE/INE: fuera de buscadores (como el detalle de una solicitud). Fuera de la medición: `routes.ts`. */
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function SellRequestStepPage() {
  // §DYN.6.7 (c1): el ámbito `storefront` de esta página (`RouteMessages`; la raíz manda solo `SHELL`).
  return (
    <RouteMessages scope="storefront">
      <SellRequestStepView />
    </RouteMessages>
  );
}
