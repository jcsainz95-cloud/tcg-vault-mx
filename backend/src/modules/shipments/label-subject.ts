/**
 * label-subject.ts — 💰 rev BSD-1 (API_CONTRACT §BSD.3, ARCHITECTURE §4.BSD (a)(b)): **QUÉ es la fila** sobre la que trabaja
 * el motor de guías (`outbound` = envío de venta/retiro; `buylist_inbound` = guía de ENTRADA de una solicitud de venta).
 *
 * ### ⛔ El ÚNICO fichero que compara `kind` (candado BSD-B25 (a), `test/bsd.structural.spec.ts`)
 * El motor (`label-purchase`, `label-quote`, `label-cancel`, `shipment-address`, …) elige su conducta por la política que
 * devuelve `labelSubjectOf(row)`; los lectores por filtro de la tabla usan `OUTBOUND_ONLY` / `outboundOnlySql()` (censo
 * BSD-B23, `test/bsd.reader-census.spec.ts`). Nadie escribe `'outbound'`/`'buylist_inbound'` ni importa `ShipmentKind` de
 * Prisma fuera de aquí: *un lector que olvida el `kind` mete una guía de entrada en la cola de preparación o en el P&L*, y
 * la única forma barata de que no se olvide es que no haya más de un sitio donde recordarlo.
 *
 * ### Esqueleto (B-1) y piezas de B-2
 * B-1 dejó las piezas que no dependen de la red ni de la dirección: estados, candados, avisos. B-2 (§BSD.3 + errata BSD-1.3
 * punto 5) añade aquí los ESTADOS por clase (`OPEN_FOR_LABEL_STATUS`, `LABELED_STATUS`, `openForLabelWhere()`), las banderas
 * de política que el motor lee (`requiresPreparation`, `recommendation`) y el `kind` del DTO admin (`AdminShipmentKind`,
 * BSD-1.3 punto 2). Las piezas de la solicitud que dependen de la dirección y del dinero (dirección del cotizador y de la
 * compra, lo cobrado, el valor asegurado, el empaque) viven en `label-inbound.ts`: son DATOS de la solicitud, no una
 * comparación de `kind`, y así este fichero sigue ligero.
 *
 * Fichero LIGERO a propósito (solo `@prisma/client`): lo importan `shipments/*`, `admin`, `payments`, `spend-alerts` y
 * `buylist` sin ciclo de imports.
 */
import { Prisma, ShipmentKind, ShipmentStatus } from '@prisma/client';

/** El valor de `kind` de una fila de entrada, para el `create` de §BSD.4.1 (⛔ nadie escribe el literal fuera de aquí). */
export const BUYLIST_INBOUND_KIND: ShipmentKind = ShipmentKind.buylist_inbound;

/**
 * El filtro de los lectores `outbound_only` del censo BSD-B23. Se ESPARCE en el `where` del lector:
 * `where: { ...OUTBOUND_ONLY, status: … }`. Cubre retiros y envíos directos (los dos son `outbound`).
 */
export const OUTBOUND_ONLY = { kind: ShipmentKind.outbound } as const satisfies Prisma.ShipmentRequestWhereInput;

/** Lo mismo para un `where` RELACIONAL que llega a `ShipmentRequest` (p. ej. `shipmentRequest: { ...OUTBOUND_ONLY }`). */
export const INBOUND_ONLY = { kind: ShipmentKind.buylist_inbound } as const satisfies Prisma.ShipmentRequestWhereInput;

/**
 * El mismo filtro para SQL crudo. `alias` = el alias de `"ShipmentRequest"` en la consulta (sin alias ⇒ columna desnuda).
 * Compara `::text` (como los CHECK de M-72) para no depender del tipo del parámetro.
 */
export function outboundOnlySql(alias?: string): Prisma.Sql {
  return alias ? Prisma.raw(`${alias}."kind"::text = 'outbound'`) : Prisma.raw(`"kind"::text = 'outbound'`);
}

/** Lo mínimo que hace falta de la fila para decidir su política. */
export interface LabelSubjectRow {
  readonly kind: ShipmentKind;
  readonly sellRequestId: string | null;
}

/** ¿Es la guía de ENTRADA de una solicitud de venta? (⛔ úsese esto, nunca `row.kind === …` fuera de aquí). */
export function isBuylistInbound(row: Pick<LabelSubjectRow, 'kind'>): boolean {
  return row.kind === ShipmentKind.buylist_inbound;
}

