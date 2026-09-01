/**
 * Mapa canónico de estados de dominio (DESIGN_SYSTEM §2.4).
 * enum del contrato → { token de color, forma del badge, clave i18n }.
 * El color NUNCA es el único portador de significado: siempre hay texto (i18n)
 * y, en críticos, un icono (ver StatusBadge).
 */
export type BadgeTone = 'success' | 'warning' | 'danger' | 'info' | 'accent' | 'primary' | 'neutral';
export type BadgeShape = 'soft' | 'outline';
export type StatusDomain =
  | 'ownership'
  | 'order'
  | 'shipment'
  | 'sellRequest'
  | 'sellItem'
  | 'price'
  | 'dispute'
  | 'kyc'
  | 'inventory';

export interface BadgeSpec {
  tone: BadgeTone;
  shape: BadgeShape;
  /** clave i18n bajo `status.<domain>.<value>` */
  i18nKey: string;
  /** icono semántico opcional (lucide name) para reforzar en críticos */
  icon?: 'lock' | 'unlock' | 'clock' | 'check' | 'alert' | 'info' | 'truck' | 'package';
}

const S = (
  domain: StatusDomain,
  value: string,
  tone: BadgeTone,
  shape: BadgeShape = 'soft',
  icon?: BadgeSpec['icon'],
): BadgeSpec => ({ tone, shape, i18nKey: `status.${domain}.${value}`, icon });

