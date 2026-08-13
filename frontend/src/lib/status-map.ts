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
    recibida: S('sellRequest', 'recibida', 'info', 'soft'),
    verificacion: S('sellRequest', 'verificacion', 'accent', 'soft'),
    aprobada: S('sellRequest', 'aprobada', 'success', 'outline', 'check'),
    pagada: S('sellRequest', 'pagada', 'success', 'soft', 'check'),
    rechazada: S('sellRequest', 'rechazada', 'danger', 'soft', 'alert'),
    abandonada: S('sellRequest', 'abandonada', 'neutral', 'soft'),
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

export function getBadgeSpec(domain: StatusDomain, value: string): BadgeSpec {
  return MAP[domain]?.[value] ?? S(domain, value, 'neutral', 'soft');
}
