import { CatalogView } from '../catalog/CatalogView';

/**
 * Alias de ruta v1.1: la superficie de producto se llama "Compra". La ruta técnica
 * canónica sigue siendo `/catalog` (y el contrato mantiene `/catalog/cards`); este
 * alias evita romper enlaces que apunten a `/compra`.
 */
export default function CompraPage() {
  return <CatalogView />;
}
