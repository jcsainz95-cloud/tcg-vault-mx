/**
 * label-inbound.ts — 💰 rev BSD-1, paso B-2 (API_CONTRACT §BSD.3, §BSD.4.1, §BSD.4.4; errata BSD-1.1 C-1/C-6): las piezas de
 * la guía de ENTRADA que dependen de la SOLICITUD (dirección, dinero, empaque, guarda). Todo PURO: el motor
 * (`label-quote`, `label-purchase`, `label-cancel`, `shipment-address`, `carrier-status`) las llama cuando
 * `labelSubjectOf(row).sellRequestId ≠ null`; ⛔ aquí no se compara `kind` (eso vive en `label-subject.ts`, BSD-B25 (a)).
 *
 * | Sitio de §BSD.3 | Pieza |
 * |---|---|
 * | Estado «abierta sin guía» (guarda de la solicitud en la misma tx) | `inboundGuideBlock` / `INBOUND_SELL_REQUEST_GUARD_SELECT` |
 * | Dirección del cotizador | `inboundQuoteAddresses` (`from` = vendedor neutralizado; `to` = `skydropx_origin_snapshot`) |
 * | Dirección de la compra | `inboundPurchaseAddresses` (`from` = vendedor explícito con el correo de la TIENDA; `to` = tienda con el folio) |
 * | Lo cobrado | `inboundChargedOf` (`offerShippingFeeCents`, bruto = neto) |
 * | Valor a asegurar | `inboundInsuredValueCents` (`offerGrossCents`) |
 * | Empaque por regla | `inboundPackageLines` (`offerDecision='buy'`; `sealed`/`graded` cuentan como sellado) |
 * | Copia del domicilio al abrir la fila (§BSD.4.1 paso 3) | `inboundAddressSnapshotOf` |
 * | Etiqueta descargable por el vendedor (C-1) | `labelPdfAvailableOf` |
 *
 * ⚠️ NO MEDIDO (§BSD.13 NM-1/NM-2): que Skydropx acepte `address_from` explícito al cotizar y al comprar. ⛔ No se mide contra
 * producción; la forma del cuerpo es la de `buildQuotationBody`/`buildPurchaseBody` y el doble la registra.
 */
import { BusinessException } from '../../common/business.exception';
import { referenceTextOf } from '../shipping-provider/folio-token';
import { PurchaseInput, QuoteInput } from '../shipping-provider/shipping-provider.port';
import { ShippingProviderError } from '../shipping-provider/shipping-provider.errors';
import { neutralizeOutboundAddress } from './folio-neutralize';
import { labelSourceOf } from './label-source';
import type { ChargedShipping, PickedLine } from './label-quote.service';

/** Lo que la guarda «abierta sin guía» lee de la solicitud (bajo su candado, en la tx del motor). */
export const INBOUND_SELL_REQUEST_GUARD_SELECT = {
  id: true,
  status: true,
  closedAt: true,
  shipmentTrackingNumber: true,
  sellerShippedDeclaredAt: true,
  shipmentConfirmedAt: true,
} as const;

export interface InboundGuardSellRequest {
  readonly status: string;
  readonly closedAt: Date | null;
  readonly shipmentTrackingNumber: string | null;
  readonly sellerShippedDeclaredAt: Date | null;
  readonly shipmentConfirmedAt: Date | null;
}

export type InboundBlockReason = 'status' | 'closed' | 'seller_declared_shipped' | 'shipment_confirmed';

/**
 * §BSD.3 fila «Estado abierta sin guía» — la guarda de la SOLICITUD: `status='aceptada'` ∧ `closedAt IS NULL` ∧
 * `sellerShippedDeclaredAt IS NULL` ∧ `shipmentConfirmedAt IS NULL` (el número manual va aparte: `SHIPMENT_ALREADY_LABELED`).
 * Devuelve el motivo del primer fallo (orden de §BSD.4.1 paso 2) o `null`.
 */
export function inboundGuideBlock(sr: InboundGuardSellRequest): InboundBlockReason | null {
  if (sr.status !== 'aceptada') return 'status';
  if (sr.closedAt !== null) return 'closed';
  if (sr.sellerShippedDeclaredAt !== null) return 'seller_declared_shipped';
  if (sr.shipmentConfirmedAt !== null) return 'shipment_confirmed';
  return null;
}

/** `409 GUIDE_NOT_ALLOWED {status, reason}` (código existente, §BSD.10). */
export function guideNotAllowed(status: string, reason: InboundBlockReason): BusinessException {
  return BusinessException.conflict('GUIDE_NOT_ALLOWED', 'A guide can only be bought for an accepted sell request', { status, reason });
}

