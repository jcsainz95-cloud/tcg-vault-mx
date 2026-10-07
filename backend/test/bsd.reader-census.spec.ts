/**
 * bsd.reader-census.spec.ts — 💰 BSD-B23 (API_CONTRACT §BSD.11, rev BSD-1): **el CENSO de lectores de `ShipmentRequest`.**
 *
 * ### Por qué existe (ARCHITECTURE §4.BSD (b))
 * La guía de ENTRADA del buylist es una fila más de `ShipmentRequest` (`kind='buylist_inbound'`), y la tabla tiene ~100
 * sitios que la leen por filtro escritos pensando en envíos de VENTA. Un lector que olvide el `kind` mete una guía de
 * entrada en la cola de preparación, en el tablero o en el P&L. Tres muros: el CHECK `shipment_kind_link` (sin `userId`,
 * `orderId`, PaymentIntent ni montos), **este censo**, y la política en un solo fichero (`label-subject.ts`, BSD-B25).
 *
 * ### Qué afirma
 * Cada sitio de `src/` (`*.shipmentRequest.{findMany,findFirst,findFirstOrThrow,count,aggregate,groupBy,updateMany}` y
 * todo SQL con `"ShipmentRequest"`) está en `CENSUS` con UNA clase:
 *  - `outbound_only` — solo envíos de venta/retiro: el sitio DEBE llevar `OUTBOUND_ONLY` (o `outboundOnlySql()`), en el
 *    argumento o en la variable que el argumento nombra;
 *  - `inbound_only` — solo guías de ENTRADA del buylist (BSD-1.3 punto 6): el sitio DEBE llevar `INBOUND_ONLY`;
 *  - `all_kinds` — ve las dos clases A PROPÓSITO (propiedades de CUENTA del motor de Skydropx: candado, `rate_already_
 *    purchased`, `takenBy`, recuperación, huérfanas, job de proceso…), con su porqué;
 *  - `by_key` — llega por llave (`id`, `orderId`, `stripePaymentIntentId`, `providerShipmentId`, `sellRequestId`,
 *    `userId`), con su porqué.
 * Un sitio NUEVO sin clasificar ⇒ ROJO (y uno que desaparece, también: la tabla no puede pudrirse).
 *
 * Mutación del contrato: quitar `OUTBOUND_ONLY` de la lista admin ⇒ rojo. CONTROL: el censo ve > 0 sitios (≥ 90).
 * Llave = `fichero función#verbo#ordinal` (el ordinal cuenta ese verbo dentro de esa función).
 */
import { join } from 'node:path';
import { ReaderSite, shipmentReaderSites } from './helpers/bsd-census';

type Clase = 'outbound_only' | 'inbound_only' | 'all_kinds' | 'by_key';
const O = 'outbound_only' as const;
/** BSD-1.3 punto 6: SOLO guías de ENTRADA del buylist; el sitio DEBE llevar `INBOUND_ONLY`. */
const I = 'inbound_only' as const;
const A = 'all_kinds' as const;
const K = 'by_key' as const;

