import { SuperAdminOnly } from '@/components/domain/SuperAdminOnly';
import { BountiesView } from './BountiesView';

/**
 * M2 › Bounties (§28.1). **`super_admin` únicamente**: para `vault_operator` **no se renderiza**
 * —ni en solo lectura—, mismo criterio que el editor de curva. Un panel que concentra toda la
 * estrategia de compra premium en una pantalla es exactamente eso, y su única acción es una
 * escritura `super_admin`: un lector con menos rol tendría una pantalla donde cada botón contesta
 * `403`. El backend ya rechaza por rol (§M2-B.1); esto es la defensa de UI.
 */
export default function M2BountiesPage() {
  return (
    <SuperAdminOnly>
      <BountiesView />
    </SuperAdminOnly>
  );
}