/** `409 SHIPMENT_ALREADY_LABELED {labelSource:'manual'}` — la solicitud ya tiene una guía capturada a mano. */
export function manualGuideTaken(): BusinessException {
  return BusinessException.conflict('SHIPMENT_ALREADY_LABELED', 'The sell request already has a hand-captured label', { labelSource: 'manual' });
}

/**
 * La guarda completa de la solicitud, en el orden de §BSD.4.1: estado/cierre/«ya lo mandé»/confirmado ⇒ `GUIDE_NOT_ALLOWED`;
 * número en la solicitud ⇒ guía manual (con la fila de entrada SIN guía de Skydropx: si la tuviera, la guarda de la fila
 * —`labelSourceOf`— contesta antes con `skydropx`). Lanza; no devuelve nada.
 */
export function assertInboundSellRequestOpen(sr: InboundGuardSellRequest): void {
  const block = inboundGuideBlock(sr);
  if (block) throw guideNotAllowed(sr.status, block);
  if (sr.shipmentTrackingNumber !== null) throw manualGuideTaken();
}

/** El `skydropx_origin_snapshot` (la TIENDA), con las claves de §19.2. */
export type OriginSnapshotDial = Partial<Record<'name' | 'company' | 'street1' | 'postalCode' | 'areaLevel1' | 'areaLevel2' | 'areaLevel3' | 'phone' | 'email' | 'reference', string | null>> | null;

/** La tienda como DESTINO: las claves que hacen falta para cotizar y comprar. ⛔ Ninguna viene del cuerpo (I-BSD-5). */
export interface StoreDestination {
  name: string;
  company: string;
  street1: string;
  postalCode: string;
  state: string;
  city: string;
  neighborhood: string;
  phone: string;
  email: string;
  reference: string;
}

const STORE_REQUIRED = ['name', 'street1', 'postalCode', 'areaLevel1', 'areaLevel2', 'areaLevel3', 'phone', 'email'] as const;

/**
 * El destino de la guía de entrada = `skydropx_origin_snapshot` (I-BSD-5). Incompleto ⇒ `409 SHIPPING_PROVIDER_NOT_CONFIGURED
 * {missing:['origin_snapshot']}` (§BSD.3 fila «Dirección del cotizador»). Antes de cualquier red.
 */
export function storeDestinationOf(origin: OriginSnapshotDial): StoreDestination {
  const o = origin ?? {};
  const v = (k: keyof NonNullable<OriginSnapshotDial>) => (typeof o[k] === 'string' ? (o[k] as string).trim() : '');
  if (STORE_REQUIRED.some((k) => v(k) === '')) throw ShippingProviderError.notConfigured(['origin_snapshot']).toBusinessException();
  return {
    name: v('name'),
    company: v('company') || v('name'),
    street1: v('street1'),
    postalCode: v('postalCode'),
    state: v('areaLevel1'),
    city: v('areaLevel2'),
    neighborhood: v('areaLevel3'),
    phone: v('phone'),
    email: v('email'),
    reference: v('reference'),
  };
}

