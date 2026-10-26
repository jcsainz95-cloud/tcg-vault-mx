import { SuperAdminOnly } from '@/components/domain/SuperAdminOnly';
import { DiscountCodesView } from './DiscountCodesView';

/**
 * `/admin/codes` — «Códigos de descuento» (DESIGN_SYSTEM §DSC-UX.5; contrato §DSC.7). Solo `super_admin`: el operador
 * no ve la entrada del menú y por URL llega a la página de acceso denegado de siempre (el servidor responde `403`).
 * Ruta ratificada por el contrato (§DSC.7, v1.110.1: «Pantalla: `/admin/codes`»).
 */
export default function DiscountCodesPage() {
  return (
    <SuperAdminOnly>
      <DiscountCodesView />
    </SuperAdminOnly>
  );
}
