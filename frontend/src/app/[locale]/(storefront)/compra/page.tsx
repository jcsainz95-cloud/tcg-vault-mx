import { Suspense } from 'react';
import { CatalogView } from '../catalog/CatalogView';
import { RouteMessages } from '@/components/i18n/RouteMessages';

/**
 * C4 (BRIEF_MKT Ola 2): el alias lleva la metadata de `/catalog` (mismo título y canonical `/{locale}/catalog`), para
 * no competir con la ruta canónica. El contenido en el HTML del servidor (C2) solo lo lleva la canónica.
 */
export { generateMetadata } from '../catalog/page';

/**
 * Alias de ruta v1.1: la superficie de producto se llama "Compra". La ruta técnica
 * canónica sigue siendo `/catalog` (y el contrato mantiene `/catalog/cards`); este
 * alias evita romper enlaces que apunten a `/compra`.
 */
export default function CompraPage() {
  // useSearchParams (pestaña Gradeadas, ?productType=graded) requiere Suspense en Next 15.
  // §DYN.6.7 (c1): el ámbito `storefront` de esta página (`RouteMessages`; la raíz manda solo `SHELL`).
  return (
    <RouteMessages scope="storefront">
      <Suspense>
        <CatalogView />
      </Suspense>
    </RouteMessages>
  );
}
