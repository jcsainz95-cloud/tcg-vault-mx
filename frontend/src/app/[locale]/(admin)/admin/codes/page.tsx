import { SuperAdminOnly } from '@/components/domain/SuperAdminOnly';
import { DiscountCodesView } from './DiscountCodesView';

/**
 * `/admin/codes` — «Códigos de descuento» (DESIGN_SYSTEM §DSC-UX.5; contrato §DSC.7). Solo `super_admin`: el operador
 * no ve la entrada del menú y por URL llega a la página de acceso denegado de siempre (el servidor responde `403`).
 * Ruta propuesta por ux-ui (§DSC-UX.7 petición 4); el contrato v1.110 no fija ruta de pantalla (solicitud al arquitecto).
 */
export default function DiscountCodesPage() {
  return (
    <SuperAdminOnly>
      <DiscountCodesView />
    </SuperAdminOnly>
  );
}