/** La tabla. ⛔ Clasificar un sitio nuevo es una DECISIÓN: si dudas entre `all_kinds` y `outbound_only`, es `outbound_only`. */
const CENSUS: Record<string, readonly [Clase, string]> = {
  // ---------------------------------------------------------------- admin
  'src/modules/admin/admin.service.ts deleteUser#count#1': [K, 'userId: la fila de entrada lleva userId NULL (CHECK); el vendedor cuenta por sellRequest.count'],
  'src/modules/admin/admin.service.ts pnl#findMany#1': [O, 'P&L de M7 (§BSD.5): una guía de entrada en `guia` NO es costo de envío de venta'],
  'src/modules/admin/admin.service.ts pnlBuylistGuides#findMany#1': [I, 'P&L de M7 (§BSD.16 (a), BSD-1.3 punto 6): costo de las guías de Skydropx de ENTRADA'],
  'src/modules/admin/admin.service.ts launchMetrics#count#1': [O, 'métrica de lanzamiento: envíos entregados'],
  'src/modules/admin/admin.service.ts dashboard#count#1': [O, 'tablero: envíos por atender'],
  'src/modules/admin/admin.service.ts dashboard#count#2': [O, 'tablero: envíos entregados'],
  // ---------------------------------------------------------------- buylist (B-3, rev BSD-1)
  'src/jobs/buylist-sweep.service.ts closeWithGuideTask#sql#1': [K, 'FOR UPDATE por sellRequestId (I-BSD-4: la fila de entrada de la solicitud que el barrido cierra)'],
  'src/jobs/buylist-sweep.service.ts reconcileInboundCancellations#findMany#1': [I, 'regla 10 del barrido (§BSD.7.5): cancelaciones sin confirmar de guías de ENTRADA'],
  'src/modules/buylist/buylist.service.ts adminGuide#sql#1': [K, 'FOR UPDATE por sellRequestId (I-BSD-4: la captura a mano frente a la guía de entrada)'],
  'src/modules/buylist/buylist.service.ts updatePickupAddress#sql#1': [K, 'FOR UPDATE por sellRequestId (I-BSD-4: el vendedor cambia el origen)'],
  'src/modules/buylist/buylist.service.ts adminUpdatePickupAddress#sql#1': [K, 'FOR UPDATE por sellRequestId (I-BSD-4: el admin corrige el origen)'],
  'src/modules/buylist/inbound-address-sync.ts resyncInboundAddress#updateMany#1': [K, 'CAS por id + versión (la fila de entrada de la solicitud, §BSD.4.5)'],
  'src/modules/buylist/inbound-view.ts inboundLabelAlertSellRequestIds#findMany#1': [I, 'M5 `?inboundLabelAlert=true` y `workQueue.buylistInboundLabelAlert` (BSD-1.3 punto 4)'],
  // ---------------------------------------------------------------- orders / payments
  'src/modules/orders/order-refund.service.ts requestFullRefund#sql#1': [K, 'FOR UPDATE por id de los retiros de la orden'],
  'src/modules/orders/orders.service.ts resolveChargebackInventory#findFirst#1': [K, 'orderId (la fila de entrada no tiene orden)'],
  'src/modules/payments/payments.service.ts onPaymentSucceeded#updateMany#1': [K, 'CAS por id'],
  'src/modules/payments/payments.service.ts settleDirectShipOrder#findFirst#1': [K, 'orderId'],
  'src/modules/payments/payments.service.ts failAndRelease#updateMany#1': [K, 'CAS por id'],
  'src/modules/payments/payments.service.ts onChargeDisputeDirectShip#findFirst#1': [K, 'orderId'],
  'src/modules/payments/payments.service.ts onChargeDisputeDirectShip#updateMany#1': [K, 'CAS por id'],
  'src/modules/payments/refunds/full-refund.service.ts closeShipmentsOnFullRefund#findMany#1': [K, 'id del envío del objetivo'],
  'src/modules/payments/refunds/full-refund.service.ts closeShipmentsOnFullRefund#sql#1': [K, 'FOR UPDATE por id'],
  'src/modules/payments/refunds/full-refund.service.ts cancelShipment#updateMany#1': [K, 'CAS por id'],
  'src/modules/payments/refunds/full-refund.service.ts reclaimVaultOnFullRefund#sql#1': [K, 'FOR UPDATE por id'],
  'src/modules/payments/refunds/refund-reports.service.ts operatorSummary#findMany#1': [O, 'reportes de reembolsos: preparación por operador'],
  'src/modules/payments/refunds/refund-review.ts lockShipmentsOfOrder#findMany#1': [K, 'orderId'],
  'src/modules/payments/refunds/refund-review.ts lockShipmentsOfOrder#sql#1': [K, 'FOR UPDATE por id'],
  'src/modules/payments/refunds/withdrawal-delivered-refund.service.ts create#sql#1': [K, 'FOR UPDATE por id'],
  // ---------------------------------------------------------------- shipments: rastreo y salida
  'src/modules/shipments/carrier-status.service.ts applyCarrierStatus#updateMany#1': [K, 'por id'],
  'src/modules/shipments/carrier-status.service.ts applyCarrierStatus#updateMany#2': [K, 'CAS por id'],
  'src/modules/shipments/carrier-status.service.ts applyCarrierStatus#updateMany#3': [K, 'por id (B-2: la guía de entrada solo anota `carrierPolledAt` fuera de `created`)'],
  'src/modules/shipments/carrier-status.service.ts applyCarrierStatus#updateMany#4': [K, 'por id'],
  'src/modules/shipments/carrier-status.service.ts setTrackingFromProvider#updateMany#1': [K, 'CAS por id (B-2: su `status` es de salida)'],
  'src/modules/shipments/carrier-status.service.ts touchPolled#updateMany#1': [K, 'por id'],
  'src/modules/shipments/carrier-status.service.ts fillLabelUrl#updateMany#1': [K, 'CAS por id'],
  'src/modules/shipments/departure.service.ts board#findMany#1': [O, 'salida de hoy: la guía de entrada la lleva el vendedor'],
  'src/modules/shipments/departure.service.ts board#count#1': [O, 'salida de hoy: guías manuales pendientes'],
  'src/modules/shipments/departure.service.ts departed#sql#1': [K, 'FOR UPDATE por id'],
  'src/modules/shipments/tracking-poll.job.ts run#findMany#1': [O, 'sondeo de rastreo (I-BSD-6, P-BSD-5)'],
  'src/modules/shipments/tracking-poll.job.ts pollRows#updateMany#1': [K, 'por id'],
  // ---------------------------------------------------------------- shipments: el motor de la guía
  'src/modules/shipments/inbound-close.ts closeInboundShipment#sql#1': [K, 'sellRequestId (@unique): LA fila de entrada de la solicitud'],
  'src/modules/shipments/inbound-close.ts closeInboundShipment#updateMany#1': [K, 'CAS por id'],
  'src/modules/shipments/inbound-close.ts closeInboundShipment#updateMany#2': [K, 'CAS por id'],
  'src/modules/shipments/inbound-sync.ts scrubInboundShipmentPii#updateMany#1': [I, 'BSD-B27 (B-2): la anonimización del vendedor vacía el domicilio de SUS filas de entrada (por sellRequest.userId)'],
  'src/modules/shipments/label-auto-close.ts cancelProviderLabelIfAny#updateMany#1': [K, 'CAS por id'],
  'src/modules/shipments/label-cancel.service.ts cancel#updateMany#1': [K, 'CAS por id'],
  'src/modules/shipments/label-cancel.service.ts unseal#updateMany#1': [K, 'CAS por id'],
  'src/modules/shipments/label-cancel.service.ts applyReissue#updateMany#1': [K, 'CAS por id (B-2: `guia → reissueStatus` por kind)'],
  'src/modules/shipments/label-cancel.service.ts applyReissue#updateMany#2': [K, 'CAS por id'],
  'src/modules/shipments/label-cancel.service.ts afterAutoClose#findMany#1': [K, 'ids recién cerrados'],
  'src/modules/shipments/label-processing.job.ts processing#findMany#1': [A, 'job de proceso: «en proceso» de CUALQUIER fila trae su número (B-2: `openForLabelWhere()`, la entrada vive en `solicitado`)'],
  'src/modules/shipments/label-processing.job.ts inFlight#findMany#1': [A, 'compras en vuelo de la CUENTA (recuperación)'],
  'src/modules/shipments/label-processing.job.ts calibrate#findMany#1': [A, 'calibración de tiempos del proveedor: toda guía comprada cuenta'],
  'src/modules/shipments/label-processing.job.ts purgeQuotes#sql#1': [A, 'purga de cotizaciones vencidas de cualquier fila'],
  'src/modules/shipments/label-purchase.service.ts purchase#sql#1': [K, 'FOR SHARE por id'],
  'src/modules/shipments/label-purchase.service.ts precheck#findFirst#1': [A, '`rate_already_purchased`: una tarifa no se compra dos veces en la CUENTA'],
  'src/modules/shipments/label-purchase.service.ts claim#findFirst#1': [A, '«otra compra en vuelo»: una a la vez por CUENTA'],
  'src/modules/shipments/label-purchase.service.ts claim#updateMany#1': [K, 'CAS del reclamo por id (B-2: `status` por kind)'],
  'src/modules/shipments/label-purchase.service.ts markSent#updateMany#1': [K, 'CAS por id'],
  'src/modules/shipments/label-purchase.service.ts undo#updateMany#1': [K, 'CAS por id'],
  'src/modules/shipments/label-purchase.service.ts persistLabeled#updateMany#1': [K, 'CAS por id (B-2: `status` por kind)'],
  'src/modules/shipments/label-purchase.service.ts persistProcessing#updateMany#1': [K, 'CAS por id (B-2: `status` por kind)'],
  'src/modules/shipments/label-purchase.service.ts takenBy#findFirst#1': [A, '`takenBy`: un providerShipmentId pertenece a UNA fila de cualquier clase'],
  'src/modules/shipments/label-purchase.service.ts casZero#updateMany#1': [K, 'CAS por id'],
  'src/modules/shipments/label-purchase.service.ts casZero#updateMany#2': [K, 'CAS por id'],
  'src/modules/shipments/label-purchase.service.ts run#updateMany#1': [K, 'por id'],
  'src/modules/shipments/label-recovery.service.ts knownIdsAmong#findMany#1': [A, 'recuperación: ids del proveedor conocidos en CUALQUIER fila'],
  'src/modules/shipments/label-recovery.service.ts contamination#findFirst#1': [A, 'recuperación: toda cancelación confirmada mueve el saldo de la cuenta'],
  'src/modules/shipments/label-recovery.service.ts release#sql#1': [K, 'FOR UPDATE por id'],
  'src/modules/shipments/label-recovery.service.ts release#updateMany#1': [K, 'CAS por id'],
  'src/modules/shipments/label-recovery.service.ts autoRelease#updateMany#1': [K, 'CAS por id'],
  // B-2: los `FOR UPDATE` por id del motor (`precheck`, `persistLabeled`, `persistProcessing`, `casZero`, `guardedRead`,
  // `cancel`, `correct`, `applyCarrierStatus`) pasaron a `lockSubjectRows` (I-BSD-4: la solicitud antes que la fila de entrada).
  'src/modules/shipments/label-subject.ts lockSubjectRows#sql#1': [K, 'FOR UPDATE por id (I-BSD-4)'],
  'src/modules/shipments/orphan-reconcile.service.ts detectLate#findMany#1': [A, 'huérfanas: un id del proveedor conocido en CUALQUIER fila no es huérfano'],
  'src/modules/shipments/orphan-reconcile.service.ts keepReason#sql#1': [A, 'huérfanas: un número de guía conocido en CUALQUIER fila'],
  'src/modules/shipments/shipment-address.service.ts correct#updateMany#1': [K, 'CAS por id (B-2: `status` por kind)'],
  // ---------------------------------------------------------------- shipments: preparación, listas, cola de trabajo
  'src/modules/shipments/shipment-prep.service.ts lockShipment#sql#1': [K, 'FOR UPDATE por id'],
  'src/modules/shipments/shipment-prep.service.ts prepare#updateMany#1': [K, 'CAS por id'],
  'src/modules/shipments/shipment-prep.service.ts prepare#updateMany#2': [K, 'CAS por id'],
  'src/modules/shipments/shipment-prep.service.ts unprepare#updateMany#1': [K, 'CAS por id'],
  'src/modules/shipments/shipment-prep.service.ts summary#count#1': [O, 'cola de preparación: conteo'],
  'src/modules/shipments/shipment-prep.service.ts summary#findFirst#1': [O, 'cola de preparación: la más vieja'],
  'src/modules/shipments/shipments.service.ts listMine#findMany#1': [O, 'lista de CLIENTE (`GET /shipments`); redundante con el CHECK a propósito'],
  'src/modules/shipments/shipments.service.ts adminList#findMany#1': [O, 'lista admin (§BSD.4.2: no incluye la fila de entrada)'],
  'src/modules/shipments/shipments.service.ts adminList#count#1': [O, 'lista admin: total'],
  'src/modules/shipments/shipments.service.ts pickingList#findMany#1': [O, 'cola de preparación (picking list)'],
  'src/modules/shipments/shipments.service.ts updateStatus#sql#1': [K, 'FOR UPDATE por id'],
  'src/modules/shipments/shipments.service.ts updateStatus#updateMany#1': [K, 'CAS por id'],
  'src/modules/shipments/shipments.service.ts transitionFromProvider#updateMany#1': [K, 'CAS por id'],
  'src/modules/shipments/shipments.service.ts transitionFromProvider#updateMany#2': [K, 'CAS por id'],
  'src/modules/shipments/shipments.service.ts setTracking#sql#1': [K, 'FOR UPDATE por id'],
  'src/modules/shipments/shipments.service.ts setTracking#updateMany#1': [K, 'CAS por id'],
  'src/modules/shipments/shipments.service.ts setTracking#updateMany#2': [K, 'CAS por id'],
  'src/modules/shipments/shipments.service.ts setTracking#updateMany#3': [K, 'CAS por id'],
  'src/modules/shipments/shipments.service.ts claimAndNotify#updateMany#1': [K, 'sello por id'],
  'src/modules/shipments/shipping-work-queue.ts carrierAlertShipmentIds#findMany#1': [O, '`?alert=true` de la lista admin y tablero de M4'],
  'src/modules/shipments/shipping-work-queue.ts labelAlertShipmentIds#findMany#1': [O, '`?alert=true` de la lista admin y tablero de M4 (C-TL-1: el mismo SQL cuenta y lista)'],
  'src/modules/shipments/shipping-work-queue.ts shippingWorkQueueOf#count#1': [O, 'tablero de M4: guías en proceso'],
  // ---------------------------------------------------------------- avisos al dueño / bóveda
  'src/modules/spend-alerts/spend-alert.view.ts loadAlertRefs#findMany#1': [K, 'ids de los avisos'],
  'src/modules/spend-alerts/spend-watch.service.ts sweepRefunds#findMany#1': [K, 'ids de los pendientes'],
  'src/modules/spend-alerts/spend-watch.service.ts sweepNotShipped#findMany#1': [O, 'AG-10 (I-BSD-6)'],
  'src/modules/vault/replacement-case.service.ts lockCase#sql#1': [K, 'FOR UPDATE por id'],
  'src/modules/vault/replacement-case.service.ts closeWithdrawalIfEmpty#updateMany#1': [K, 'CAS por id'],
};

