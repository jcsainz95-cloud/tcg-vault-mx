/**
 * limpieza-fixture.ts — la base de prueba de P-DB-LIMPIEZA (docs/specs/LIMPIEZA_DB.md §9, primer párrafo). Propiedad: backend.
 *
 * Al menos UNO de cada cosa que la spec enumera, con fechas fijas para que el «corte» de §4.4 sea comprobable:
 *  - O1 pedido `vault` liquidado y COLOCADO (P1, P4, P5) — P1 viene de A1 (plataforma) a C1 (custodia) ⇒ vuelve a A1;
 *    P1 tiene además un `move` de M1 ANTES del corte (se conserva) y otro DESPUÉS (se borra y se lista).
 *  - O2 `direct_ship` ENVIADO con guía Skydropx `ENV-000003` (intento -01, guía pagada cancelada, ajuste de costo,
 *    evento, cotización, corrección de dirección) — P2 enviada, P7 «Cinccino» dañada en preparación + reembolso parcial.
 *  - O3 de invitado con token, PENDIENTE, que RESERVA a P3 (estaba publicada).
 *  - Retiro ENV-000001 de P4 con caso «Por reponer» (dañada) reembolsado + SPEI re-emitido dos veces (MR1←MR2←MR3).
 *  - Caso de bóveda sobre P5 (perdida al preparar) REPUESTO con P11.
 *  - Disputa cerrada sobre P1.
 *  - Solicitud de venta PAGADA con pieza convertida P6 y bounty COMPLETADO; solicitud ACEPTADA con envío de entrada
 *    `buylist_inbound` con guía (M-72) — sin M-72, ese folio lo ocupa un retiro cancelado para que `ENV-000003` siga
 *    siendo el de O2.
 *  - Piezas reales fuera de toda prueba: P8 (perdida en M1), P9 (publicada), P10 (con ajuste de levantamiento).
 *  - C-5 / QA-1 (2.º pase): P12 nació de la solicitud PAGADA (buylist, con ajuste de levantamiento) y está en un pedido
 *    FALLIDO O4 que la apartó y la soltó: sigue `listed` en A2 con precio. Es a la vez «pieza de buylist en T» (P-1
 *    «borrar» con conteos ≠ 0) y el caso E2E-LST-0002 de QA (B la baja a `in_stock`; E tiene que devolverla a la venta).
 *  - Aviso de gasto, portafolio, bitácora, y lo que se CONSERVA (precio, dial, KYC con INE, eventos de Stripe…).
 *  v2 (§14.9, también se borra el inventario): un `SealedProduct` con precio del dueño e imagen y una pieza SELLADA (P14)
 *  con `sealedProductId`/`sealedImageUrl`; dos `InventoryBatch`; `PendingPriceEntry` de los CUATRO contextos (las de
 *  `inventory`/`portfolio` se borran, las de `catalog`/`buylist` se quedan); y custodia de DOS clientes: el comprador
 *  (P1, P4, P5, P11) y `client2` (P13, pedido de bóveda O5) — G-9 exige declararlos en `cuentas_prueba`.
 */
import { PrismaClient } from '@prisma/client';

const BASE = Date.parse('2026-09-01T12:00:00.000Z');
export const d = (days: number): Date => new Date(BASE + days * 24 * 3600 * 1000);

export interface Fixture {
  staff: string;
  buyer: string;
  seller: string;
  client2: string;
  email: { buyer: string; client2: string };
  loc: { A1: string; A2: string; C1: string; C2: string };
  piece: Record<'P1' | 'P2' | 'P3' | 'P4' | 'P5' | 'P6' | 'P7' | 'P8' | 'P9' | 'P10' | 'P11' | 'P12' | 'P13' | 'P14', { id: string; folio: string }>;
  orders: { O1: string; O2: string; O3: string; O4: string; O5: string };
  sealedProduct: string;
  directShipFolio: string;
  bounty: { completed: string; open: string; sellOnly: string };
}

