/**
 * Constantes del precio final a mano del sellado (`DESIGN_SYSTEM §39.2`, criterio 255), fuera del componente para que
 * tengan UN dueño (techlead s5 D-8, 2026-10-04).
 */

/**
 * Cota de `UpdateItemDto.listPriceCents` (`@Max(MAX_LIST_PRICE_CENTS)`, `backend/src/modules/inventory/dto/inventory.dto.ts:57`,
 * citada en `DESIGN_SYSTEM §39`) ⇒ MX$1,000,000.00. La pantalla no deja escribir lo que el servidor rechazaría con
 * `422 VALIDATION_ERROR`. ⚠️ El contrato aún no la declara (solicitud al arquitecto en `FRONTEND_NOTES`); mientras
 * tanto `sealed-final-price.test.ts` la ata a la cifra que cita el sistema de diseño.
 */
export const MAX_LIST_PRICE_CENTS = 100_000_000;

/**
 * Las consultas que pintan el precio de una pieza sellada (cola «Listas para publicar», cajón de variante, pestaña
 * «Sellado» de M1 y estado de precios de M11). UNA lista para los dos momentos que la usan: tras guardar y al pulsar
 * «Recargar» tras un `409/422`. Antes eran dos listas y «Recargar» no refrescaba el panel de «Sellado» — justo el
 * sitio donde el editor vive con `layout='panel'`.
 */
export const SEALED_FINAL_PRICE_INVALIDATES = [
  'pending-publish',
  'admin-inventory',
  'variant-pieces',
  'sealed-sets',
  'sealed-set-detail',
  'sealed-price-status',
  // §M11-SP (SP-F-7): la hoja «Precios del sellado» pinta el mismo precio por producto.
  'sealed-price-sheet',
] as const;

/**
 * 💰 **Margen en vivo del editor del precio del producto** (`API_CONTRACT §M11-SP.12.5`, `DESIGN_SYSTEM §70.2 (d)`,
 * candado UX-SP-8). Es la **única** cuenta de dinero que hace el cliente (ux-ui N-4): informativa, con la aritmética
 * entera **del contrato** —la misma que `taxBaseCentsOf` del servidor—:
 * `N = round(P·100/(100+r))`, `cents = N − avg`, `bps = round(cents·10000/N)`.
 *
 * - `displayCents` = `P` tecleado por el dueño (con IVA). ⛔ No se envía nada calculado aquí: lo que viaja en el `PUT`
 *   es `P` tal cual (F-SP-7).
 * - `ivaRatePct` = `iva.ratePct` de `SealedPriceSheetResponse` (la tasa `r` del servidor). ⛔ Sin `r` no hay margen: ni
 *   un 16 supuesto (panel y cola no traen `r` ⇒ no pintan la línea).
 * - Sin costo promedio ⇒ `null`. `0` es un costo válido.
 *
 * Excepción argumentada y acotada del censo `frontend-never-multiplies.test.ts` (el contrato la manda).
 */
export function marginPreview(
  displayCents: number,
  avgCostCents: number | null | undefined,
  ivaRatePct: number | null | undefined,
): { netCents: number; cents: number; bps: number } | null {
  if (avgCostCents == null || ivaRatePct == null) return null;
  if (!Number.isSafeInteger(displayCents) || displayCents <= 0) return null;
  const netCents = Math.round((displayCents * 100) / (100 + ivaRatePct));
  if (netCents <= 0) return null;
  const cents = netCents - avgCostCents;
  return { netCents, cents, bps: Math.round((cents * 10000) / netCents) };
}

const PCT_LOCALE = { es: 'es-MX', en: 'en-US' } as const;

/**
 * Margen en puntos base ⇒ porcentaje del idioma con un decimal (`DESIGN_SYSTEM §70.2 (b)`: `bps/10000`, `percent`). El
 * negativo lleva el menos tipográfico (U+2212), como `formatSignedMoneyCents`: el signo es el canal (§10).
 */
export function formatBpsPct(bps: number, locale: 'es' | 'en'): string {
  const abs = new Intl.NumberFormat(PCT_LOCALE[locale], {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(Math.abs(bps) / 10000);
  return bps < 0 ? `−${abs}` : abs;
}

/** Puntos de markup de la presentación (`appliedSpreadPct`, §M11-SP.12.8) ⇒ porcentaje del idioma, sin redondear. */
export function formatSpreadPct(pct: number, locale: 'es' | 'en'): string {
  return new Intl.NumberFormat(PCT_LOCALE[locale], { style: 'percent', maximumFractionDigits: 2 }).format(pct / 100);
}