/** El mínimo que el contrato nombra como `outbound_only` (§BSD.11 BSD-B23): si alguno cambia de clase, rojo. */
const MINIMO_OUTBOUND_ONLY = [
  'src/modules/shipments/shipments.service.ts adminList#findMany#1', // lista admin
  'src/modules/shipments/shipments.service.ts pickingList#findMany#1', // cola de preparación
  'src/modules/shipments/shipment-prep.service.ts summary#count#1', // y sus conteos
  'src/modules/shipments/departure.service.ts board#findMany#1', // salida de hoy
  'src/modules/admin/admin.service.ts dashboard#count#1', // tablero
  'src/modules/admin/admin.service.ts pnl#findMany#1', // P&L
  'src/modules/payments/refunds/refund-reports.service.ts operatorSummary#findMany#1', // reportes de reembolsos
  'src/modules/spend-alerts/spend-watch.service.ts sweepNotShipped#findMany#1', // AG-10
  'src/modules/shipments/tracking-poll.job.ts run#findMany#1', // sondeo de rastreo
  'src/modules/shipments/shipments.service.ts listMine#findMany#1', // lista de cliente
];
/** BSD-1.3 punto 6: el lector de guías de entrada de `pnl()` es `inbound_only`. */
const MINIMO_INBOUND_ONLY = [
  'src/modules/admin/admin.service.ts pnlBuylistGuides#findMany#1',
  // BSD-1.3 punto 4 (B-3): el lector del contador `workQueue.buylistInboundLabelAlert` y del filtro de M5.
  'src/modules/buylist/inbound-view.ts inboundLabelAlertSellRequestIds#findMany#1',
];
/** El mínimo `all_kinds` del contrato. */
const MINIMO_ALL_KINDS = [
  'src/modules/shipments/label-purchase.service.ts claim#findFirst#1', // candado de cuenta («otra compra en vuelo»)
  'src/modules/shipments/label-purchase.service.ts precheck#findFirst#1', // rate_already_purchased
  'src/modules/shipments/label-purchase.service.ts takenBy#findFirst#1', // takenBy
  'src/modules/shipments/label-processing.job.ts processing#findMany#1', // job de proceso
  'src/modules/shipments/label-processing.job.ts inFlight#findMany#1', // recuperación
  'src/modules/shipments/orphan-reconcile.service.ts detectLate#findMany#1', // huérfanas
];

