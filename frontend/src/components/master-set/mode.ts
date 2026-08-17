/**
 * v1.18-master-set-everywhere (ARCHITECTURE §4.18f): el binder Master Set es un componente
 * COMPARTIDO parametrizado por scope/capacidades. El modo decide QUÉ endpoints se consumen
 * y QUÉ acciones se montan; el componente NO decide permisos — renderiza lo que el DTO trae
 * (el backend ya omitió campos por scope: defensa en el dato, no en el if del front).
 *
 *  - `platform`        → M1 (contrato §M1): captura por lote, publicación y ajuste por
 *                        levantamiento físico. Endpoints /admin/inventory/master-sets[...].
 *  - `user_vault_admin`→ vista (ii): la bóveda de UN cliente vista por admin. SOLO lectura
 *                        (sin captura/publicación/ajuste/venta). /admin/vaults/:userId/master-sets[...].
 *  - `user_vault_self` → vista (iii): "Mi bóveda" del cliente. SOLO lectura + CTA de COMPRA
 *                        en variantes faltantes (`buyable`); sin acciones de venta ni datos
 *                        internos. /vault/master-sets[...].
 */
export type MasterSetViewMode = 'platform' | 'user_vault_admin' | 'user_vault_self';
