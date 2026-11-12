import { SuppliersAdminView } from './SuppliersAdminView';

/**
 * `/admin/proveedores` — Compra a tiendas aliadas (§PROV F1). Lectura: staff; escribir (invitar, solicitudes,
 * aceptar, pagar): super_admin (el backend manda: 403). Recoger y verificar: staff.
 */
export default function SuppliersAdminPage() {
  return <SuppliersAdminView />;
}