function obj(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/**
 * §BSD.3 «Dirección del cotizador» — `from` = el VENDEDOR (la copia de la fila de entrada), neutralizado como cualquier
 * texto de cliente (C-23); `to` = la tienda (`postalCode`, `areaLevel1` = estado, `areaLevel2` = ciudad, `areaLevel3` =
 * colonia).
 */
export function inboundQuoteAddresses(sellerSnapshot: unknown, store: StoreDestination): Pick<QuoteInput, 'from' | 'to'> {
  const s = obj(sellerSnapshot);
  return {
    from: {
      address: neutralizeOutboundAddress({
        countryCode: 'MX' as const,
        postalCode: text(s.postalCode),
        state: text(s.state),
        city: text(s.city),
        neighborhood: text(s.neighborhood),
      }),
    },
    to: { countryCode: 'MX', postalCode: store.postalCode, state: store.state, city: store.city, neighborhood: store.neighborhood },
  };
}

/**
 * §BSD.3 «Dirección de la compra» — `from` = el vendedor EXPLÍCITO (`street1`, `name`=`company`=`recipientName`, `phone`,
 * `furtherInformation` = `references`, CP/estado/ciudad/colonia) con el correo de la TIENDA (⛔ nunca el del vendedor:
 * minimización, ARCHITECTURE §4.BSD (i)); `to` = la tienda con `reference = referenceTextOf(providerReference)` (el folio, igual
 * que en salida) y `furtherInformation` = la referencia de la tienda. El remitente viaja neutralizado (es texto de cliente);
 * el destino es nuestro.
 */
export function inboundPurchaseAddresses(
  sellerSnapshot: unknown,
  store: StoreDestination,
  providerReference: string,
): Pick<PurchaseInput, 'from' | 'to'> {
  const s = obj(sellerSnapshot);
  const name = text(s.recipientName);
  const line2 = text(s.line2);
  const references = text(s.references);
  const from = neutralizeOutboundAddress({
    street1: `${text(s.line1)}${line2 ? ` ${line2}` : ''}`,
    name,
    company: name,
    phone: text(s.phone),
    email: store.email,
    ...(references ? { furtherInformation: references } : {}),
    postalCode: text(s.postalCode),
    areaLevel1: text(s.state),
    areaLevel2: text(s.city),
    areaLevel3: text(s.neighborhood),
  });
  return {
    from: { address: from },
    to: {
      street1: store.street1,
      name: store.name,
      company: store.company,
      phone: store.phone,
      email: store.email,
      reference: referenceTextOf(providerReference),
      ...(store.reference ? { furtherInformation: store.reference } : {}),
      postalCode: store.postalCode,
      areaLevel1: store.state,
      areaLevel2: store.city,
      areaLevel3: store.neighborhood,
    },
  };
}

/** Lo que la solicitud aporta al dinero y al empaque de la guía de entrada. */
export interface InboundMoneySellRequest {
  readonly offerShippingFeeCents: number | null;
  readonly offerGrossCents: number | null;
}

/**
 * §BSD.3 «Lo cobrado» — la tarifa congelada que se le descuenta al vendedor: bruto = neto (no lleva IVA trasladado: es un
 * descuento al precio de compra). ⇒ `marginCents = tarifa − netCostCents` (interpretación marcada de §BSD.1.2).
 */
export function inboundChargedOf(sr: InboundMoneySellRequest): ChargedShipping {
  const fee = Math.max(0, sr.offerShippingFeeCents ?? 0);
  return { grossCents: fee, netCents: fee };
}

/** §BSD.3 «Valor a asegurar» — lo que vamos a pagar por las cartas (`offerGrossCents`). */
export function inboundInsuredValueCents(sr: InboundMoneySellRequest): number {
  return Math.max(0, sr.offerGrossCents ?? 0);
}

/** §BSD.3 «Empaque por regla» — líneas `offerDecision='buy'`; `sealed` y `graded` cuentan como sellado. */
export function inboundPackageLines(
  items: readonly { id: string; offerDecision: string | null; productType: string; offeredPriceCents: number | null }[],
): PickedLine[] {
  return items
    .filter((i) => i.offerDecision === 'buy')
    .map((i) => ({ inventoryItemId: i.id, sealed: i.productType === 'sealed' || i.productType === 'graded', paidCents: i.offeredPriceCents }));
}

/** Las claves EXACTAS que §BSD.4.1 paso 3 copia de `pickupAddressSnapshot` a la fila de entrada. ⛔ Sin `addressId`. */
export const INBOUND_SNAPSHOT_KEYS = ['recipientName', 'line1', 'line2', 'neighborhood', 'city', 'state', 'postalCode', 'country', 'phone', 'references'] as const;

/**
 * §BSD.4.1 paso 3 — la copia del domicilio de recolección: exactamente `INBOUND_SNAPSHOT_KEYS`, y `recipientName` /
 * `references` **solo si la copia los trae** (ausente ⇒ la ventana pide el nombre). ⛔ Ninguna otra clave (doctrina del
 * snapshot, ARCHITECTURE §5.2).
 */
export function inboundAddressSnapshotOf(pickup: unknown): Record<string, unknown> {
  const p = obj(pickup);
  const out: Record<string, unknown> = {};
  for (const k of INBOUND_SNAPSHOT_KEYS) {
    if ((k === 'recipientName' || k === 'references') && (p[k] === undefined || p[k] === null || text(p[k]) === '')) continue;
    out[k] = p[k] ?? null;
  }
  return out;
}

/** La fila de entrada tal como la lee la descarga del vendedor y `labelPdfAvailable` (C-1). */
export interface InboundLabelRow {
  readonly status: string;
  readonly labelSource: string | null;
  readonly providerShipmentId: string | null;
  readonly providerCanceledAt: Date | null;
  readonly trackingNumber: string | null;
}

/** El `select` mínimo para `labelPdfAvailableOf` (la lista lo pide con la solicitud: ⛔ sin N+1). */
export const INBOUND_LABEL_SELECT = {
  status: true,
  labelSource: true,
  providerShipmentId: true,
  providerCanceledAt: true,
  trackingNumber: true,
} as const;

/**
 * ⭐ BSD-1.1 C-1 — `SellRequestDTO.labelPdfAvailable` (lista Y detalle, campo plano): `true` ⇔ guía VIVA de entrada con
 * número (`labelSource='skydropx'`, id, sin cancelar, con número, fila en `guia`) ∧ solicitud `aceptada`. UNA regla, la misma
 * que la guarda de `GET /buylist/requests/:id/label.pdf`.
 */
export function labelPdfAvailableOf(sr: { readonly status: string }, row: InboundLabelRow | null | undefined): boolean {
  if (sr.status !== 'aceptada' || !row) return false;
  return (
    row.status === 'guia' &&
    row.labelSource === 'skydropx' &&
    row.providerShipmentId !== null &&
    row.providerCanceledAt === null &&
    row.trackingNumber !== null &&
    row.trackingNumber.trim() !== ''
  );
}

/**
 * ⭐ BSD-1.1 C-6 — el nombre de paquetería que lee el VENDEDOR (lo que `writeSellRequestGuide` copia a la solicitud): el
 * legible de la tarifa elegida (`carrierLabel`); vacío ⇒ `carrierName`. La fila de entrada conserva el código.
 */
export function sellerCarrierLabelOf(rate: { carrierLabel?: string | null; carrierName?: string | null } | null, fallback: string): string {
  const label = typeof rate?.carrierLabel === 'string' ? rate.carrierLabel.trim() : '';
  if (label) return label;
  const name = typeof rate?.carrierName === 'string' ? rate.carrierName.trim() : '';
  return name || fallback;
}

/** `guia-<8 primeros del folio de la solicitud>.pdf` (§BSD.4.4; el mismo nombre que el adjunto de AV-7). */
export function sellerLabelFilenameOf(sellRequestId: string): string {
  const base = sellRequestId.replace(/[^A-Za-z0-9]/g, '').slice(0, 8);
  return `guia-${base || 'venta'}.pdf`;
}

/** BSD.4.2 — las claves de DESTINO que ningún cuerpo puede traer (`quote`, `label`, `address`), ⇒ 400 antes de la red. */
export const DESTINATION_BODY_KEYS = ['to', 'destination', 'addressTo', 'address_to'] as const;

/** `400 VALIDATION_ERROR {field:<clave>, reason:'destination_not_editable'}` si el cuerpo trae una clave de destino (criterio 532). */
export function rejectDestinationKeys(raw: unknown): void {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return;
  for (const k of DESTINATION_BODY_KEYS) {
    if (Object.prototype.hasOwnProperty.call(raw, k)) {
      throw BusinessException.badRequest('VALIDATION_ERROR', 'The destination of a label is not editable', { field: k, reason: 'destination_not_editable' });
    }
  }
}

/** La fila de entrada tal como la ven las guardas del motor (bajo los dos candados). */
export interface InboundGuardRow {
  readonly status: string;
  readonly labelSource: 'manual' | 'skydropx' | null;
  readonly trackingNumber: string | null;
}

/**
 * §BSD.3 «Estado abierta sin guía» para la fila de entrada, en este orden: la solicitud (`GUIDE_NOT_ALLOWED {status,
 * reason}`) ⇒ la fila ya tiene guía (`SHIPMENT_ALREADY_LABELED {labelSource}`) ⇒ la solicitud tiene guía MANUAL
 * (`SHIPMENT_ALREADY_LABELED {labelSource:'manual'}`) ⇒ la fila fuera de `openStatus` (defensa: I-BSD-1 la hace
 * imposible con la solicitud abierta). El reclamo vivo y la dirección los decide cada verbo (como en salida).
 */
export function assertInboundOpenForLabel(row: InboundGuardRow, sr: InboundGuardSellRequest, openStatus: string): void {
  const block = inboundGuideBlock(sr);
  if (block) throw guideNotAllowed(sr.status, block);
  const ls = labelSourceOf(row);
  if (ls !== null) throw BusinessException.conflict('SHIPMENT_ALREADY_LABELED', 'Shipment already has a label', { labelSource: ls });
  if (sr.shipmentTrackingNumber !== null) throw manualGuideTaken();
  if (row.status !== openStatus) throw guideNotAllowed(row.status, 'status');
}