export async function seedFixture(db: PrismaClient, opts: { m72: boolean }): Promise<Fixture> {
  const run = Math.random().toString(36).slice(2, 8);
  const staff = await db.user.create({ data: { email: `staff.${run}@lz.local`, name: 'Staff', role: 'super_admin', emailVerified: true } });
  const buyer = await db.user.create({ data: { email: `buyer.${run}@lz.local`, name: 'Comprador', role: 'customer', emailVerified: true } });
  const seller = await db.user.create({ data: { email: `seller.${run}@lz.local`, name: 'Vendedor', role: 'customer', emailVerified: true } });
  await db.kycProfile.create({ data: { userId: seller.id, ineFrontKey: `kyc/${seller.id}/front.jpg`, ineBackKey: `kyc/${seller.id}/back.jpg` } });
  await db.address.create({ data: { userId: buyer.id, recipientName: 'Comprador', line1: 'Calle 1', city: 'CDMX', state: 'CDMX', postalCode: '01000', phone: '5500000000' } as any });

  const set = await db.cardSet.create({ data: { externalId: `lz-set-${run}`, name: 'Set LZ' } });
  const card = async (k: string) =>
    db.card.create({ data: { externalId: `lz-${run}-${k}`, setId: set.id, name: k === 'G' ? 'Cinccino ex' : `Carta ${k}`, number: k } });
  const cards: Record<string, string> = {};
  for (const k of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L']) cards[k] = (await card(k)).id;
  await db.priceReference.create({
    data: { cardId: cards.A, productType: 'raw', gradeKey: 'raw:NM', source: 'manual', priceMxnCents: 12345, capturedDate: d(-1) } as any,
  });
  await db.configSetting.create({ data: { key: `lz.dial.${run}`, valueJson: { v: 1 } } });
  await db.pendingPriceEntry.create({ data: { cardId: cards.K, productType: 'raw', gradeKey: 'raw:NM', context: 'buylist', refId: 'sri-de-prueba' } });
  await db.processedStripeEvent.create({ data: { id: `evt_lz_${run}`, type: 'payment_intent.succeeded' } });
  await db.spendOwnerWatch.create({ data: { id: 1, ownerUserId: null, observedAt: d(-1) } });
  await db.spendDigestRun.create({ data: { day: d(-1), status: 'sent', alertCount: 1 } });

  const loc = async (zone: 'platform_stock' | 'customer_custody', box: string) =>
    (await db.vaultLocation.create({ data: { zone, box, row: '1', slot: '1', label: `${zone}-${box}` } })).id;
  const A1 = await loc('platform_stock', 'A1');
  const A2 = await loc('platform_stock', 'A2');
  const C1 = await loc('customer_custody', 'C1');
  const C2 = await loc('customer_custody', 'C2');

  const nextFolio = async () => {
    const [r] = await db.$queryRawUnsafe<{ n: bigint }[]>(`SELECT nextval('inventory_folio_seq') AS n`);
    return `INV-${String(Number(r.n)).padStart(6, '0')}`;
  };
  const nextOrder = async () => {
    const [r] = await db.$queryRawUnsafe<{ n: bigint }[]>(`SELECT nextval('order_number_seq') AS n`);
    return `TCG-${String(Number(r.n)).padStart(6, '0')}`;
  };
  const piece = async (cardKey: string, data: Record<string, unknown>) => {
    const folio = await nextFolio();
    const p = await db.inventoryItem.create({
      data: { folio, cardId: cards[cardKey], productType: 'raw', rawCondition: 'NM', acquisitionType: 'compra', acquisitionCostCents: 300, listPriceCents: 1000, ...data } as any,
    });
    await mv(p.id, { reason: 'alta', toStatus: 'in_stock', createdAt: d(-30) });
    return { id: p.id, folio };
  };
  const mv = (itemId: string, data: Record<string, unknown>) => db.inventoryMovement.create({ data: { itemId, ...data } as any });

  const owned = { ownerType: 'customer', ownerUserId: buyer.id, ownershipStatus: 'settled' };
  const P1 = await piece('A', { ...owned, status: 'in_custody', locationId: C1 });
  const P2 = await piece('B', { status: 'shipped' });
  const P3 = await piece('C', { status: 'listed', locationId: A2 });
  const P4 = await piece('D', { ...owned, status: 'damaged', locationId: C2 });
  const P5 = await piece('E', { ...owned, status: 'lost', locationId: C1 });
  const P7 = await piece('G', { status: 'damaged', locationId: A2 });
  const P8 = await piece('H', { status: 'lost', locationId: A1 });
  const P9 = await piece('I', { status: 'listed', locationId: A1 });
  const P10 = await piece('J', { status: 'in_stock' });
  const P11 = await piece('K', { ...owned, status: 'in_custody', locationId: C1 });

  // ---- O1: bóveda, liquidado y colocado
  const money = { subtotalCents: 3000, processingFeeCents: 100, ivaCents: 0, totalCents: 3100, priceConvention: 'IVA_INCLUSIVE' as const };
  const snap = { name: 'x' };
  const O1 = await db.order.create({
    data: { userId: buyer.id, orderNumber: await nextOrder(), fulfillmentMode: 'vault', status: 'settled', createdAt: d(0), settledAt: d(0), paymentMethodLast4: '4242', ...money },
  });
  const OI1 = await db.orderItem.create({ data: { orderId: O1.id, inventoryItemId: P1.id, cardSnapshot: snap, unitPriceCents: 1000 } });
  const OI4 = await db.orderItem.create({ data: { orderId: O1.id, inventoryItemId: P4.id, cardSnapshot: snap, unitPriceCents: 1000 } });
  const OI5 = await db.orderItem.create({ data: { orderId: O1.id, inventoryItemId: P5.id, cardSnapshot: snap, unitPriceCents: 1000 } });
  for (const p of [P1, P4, P5]) {
    await mv(p.id, { reason: 'sale', fromStatus: 'listed', toStatus: 'reserved', createdAt: d(0) });
    await mv(p.id, { reason: 'settle', fromStatus: 'reserved', toStatus: 'in_custody', createdAt: d(0) });
  }
  // P1: un `move` real de M1 ANTES del corte (se conserva), la colocación (se borra) y un `move` de M1 DESPUÉS (se borra).
  await mv(P1.id, { reason: 'move', fromLocationId: A2, toLocationId: A1, note: 'M1 · reacomodo', createdAt: d(-5) });
  await mv(P1.id, { reason: 'move', fromLocationId: A1, toLocationId: C1, fromStatus: 'in_custody', toStatus: 'in_custody', note: `colocación en bóveda · ${O1.orderNumber}`, createdAt: d(1) });
  await mv(P1.id, { reason: 'move', fromLocationId: C2, toLocationId: C1, note: 'M1 · ajuste de cajón', createdAt: d(5) });
  await mv(P5.id, { reason: 'lost', fromStatus: 'in_custody', toStatus: 'lost', note: `${O1.orderNumber} · no salió al preparar (not_found) · caso`, createdAt: d(1) });

  const VP1 = await db.vaultPlacement.create({
    data: { orderId: O1.id, status: 'placed', createdAt: d(0), preparedAt: d(1), preparedByUserId: staff.id, placedAt: d(1), placedByUserId: staff.id, locationId: C1 },
  });
  const picked = { prepStatus: 'picked' as const, prepMarkedAt: d(1), prepMarkedByUserId: staff.id };
  await db.vaultPlacementItem.create({ data: { placementId: VP1.id, orderItemId: OI1.id, inventoryItemId: P1.id, ...picked } });
  await db.vaultPlacementItem.create({ data: { placementId: VP1.id, orderItemId: OI4.id, inventoryItemId: P4.id, ...picked } });
  const VPI5 = await db.vaultPlacementItem.create({
    data: { placementId: VP1.id, orderItemId: OI5.id, inventoryItemId: P5.id, prepStatus: 'missing', missingReason: 'not_found', prepMarkedAt: d(1), prepMarkedByUserId: staff.id },
  });
  await db.replacementCase.create({
    data: {
      source: 'vault_purchase', placementItemId: VPI5.id, customerUserId: buyer.id, originalInventoryItemId: P5.id, missingReason: 'not_found',
      originOrderItemId: OI5.id, openedAt: d(1), openedByUserId: staff.id, status: 'replaced', resolvedAt: d(2), resolvedByUserId: staff.id,
      replacementInventoryItemId: P11.id,
    },
  });
  await mv(P11.id, { reason: 'replacement', fromStatus: 'in_stock', toStatus: 'in_custody', note: 'reposición', createdAt: d(2) });
  await db.dispute.create({
    data: { userId: buyer.id, inventoryItemId: P1.id, orderItemId: OI1.id, status: 'rechazada', description: 'no era NM', deadlineAt: d(10), createdAt: d(6), resolvedAt: d(7) },
  });

  // ---- Envíos: ENV-000001 (retiro de P4), ENV-000002 (entrada del buylist / relleno), ENV-000003 (directo de O2)
  const addr = { recipientName: 'Comprador', line1: 'Calle 1', city: 'CDMX', state: 'CDMX', postalCode: '01000', country: 'MX', phone: '5500000000' };
  const SR1 = await db.shipmentRequest.create({
    data: { userId: buyer.id, addressSnapshot: addr, status: 'enviado', shippingFeeCents: 15000, priceConvention: 'IVA_INCLUSIVE', requestedAt: d(3) },
  });
  const SI4 = await db.shipmentItem.create({
    data: { shipmentRequestId: SR1.id, inventoryItemId: P4.id, prepStatus: 'missing', missingReason: 'damaged', prepMarkedAt: d(3), prepMarkedByUserId: staff.id },
  });
  await mv(P4.id, { reason: 'damaged', fromStatus: 'in_custody', toStatus: 'damaged', note: `${SR1.folio} · no salió al preparar (damaged) · caso`, createdAt: d(3) });
  const RC1 = await db.replacementCase.create({
    data: {
      source: 'withdrawal', shipmentItemId: SI4.id, shipmentRequestId: SR1.id, customerUserId: buyer.id, originalInventoryItemId: P4.id, missingReason: 'damaged',
      originOrderItemId: OI4.id, openedAt: d(3), openedByUserId: staff.id, status: 'refunded', resolvedAt: d(4), resolvedByUserId: staff.id,
      refundAmountCents: 1000, refundReason: 'dañada', refundPaidRefCents: 1000, refundAboveRefConfirmed: false,
    },
  });
  const refundBase = { requestedByUserId: staff.id, requestedByRole: 'super_admin' as const, shippingCents: 0, shippingIvaCents: 0, merchandiseIvaCents: 0 };
  await db.paymentRefund.create({
    data: {
      ...refundBase, idempotencyKey: `case:${RC1.id}`, kind: 'case_refund', status: 'succeeded', stripeRefundId: `re_case_${run}`, orderId: O1.id,
      orderItemId: OI4.id, replacementCaseId: RC1.id, amountCents: 600, merchandiseCents: 600, processingFeeCents: 0,
    },
  });
  const mr = { source: 'case_excess' as const, customerUserId: buyer.id, replacementCaseId: RC1.id, amountCents: 400, merchandiseCents: 400, merchandiseIvaCents: 0, processingFeeCents: 0, compensationCents: 0, createdByUserId: staff.id };
  const cancelled = { status: 'cancelled' as const, cancelledAt: d(5), cancelledByUserId: staff.id, cancelNote: 'CLABE errónea' };
  const MR1 = await db.manualRefund.create({ data: { ...mr, ...cancelled, idempotencyKey: `mr1:${run}` } });
  const MR2 = await db.manualRefund.create({ data: { ...mr, ...cancelled, idempotencyKey: `reissue:${MR1.id}`, reissuedFromId: MR1.id } });
  await db.manualRefund.create({ data: { ...mr, status: 'pending', idempotencyKey: `reissue:${MR2.id}`, reissuedFromId: MR2.id } });

  // Buylist: pagada (pieza P6 convertida, bounty completado) y aceptada (envío de entrada con guía, M-72).
  const paidReq = await db.sellRequest.create({ data: { userId: seller.id, status: 'pagada', paidAt: d(-5), createdAt: d(-10) } });
  const sri = await db.sellRequestItem.create({ data: { sellRequestId: paidReq.id, cardId: cards.F, productType: 'raw', rawCondition: 'NM' } });
  const P6folio = await nextFolio();
  const P6row = await db.inventoryItem.create({
    data: { folio: P6folio, cardId: cards.F, productType: 'raw', rawCondition: 'NM', acquisitionType: 'buylist', acquisitionCostCents: 500, listPriceCents: 1200, status: 'listed', locationId: A1, sourceSellRequestItemId: sri.id },
  });
  await db.sellRequestItem.update({ where: { id: sri.id }, data: { inventoryItemId: P6row.id } });
  await mv(P6row.id, { reason: 'buylist_convert', toStatus: 'in_stock', createdAt: d(-4) });
  const P6 = { id: P6row.id, folio: P6folio };
  // P12 (C-5): segunda línea de la solicitud pagada, convertida, con un levantamiento; entra a T por el pedido fallido O4.
  const sri2 = await db.sellRequestItem.create({ data: { sellRequestId: paidReq.id, cardId: cards.L, productType: 'raw', rawCondition: 'NM' } });
  const P12folio = await nextFolio();
  const P12row = await db.inventoryItem.create({
    data: { folio: P12folio, cardId: cards.L, productType: 'raw', rawCondition: 'NM', acquisitionType: 'buylist', acquisitionCostCents: 450, listPriceCents: 1100, status: 'listed', locationId: A2, sourceSellRequestItemId: sri2.id },
  });
  await db.sellRequestItem.update({ where: { id: sri2.id }, data: { inventoryItemId: P12row.id } });
  await mv(P12row.id, { reason: 'buylist_convert', toStatus: 'in_stock', createdAt: d(-4) });
  await db.inventoryAdjustment.create({ data: { inventoryItemId: P12row.id, reason: 'encontrada', fromStatus: 'in_stock', toStatus: 'in_stock', note: 'levantamiento' } as any });
  const P12 = { id: P12row.id, folio: P12folio };
  const accReq = await db.sellRequest.create({ data: { userId: seller.id, status: 'aceptada', acceptedAt: d(4), createdAt: d(2) } });
  await db.sellRequestItem.create({ data: { sellRequestId: accReq.id, cardId: cards.F, productType: 'raw', rawCondition: 'NM' } });
  if (opts.m72) {
    await db.shipmentRequest.create({
      data: {
        kind: 'buylist_inbound', sellRequestId: accReq.id, userId: null, orderId: null, addressSnapshot: addr, status: 'guia', shippingFeeCents: 0,
        priceConvention: 'IVA_INCLUSIVE', labelSource: 'manual', carrier: 'DHL', trackingNumber: `IN-${run}`, requestedAt: d(4),
      } as any,
    });
  } else {
    await db.shipmentRequest.create({ data: { userId: buyer.id, addressSnapshot: addr, status: 'cancelado', shippingFeeCents: 0, priceConvention: 'IVA_INCLUSIVE', requestedAt: d(4) } });
  }

  // ---- O2: directo, enviado con guía Skydropx, P7 dañada al preparar con reembolso parcial
  const O2 = await db.order.create({
    data: { userId: buyer.id, orderNumber: await nextOrder(), fulfillmentMode: 'direct_ship', shippingAddressSnapshot: addr, status: 'settled', createdAt: d(1), settledAt: d(1), paymentMethodLast4: '4242', ...money },
  });
  const OI2 = await db.orderItem.create({ data: { orderId: O2.id, inventoryItemId: P2.id, cardSnapshot: snap, unitPriceCents: 1000 } });
  const OI7 = await db.orderItem.create({ data: { orderId: O2.id, inventoryItemId: P7.id, cardSnapshot: snap, unitPriceCents: 1000 } });
  void OI2;
  await mv(P2.id, { reason: 'sale', fromStatus: 'listed', toStatus: 'picking', createdAt: d(1) });
  await mv(P2.id, { reason: 'withdrawal', fromStatus: 'picking', toStatus: 'shipped', createdAt: d(2) });
  await mv(P7.id, { reason: 'sale', fromStatus: 'listed', toStatus: 'picking', createdAt: d(1) });
  await mv(P7.id, { reason: 'damaged', fromStatus: 'picking', toStatus: 'damaged', note: `${O2.orderNumber} · no salió al preparar (damaged) · reembolso`, createdAt: d(2) });
  const SR3 = await db.shipmentRequest.create({
    data: {
      userId: buyer.id, orderId: O2.id, addressSnapshot: addr, status: 'enviado', shippingFeeCents: 9900, shippingCostCents: 12000, priceConvention: 'IVA_INCLUSIVE',
      requestedAt: d(1), shippedAt: d(2), labelSource: 'skydropx', providerShipmentId: `sdx-old-${run}`, providerRateId: 'rate-1', chosenRateJson: { priceCents: 12000 },
      rateChosenByUserId: staff.id, rateChosenAt: d(2), labelPurchasedAt: d(2), packageCode: 'box', declaredValueCents: 1000, insuredValueCents: 1000,
      carrier: 'fedex', trackingNumber: `TRK-${run}`, addressVersion: 1, addressCorrectedAt: d(1), addressCorrectedByUserId: staff.id,
      carrierStatus: 'in_transit', carrierStatusAt: d(3),
    },
  });
  if (SR3.folio !== 'ENV-000003') throw new Error(`fixture: el envío directo debía ser ENV-000003 y es ${SR3.folio}`);
  await db.shipmentItem.create({ data: { shipmentRequestId: SR3.id, inventoryItemId: P2.id, ...picked } });
  const SI7 = await db.shipmentItem.create({
    data: { shipmentRequestId: SR3.id, inventoryItemId: P7.id, prepStatus: 'missing', missingReason: 'damaged', prepMarkedAt: d(2), prepMarkedByUserId: staff.id },
  });
  await db.paymentRefund.create({
    data: {
      ...refundBase, idempotencyKey: `item:${SI7.id}`, kind: 'item_missing', status: 'succeeded', stripeRefundId: `re_item_${run}`, orderId: O2.id,
      orderItemId: OI7.id, shipmentItemId: SI7.id, missingReason: 'damaged', amountCents: 1100, merchandiseCents: 1000, processingFeeCents: 100,
    },
  });
  const LA3 = await db.shipmentLabelAttempt.create({
    data: {
      shipmentRequestId: SR3.id, since: d(2), actorUserId: staff.id, capExempt: true, rateId: 'rate-1', carrierName: 'fedex', expectedChargeCents: 12000,
      marginCents: 0, attemptNo: 1, providerReference: `${SR3.folio}-01`, sentAt: d(2), outcome: 'labeled', outcomeAt: d(2),
    },
  });
  await db.shipmentPaidLabel.create({
    data: { providerShipmentId: `sdx-old-${run}`, shipmentRequestId: SR3.id, attemptId: LA3.id, origin: 'response', chargedCents: 12000, cancelledAt: d(5), cancelKind: 'auto_close' },
  });
  await db.shipmentCostAdjustment.create({
    data: { shipmentRequestId: SR3.id, kind: 'overweight', providerChargeId: `ch-${run}`, providerChargeType: 'overweight', amountCents: 500, ivaSource: 'provider', chargedAt: d(3) },
  });
  await db.shipmentCarrierEvent.create({ data: { shipmentRequestId: SR3.id, providerShipmentId: `sdx-old-${run}`, status: 'in_transit', occurredAt: d(3), providerEventKey: 'k1' } });
  await db.shipmentQuote.create({
    data: {
      shipmentRequestId: SR3.id, providerQuotationId: 'q-1', requestedByUserId: staff.id, requestedAt: d(2), expiresAt: d(3), packageCode: 'box', packageDimsJson: {},
      declaredValueCents: 1000, insuredValueCents: 1000, insuranceEchoOk: true, addressVersion: 1, ratesJson: [],
    },
  });
  await db.shipmentAddressRevision.create({
    data: { shipmentRequestId: SR3.id, fromVersion: 0, changedKeys: ['line1'], before: { line1: 'a' }, after: { line1: 'b' }, correctedByUserId: staff.id },
  });

  // ---- O3: invitado, pendiente, con token; reserva P3
  const O3 = await db.order.create({
    data: { guestEmail: `guest.${run}@lz.local`, orderNumber: await nextOrder(), fulfillmentMode: 'direct_ship', shippingAddressSnapshot: addr, status: 'pending', createdAt: d(2), ...money },
  });
  await db.orderItem.create({ data: { orderId: O3.id, inventoryItemId: P3.id, cardSnapshot: snap, unitPriceCents: 1000 } });
  await db.orderAccessToken.create({ data: { orderId: O3.id, tokenHash: `h-${run}`, expiresAt: d(30) } });
  await db.inventoryItem.update({ where: { id: P3.id }, data: { status: 'reserved', reservedByOrderId: O3.id, reservedUntil: d(3) } });

  // ---- O4 (C-5 / QA-1): pedido FALLIDO que apartó P12 y la soltó (`reserved → listed`); la pieza sigue a la venta.
  const O4 = await db.order.create({
    data: { userId: buyer.id, orderNumber: await nextOrder(), fulfillmentMode: 'vault', status: 'failed', createdAt: d(6), ...money },
  });
  await db.orderItem.create({ data: { orderId: O4.id, inventoryItemId: P12.id, cardSnapshot: snap, unitPriceCents: 1100 } });
  await mv(P12.id, { reason: 'sale', fromStatus: 'listed', toStatus: 'reserved', note: `${O4.orderNumber} · apartado`, createdAt: d(6) });

  // ---- Piezas reales: P8 perdida en M1 (no es de prueba), P10 con levantamiento
  await mv(P8.id, { reason: 'lost', fromStatus: 'in_stock', toStatus: 'lost', note: 'M1 · no se encontró', createdAt: d(4) });
  await mv(P10.id, { reason: 'adjustment', fromStatus: 'damaged', toStatus: 'in_stock', note: 'levantamiento', createdAt: d(4) });
  await db.inventoryAdjustment.create({ data: { inventoryItemId: P10.id, reason: 'encontrada', fromStatus: 'damaged', toStatus: 'in_stock', note: 'levantamiento' } as any });

  // ---- v2 (§14.9): custodia de un 2.º cliente (pedido de bóveda O5 → P13 en C2)
  const client2 = await db.user.create({ data: { email: `cliente2.${run}@lz.local`, name: 'Cliente Dos', role: 'customer', emailVerified: true } });
  const P13 = await piece('E', { ownerType: 'customer', ownerUserId: client2.id, ownershipStatus: 'settled', status: 'in_custody', locationId: C2 });
  const O5 = await db.order.create({
    data: { userId: client2.id, orderNumber: await nextOrder(), fulfillmentMode: 'vault', status: 'settled', createdAt: d(7), settledAt: d(7), paymentMethodLast4: '4242', ...money },
  });
  await db.orderItem.create({ data: { orderId: O5.id, inventoryItemId: P13.id, cardSnapshot: snap, unitPriceCents: 1000 } });
  await mv(P13.id, { reason: 'sale', fromStatus: 'listed', toStatus: 'reserved', createdAt: d(7) });
  await mv(P13.id, { reason: 'settle', fromStatus: 'reserved', toStatus: 'in_custody', createdAt: d(7) });

  // ---- v2: sellado (producto con precio del dueño e imagen; pieza con su copia de la imagen), lotes y la cola de precio
  const sp = await db.sealedProduct.create({
    data: {
      setId: set.id, tcgplayerProductId: 900_000_000 + Math.floor(Math.random() * 99_999_999), tcgplayerGroupId: 1, name: 'ETB LZ', subtype: 'etb',
      imageUrl: 'https://tcgplayer-cdn.tcgplayer.com/product/lz_200w.jpg', ownerDisplayPriceCents: 159900,
    },
  });
  const P14 = await piece('A', {
    productType: 'sealed', rawCondition: null, sealedSubtype: 'etb', sealedCondition: 'mint', sealedProductId: sp.id, sealedImageUrl: sp.imageUrl,
    sealedProductName: sp.name, status: 'listed', locationId: A1, listPriceCents: 159900,
  });
  await db.inventoryBatch.create({ data: { id: `batch-${run}-1`, kind: 'create', requested: 1, createdItems: 1, failedLines: 0, resultJson: { items: [{ id: P9.id, folio: P9.folio }] } } });
  await db.inventoryBatch.create({ data: { id: `batch-${run}-2`, kind: 'publish', requested: 1, createdItems: 0, failedLines: 0, resultJson: { folios: [P14.folio] } } });
  await db.pendingPriceEntry.create({ data: { cardId: cards.J, productType: 'raw', gradeKey: 'raw:NM', context: 'catalog' } });
  await db.pendingPriceEntry.create({ data: { cardId: cards.I, productType: 'raw', gradeKey: 'raw:NM', context: 'inventory' } });
  await db.pendingPriceEntry.create({ data: { cardId: cards.H, productType: 'raw', gradeKey: 'raw:NM', context: 'inventory', reason: 'no_market' } });
  await db.pendingPriceEntry.create({ data: { cardId: cards.A, productType: 'sealed', gradeKey: 'sealed', context: 'inventory', sealedProductId: sp.id } });
  await db.pendingPriceEntry.create({ data: { cardId: cards.D, productType: 'raw', gradeKey: 'raw:NM', context: 'portfolio' } });

  // ---- Bounties
  const bCompleted = await db.variantPriceOverride.create({
    data: { cardId: cards.F, bountyEnabled: false, bountyPriceCents: 900, bountyTargetQty: 1, bountyAcquiredQty: 1, bountyCompletedAt: d(-5) },
  });
  const bOpen = await db.variantPriceOverride.create({ data: { cardId: cards.A, bountyEnabled: true, bountyPriceCents: 800, bountyTargetQty: 5, bountyAcquiredQty: 2 } });
  const bSell = await db.variantPriceOverride.create({ data: { cardId: cards.B, sellOverrideCents: 1500 } });

  // ---- Aviso de gasto, portafolio, bitácora
  await db.spendAlert.create({
    data: { kind: 'label_charged_unexplained', severity: 'immediate', dedupKey: `ag9:${run}`, facts: {}, mailStatus: 'sent', shipmentRequestId: SR3.id },
  });
  await db.portfolioSnapshot.create({ data: { userId: buyer.id, asOfDate: d(5), totalValueMxnCents: 3000 } });
  for (const action of ['order.settled', 'shipment.label_purchased', 'settings.updated']) {
    await db.auditLog.create({ data: { actorUserId: staff.id, actorRole: 'super_admin', action, entityType: 'X', entityId: run, createdAt: d(3) } });
  }

  return {
    staff: staff.id,
    buyer: buyer.id,
    seller: seller.id,
    client2: client2.id,
    email: { buyer: buyer.email!, client2: client2.email! },
    loc: { A1, A2, C1, C2 },
    piece: { P1, P2, P3, P4, P5, P6, P7, P8, P9, P10, P11, P12, P13, P14 },
    orders: { O1: O1.id, O2: O2.id, O3: O3.id, O4: O4.id, O5: O5.id },
    sealedProduct: sp.id,
    directShipFolio: SR3.folio,
    bounty: { completed: bCompleted.id, open: bOpen.id, sellOnly: bSell.id },
  };
}