const BACKEND = join(__dirname, '..');
let SITES: ReaderSite[];
beforeAll(() => {
  SITES = shipmentReaderSites(BACKEND);
});

describe('💰 BSD-B23 — censo de lectores de `ShipmentRequest`', () => {
  it('CONTROL: el censo ve los sitios (⛔ un escáner ciego sería verde por omisión)', () => {
    expect(SITES.length).toBeGreaterThanOrEqual(90);
    // B-2: ≥ 12 (eran ≥ 20): ocho `FOR UPDATE` por id del motor se volvieron UNO (`lockSubjectRows`, I-BSD-4).
    expect(SITES.filter((s) => s.method === 'sql').length).toBeGreaterThanOrEqual(12);
    // y el escáner reconoce el filtro donde está (si no, todo `outbound_only` sería rojo por el instrumento)
    expect(SITES.filter((s) => s.outboundFiltered).length).toBeGreaterThanOrEqual(10);
  });

  it('las llaves son únicas (dos sitios no pueden compartir fila de la tabla)', () => {
    const keys = SITES.map((s) => s.key);
    expect(keys.length).toBe(new Set(keys).size);
  });

  it('todo sitio de `src/` está clasificado (un sitio NUEVO sin clase ⇒ rojo: clasifícalo en CENSUS)', () => {
    const sinClase = SITES.filter((s) => !(s.key in CENSUS)).map((s) => `${s.key}  (línea ${s.line}: ${s.text.slice(0, 120)})`);
    expect(sinClase).toEqual([]);
  });

  it('la tabla no tiene filas muertas (un sitio que ya no existe sale de CENSUS)', () => {
    const vivos = new Set(SITES.map((s) => s.key));
    expect(Object.keys(CENSUS).filter((k) => !vivos.has(k))).toEqual([]);
  });

  it('todo `outbound_only` lleva `OUTBOUND_ONLY` (en el argumento o en la variable que nombra)', () => {
    const sinFiltro = SITES.filter((s) => CENSUS[s.key]?.[0] === O && !s.outboundFiltered).map((s) => `${s.key} (línea ${s.line})`);
    expect(sinFiltro).toEqual([]);
  });

  it('todo `inbound_only` lleva `INBOUND_ONLY` y ninguno lleva `OUTBOUND_ONLY` (BSD-1.3 punto 6)', () => {
    const mal = SITES.filter((s) => CENSUS[s.key]?.[0] === I && (!s.inboundFiltered || s.outboundFiltered)).map((s) => `${s.key} (línea ${s.line})`);
    expect(mal).toEqual([]);
  });

  it('`INBOUND_ONLY` solo aparece en sitios `inbound_only` (si lo lleva otro, su clase es otra: corrígela)', () => {
    expect(SITES.filter((s) => s.inboundFiltered && CENSUS[s.key]?.[0] !== I).map((s) => s.key)).toEqual([]);
  });

  it('el mínimo de BSD-1.3 punto 6: el lector de guías de entrada de `pnl()` ⇒ `inbound_only`', () => {
    expect(MINIMO_INBOUND_ONLY.filter((k) => CENSUS[k]?.[0] !== I)).toEqual([]);
  });

  it('ningún `all_kinds` ni `by_key` lleva `OUTBOUND_ONLY` (si lo lleva, su clase es otra: corrígela)', () => {
    const malClasificados = SITES.filter((s) => CENSUS[s.key] && CENSUS[s.key][0] !== O && s.outboundFiltered).map((s) => s.key);
    expect(malClasificados).toEqual([]);
  });

  it('todo `by_key` filtra por una llave (id, orderId, PaymentIntent, providerShipmentId, sellRequestId, userId)', () => {
    const KEY = /\b(id|ids|orderId|stripePaymentIntentId|providerShipmentId|sellRequestId|userId|shipmentId|shipmentIds|wids)\b/;
    const sinLlave = SITES.filter((s) => CENSUS[s.key]?.[0] === K && !KEY.test(s.text)).map((s) => s.key);
    expect(sinLlave).toEqual([]);
  });

  it('cada clasificación lleva su porqué (≥ 5 caracteres)', () => {
    expect(Object.entries(CENSUS).filter(([, [, why]]) => why.trim().length < 5).map(([k]) => k)).toEqual([]);
  });

  it('el mínimo del contrato: lista admin, cola de preparación y conteos, salida, tablero, P&L, reportes, AG-10, sondeo, cliente ⇒ `outbound_only`', () => {
    expect(MINIMO_OUTBOUND_ONLY.filter((k) => CENSUS[k]?.[0] !== O)).toEqual([]);
  });

  it('el mínimo del contrato: candado de cuenta, `rate_already_purchased`, `takenBy`, job de proceso, recuperación, huérfanas ⇒ `all_kinds`', () => {
    expect(MINIMO_ALL_KINDS.filter((k) => CENSUS[k]?.[0] !== A)).toEqual([]);
  });
});
