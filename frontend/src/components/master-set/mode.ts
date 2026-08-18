/**
 * v1.20-master-set-everywhere (ARCHITECTURE §4.20f): el binder Master Set es un componente
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
 *  - `quoter`           → cotizador (Vender, storefront/buylist): SOLO lectura del CATÁLOGO
 *                        (no de inventario/bóveda) compuesta 100% client-side con los mismos
 *                        endpoints públicos del cotizador (`listBuylistSets` / `searchBuylistCards`
 *                        / `batchQuote` — SIN endpoint nuevo, SIN cambio de contrato). Cada
 *                        variante trae su cotización (`variants[].quote`, campo aditivo SOLO
 *                        de este modo); clic en una casilla agrega esa combinación (carta,
 *                        acabado) al carrito de VENTA. Sin captura/publicación/ajuste/compra.
 */
export type MasterSetViewMode = 'platform' | 'user_vault_admin' | 'user_vault_self' | 'quoter';
