import { Suspense } from 'react';
import { AccessoriesAdminView } from './AccessoriesAdminView';

/**
 * Panel «Accesorios» (`API_CONTRACT §AC.11`, `DESIGN_SYSTEM §AC-UX.9`). Ruta `vault_operator+` (como Sellado): lo ★
 * (precio, costo, «Sugerido», publicar, borrar, diales) se gatea DENTRO de la vista; el backend es la autoridad.
 */
export default function AccessoriesAdminPage() {
  return (
    <Suspense>
      <AccessoriesAdminView />
    </Suspense>
  );
}