/**
 * La política por `kind` (§BSD.3). Solo DATOS: el motor la lee, no ramifica por su cuenta.
 *
 * | Pieza | `outbound` | `buylist_inbound` |
 * |---|---|---|
 * | `openStatus` — «abierta sin guía» en guardas y CAS | `picking` (∧ `preparedAt` ∧ `prep.assertCanAdvance`) | `solicitado` (∧ guarda de la solicitud en la misma tx) |
 * | `labeledStatus` — tras la guía (`persistLabeled`) | `guia` | `guia` |
 * | `closedStatus` — lo que reconoce `casZero` rama (3) | `cancelado` | `cancelado` |
 * | `reissueStatus` — re-emisión aceptada (`applyReissue`) | `picking` | `solicitado` (+ §BSD.4.6 sobre la solicitud) |
 * | `locksSellRequestFirst` — I-BSD-4 | no | **sí**: `SellRequest FOR UPDATE` y luego `ShipmentRequest FOR UPDATE` |
 * | `labelNotice` — post-commit tras guía con número | `AV-4` (`notifyLabelCaptured`) | `AV-7` (`guideNoticeSentAt`) |
 * | `alertsAfterAddressFix` — AG-1 | sí | ⛔ no (el destino es fijo) |
 * | `inTrackingPoll` — sondeo de rastreo y AV-17/18/19 | sí | ⛔ no (P-BSD-5, ARCHITECTURE §4.BSD (j)) |
 * | `labelNotShippedWatch` — AG-10 | sí | ⛔ no (I-BSD-6) |
 * | `requiresPreparation` — `preparedAt`, `prep.assertCanAdvance(…,'guia')`, casos abiertos | sí | ⛔ no (la guarda es la de la solicitud, `label-inbound.ts`) |
 * | `recommendation` — `pickRecommendedRateId` | `shipping_preferred_carriers` y luego la más barata a domicilio | la más barata con `deliveryKind ≠ 'branch'` (P-BSD-4); ⛔ sin puntos de entrega |
 */
export interface LabelSubject {
  readonly kind: ShipmentKind;
  /** Solo `buylist_inbound` (CHECK `shipment_kind_link`). */
  readonly sellRequestId: string | null;
  readonly openStatus: ShipmentStatus;
  readonly labeledStatus: ShipmentStatus;
  readonly closedStatus: ShipmentStatus;
  readonly reissueStatus: ShipmentStatus;
  readonly locksSellRequestFirst: boolean;
  readonly labelNotice: 'AV-4' | 'AV-7';
  readonly alertsAfterAddressFix: boolean;
  readonly inTrackingPoll: boolean;
  readonly labelNotShippedWatch: boolean;
  /** Lo que NO es estado en la guarda «abierta sin guía» (BSD-1.3 punto 5): `preparedAt`, `assertCanAdvance`, casos abiertos. */
  readonly requiresPreparation: boolean;
  /** `preferred_then_cheapest_home` (salida, §19.19.4) o `cheapest_home` (entrada, P-BSD-4: sin diales de paquetería ni de puntos). */
  readonly recommendation: 'preferred_then_cheapest_home' | 'cheapest_home';
}

/**
 * ⭐ BSD-1.3 punto 5 — **el estado «abierta sin guía» por clase**. Los CAS por id del motor (`claim`, `persistLabeled`,
 * `persistProcessing`, `correct`, `applyReissue`, `setTrackingFromProvider`) toman su `status` de aquí vía
 * `labelSubjectOf(row).openStatus`; ⛔ ningún literal `'picking'` en un `status` del motor fuera de este fichero
 * (candado BSD-B25 (c), `test/bsd.structural.spec.ts`).
 */
export const OPEN_FOR_LABEL_STATUS: Readonly<Record<ShipmentKind, ShipmentStatus>> = {
  [ShipmentKind.outbound]: 'picking',
  [ShipmentKind.buylist_inbound]: 'solicitado',
};

/** El estado tras la guía (`persistLabeled`, `setTrackingFromProvider`): `guia` para las dos clases. */
export const LABELED_STATUS: Readonly<Record<ShipmentKind, ShipmentStatus>> = {
  [ShipmentKind.outbound]: 'guia',
  [ShipmentKind.buylist_inbound]: 'guia',
};

/**
 * El predicado «abierta sin guía» para las lecturas MULTI-CLASE (`label-processing.job` `processing#findMany`, `all_kinds`):
 * `OR[{kind:'outbound', status:'picking'}, {kind:'buylist_inbound', status:'solicitado'}]`. Se ESPARCE en el `where`.
 */
export function openForLabelWhere(): { OR: Prisma.ShipmentRequestWhereInput[] } {
  return {
    OR: (Object.keys(OPEN_FOR_LABEL_STATUS) as ShipmentKind[]).map((kind) => ({ kind, status: OPEN_FOR_LABEL_STATUS[kind] })),
  };
}

/**
 * ⭐ BSD-1.3 punto 2 — **`AdminShipmentDTO.kind`** (la pregunta «qué clase de envío es»): el derivado de hoy
 * (`vault_withdrawal` = sin orden, `guest_direct_ship` = orden de envío directo) gana `buylist_inbound`. UNA declaración,
 * exportada; se llama `AdminShipmentKind` para no chocar con el `ShipmentKind` de Prisma (la columna).
 */
