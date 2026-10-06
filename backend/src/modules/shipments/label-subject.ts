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
 * ### Esqueleto (B-1). Lo que falta lo pone B-2 AQUÍ, no en el motor
 * B-1 deja las piezas que no dependen de la red ni de la dirección: estados, candados, avisos. B-2 añade aquí las que
 * dependen de la solicitud (dirección del cotizador y de la compra, `chargedOf`, `insuredValueOf`, empaque por regla,
 * recomendada), con la tabla de §BSD.3 como especificación.
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
}

const OUTBOUND_SUBJECT: Omit<LabelSubject, 'sellRequestId'> = {
  kind: ShipmentKind.outbound,
  openStatus: 'picking',
  labeledStatus: 'guia',
  closedStatus: 'cancelado',
  reissueStatus: 'picking',
  locksSellRequestFirst: false,
  labelNotice: 'AV-4',
  alertsAfterAddressFix: true,
  inTrackingPoll: true,
  labelNotShippedWatch: true,
};

const INBOUND_SUBJECT: Omit<LabelSubject, 'sellRequestId'> = {
  kind: ShipmentKind.buylist_inbound,
  openStatus: 'solicitado',
  labeledStatus: 'guia',
  closedStatus: 'cancelado',
  reissueStatus: 'solicitado',
  locksSellRequestFirst: true,
  labelNotice: 'AV-7',
  alertsAfterAddressFix: false,
  inTrackingPoll: false,
  labelNotShippedWatch: false,
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