const MAP: Record<StatusDomain, Record<string, BadgeSpec>> = {
  ownership: {
    pending: S('ownership', 'pending', 'warning', 'soft', 'unlock'),
    settled: S('ownership', 'settled', 'success', 'soft', 'lock'),
  },
  order: {
    pending: S('order', 'pending', 'warning', 'soft', 'clock'),
    settled: S('order', 'settled', 'success', 'soft', 'check'),
    failed: S('order', 'failed', 'danger', 'soft', 'alert'),
    refunded: S('order', 'refunded', 'info', 'soft', 'info'),
    chargeback: S('order', 'chargeback', 'danger', 'outline', 'alert'),
  },
  shipment: {
    solicitado: S('shipment', 'solicitado', 'info', 'soft'),
    picking: S('shipment', 'picking', 'accent', 'soft', 'package'),
    guia: S('shipment', 'guia', 'info', 'soft'),
    enviado: S('shipment', 'enviado', 'primary', 'soft', 'truck'),
    entregado: S('shipment', 'entregado', 'success', 'soft', 'check'),
    cancelado: S('shipment', 'cancelado', 'neutral', 'soft'),
  },
  sellRequest: {
    cotizada: S('sellRequest', 'cotizada', 'neutral', 'soft'),
    // v1.51 / DESIGN_SYSTEM §23.1a-b: `ofertada` y `aceptada` comparten `accent` A PROPÓSITO y se
    // distinguen por la palabra. `aceptada` NO es verde: el verde del sistema significa «ya ocurrió
    // y no depende de nadie», y una aceptada es un sí con el reloj corriendo y sin una sola carta
    // en la casa — pintarla verde diría «esto ya está» sobre la fase de más riesgo del ciclo.
    ofertada: S('sellRequest', 'ofertada', 'accent', 'soft'),
    aceptada: S('sellRequest', 'aceptada', 'accent', 'soft'),
    // §23.1c: hereda el token de `Shipment.enviado` — es el MISMO hecho del mundo físico visto
    // desde el otro lado del mostrador; otro tono inventaría una segunda gramática para «va en camino».
    en_transito: S('sellRequest', 'en_transito', 'primary', 'soft', 'truck'),
    recibida: S('sellRequest', 'recibida', 'info', 'soft'),
    verificacion: S('sellRequest', 'verificacion', 'accent', 'soft'),
    aprobada: S('sellRequest', 'aprobada', 'success', 'outline', 'check'),
    pagada: S('sellRequest', 'pagada', 'success', 'soft', 'check'),
    rechazada: S('sellRequest', 'rechazada', 'danger', 'soft', 'alert'),
    abandonada: S('sellRequest', 'abandonada', 'neutral', 'soft'),
    // ⚠️ DESIGN_SYSTEM §23.1d — `expirada` NO tiene un color propio, tiene DOS, y se elige por
    // `expiredReason` (ver `getBadgeSpec`). Las tres filas de abajo son ese mapeo:
    //  · `expirada`                → FALLBACK legacy/motivo ausente: neutral, NUNCA acusatorio.
    //  · `expirada_no_offer`       → NO PROCEDIÓ. Nosotros no ofertamos; no hay incumplimiento
    //                                de nadie ⇒ neutral, y está PROHIBIDO pintarlo en `danger`.
    //  · `expirada_not_shipped`    → SIN ENVÍO. Aceptó y el paquete no salió ⇒ `danger`.
    // La dirección del fallback es deliberada (misma doctrina money-safe de §7.3, «— antes que $0»,
    // aplicada a la reputación): en un desenlace ambiguo el sistema NO acusa al cliente.
    // ⚠️ Sus rótulos NO viven en `status.sellRequest.*` sino en su propio espacio de claves
    // `status.sellRequestExpiry.{not_shipped,no_offer,unknown}` (DESIGN_SYSTEM §23.12): son
    // TRES, incluido el fallback, y ninguno se llama «expirada» porque al vendedor no se le
    // comunica un estado, se le comunica un DESENLACE.
    expirada: { tone: 'neutral', shape: 'soft', i18nKey: 'status.sellRequestExpiry.unknown' },
    expirada_no_offer: {
      tone: 'neutral',
      shape: 'soft',
      i18nKey: 'status.sellRequestExpiry.no_offer',
    },
    expirada_not_shipped: {
      tone: 'danger',
      shape: 'soft',
      icon: 'alert',
      i18nKey: 'status.sellRequestExpiry.not_shipped',
    },
  },
  sellItem: {
    cotizada: S('sellItem', 'cotizada', 'neutral', 'soft'),
    precio_pendiente: S('sellItem', 'precio_pendiente', 'warning', 'outline', 'clock'),
    recibida: S('sellItem', 'recibida', 'info', 'soft'),
    verificacion: S('sellItem', 'verificacion', 'accent', 'soft'),
    aprobada: S('sellItem', 'aprobada', 'success', 'outline', 'check'),
    ajustada: S('sellItem', 'ajustada', 'warning', 'soft'),
    rechazada: S('sellItem', 'rechazada', 'danger', 'soft', 'alert'),
    pagada: S('sellItem', 'pagada', 'success', 'soft', 'check'),
    convertida_inventario: S('sellItem', 'convertida_inventario', 'primary', 'soft'),
  },
  price: {
    pending: S('price', 'pending', 'warning', 'outline', 'clock'),
    priced: S('price', 'priced', 'success', 'soft'),
  },
  dispute: {
    abierta: S('dispute', 'abierta', 'warning', 'soft', 'alert'),
    en_revision: S('dispute', 'en_revision', 'accent', 'soft'),
    resuelta_recompra: S('dispute', 'resuelta_recompra', 'success', 'soft', 'check'),
    rechazada: S('dispute', 'rechazada', 'neutral', 'soft'),
  },
  kyc: {
    none: S('kyc', 'none', 'warning', 'soft', 'clock'),
    pending: S('kyc', 'pending', 'warning', 'soft', 'clock'),
    verified: S('kyc', 'verified', 'success', 'soft', 'check'),
    rejected: S('kyc', 'rejected', 'danger', 'soft', 'alert'),
  },
  inventory: {
    in_stock: S('inventory', 'in_stock', 'neutral', 'soft'),
    listed: S('inventory', 'listed', 'info', 'soft'),
    reserved: S('inventory', 'reserved', 'warning', 'soft'),
    in_custody: S('inventory', 'in_custody', 'primary', 'soft', 'lock'),
    picking: S('inventory', 'picking', 'accent', 'soft', 'package'),
    shipped: S('inventory', 'shipped', 'primary', 'soft', 'truck'),
    delivered: S('inventory', 'delivered', 'success', 'soft', 'check'),
    lost: S('inventory', 'lost', 'danger', 'soft', 'alert'),
    damaged: S('inventory', 'damaged', 'danger', 'soft', 'alert'),
    withdrawn: S('inventory', 'withdrawn', 'neutral', 'soft'),
  },
};

/**
 * Resuelve el badge de un valor de enum de dominio.
 *
 * `reason` es el **segundo campo** que refina el mapeo (DESIGN_SYSTEM §23.1d): hoy su único
 * uso es `sellRequest`/`expirada`, el ÚNICO valor del sistema cuyo color y cuya versalita NO
 * los decide el `status` sino `expiredReason`, porque sus dos causas significan cosas opuestas
 * para el vendedor (*«no enviaste»* vs *«no ofertamos»*). *«Un mapa que resuelva solo por
 * `status` es un defecto, no una simplificación»* (§23.1d).
 *
 * Se busca primero la fila refinada `<value>_<reason>`; si no existe (motivo `null`, ausente o
 * desconocido) cae a la fila del valor a secas, que para `expirada` es el **fallback neutro**.
 * El fallback nunca es la versión acusatoria: es la dirección exigida por §23.1d.
 */
export function getBadgeSpec(
  domain: StatusDomain,
  value: string,
  reason?: string | null,
): BadgeSpec {
  const table = MAP[domain];
  if (reason) {
    const refined = table?.[`${value}_${reason}`];
    if (refined) return refined;
  }
  return table?.[value] ?? S(domain, value, 'neutral', 'soft');
}