export type AdminShipmentKind = 'vault_withdrawal' | 'guest_direct_ship' | 'buylist_inbound';
/** Las dos clases de SALIDA (la cola de M4, `?kind=`, la hoja de preparación): nunca una fila de entrada. */
export type OutboundAdminShipmentKind = Exclude<AdminShipmentKind, 'buylist_inbound'>;
/** El valor del DTO para la fila de entrada (⛔ nadie escribe el literal fuera de aquí, BSD-B25 (a)). */
export const INBOUND_ADMIN_KIND: AdminShipmentKind = 'buylist_inbound';

/**
 * `AdminShipmentDTO.kind` de una fila: la de entrada ⇒ `buylist_inbound`; si no, `outbound()` (la derivación de salida de
 * hoy, que vive en `shipments.service.ts` porque lee `Order.fulfillmentMode` y lanza ante un modo desconocido).
 */
export function adminKindOf(row: Pick<LabelSubjectRow, 'kind'>, outbound: () => OutboundAdminShipmentKind): AdminShipmentKind {
  return isBuylistInbound(row) ? INBOUND_ADMIN_KIND : outbound();
}

const OUTBOUND_SUBJECT: Omit<LabelSubject, 'sellRequestId'> = {
  kind: ShipmentKind.outbound,
  openStatus: OPEN_FOR_LABEL_STATUS[ShipmentKind.outbound],
  labeledStatus: LABELED_STATUS[ShipmentKind.outbound],
  closedStatus: 'cancelado',
  reissueStatus: OPEN_FOR_LABEL_STATUS[ShipmentKind.outbound],
  locksSellRequestFirst: false,
  labelNotice: 'AV-4',
  alertsAfterAddressFix: true,
  inTrackingPoll: true,
  labelNotShippedWatch: true,
  requiresPreparation: true,
  recommendation: 'preferred_then_cheapest_home',
};

const INBOUND_SUBJECT: Omit<LabelSubject, 'sellRequestId'> = {
  kind: ShipmentKind.buylist_inbound,
  openStatus: OPEN_FOR_LABEL_STATUS[ShipmentKind.buylist_inbound],
  labeledStatus: LABELED_STATUS[ShipmentKind.buylist_inbound],
  closedStatus: 'cancelado',
  reissueStatus: OPEN_FOR_LABEL_STATUS[ShipmentKind.buylist_inbound],
  locksSellRequestFirst: true,
  labelNotice: 'AV-7',
  alertsAfterAddressFix: false,
  inTrackingPoll: false,
  labelNotShippedWatch: false,
  requiresPreparation: false,
  recommendation: 'cheapest_home',
};

/**
 * La política de la fila. ⛔ Fail-closed: un `kind` desconocido (cliente de Prisma desfasado del schema) LANZA en vez de
 * caer en la rama de salida — tratar una guía de entrada como un envío de venta es justo el defecto que esto evita.
 * Una fila de entrada sin `sellRequestId` también lanza (el CHECK `shipment_kind_link` lo hace imposible en BD).
 */
export function labelSubjectOf(row: LabelSubjectRow): LabelSubject {
  if (row.kind === ShipmentKind.outbound) return { ...OUTBOUND_SUBJECT, sellRequestId: null };
  if (row.kind === ShipmentKind.buylist_inbound) {
    if (!row.sellRequestId) throw new Error('label-subject: fila buylist_inbound sin sellRequestId (viola shipment_kind_link)');
    return { ...INBOUND_SUBJECT, sellRequestId: row.sellRequestId };
  }
  throw new Error(`label-subject: kind desconocido ${String(row.kind)}`);
}

/**
 * I-BSD-4 — **el orden de candados**, en UN sitio: toda transacción que toque solicitud **y** fila de entrada toma
 * PRIMERO la `SellRequest` y DESPUÉS la `ShipmentRequest`. Para una fila de salida es el `FOR UPDATE` de siempre.
 * ⛔ El candado consultivo de cuenta (`pg_try_advisory_xact_lock`) sigue siendo la PRIMERA sentencia del reclamo y nunca
 * espera: no pasa por aquí.
 */
export async function lockSubjectRows(
  tx: Prisma.TransactionClient,
  subject: Pick<LabelSubject, 'locksSellRequestFirst' | 'sellRequestId'>,
  shipmentId: string,
): Promise<void> {
  if (subject.locksSellRequestFirst && subject.sellRequestId) {
    await tx.$queryRaw`SELECT id FROM "SellRequest" WHERE id = ${subject.sellRequestId} FOR UPDATE`;
  }
  await tx.$queryRaw`SELECT id FROM "ShipmentRequest" WHERE id = ${shipmentId} FOR UPDATE`;
}

/** Las dos columnas que deciden la política (se leen ANTES del candado: son inmutables tras crear la fila). */
export const LABEL_SUBJECT_SELECT = { kind: true, sellRequestId: true } as const satisfies Prisma.ShipmentRequestSelect;
