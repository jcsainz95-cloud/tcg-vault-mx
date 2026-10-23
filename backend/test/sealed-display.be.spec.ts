/**
 * sealed-display.be.spec.ts — ARCHITECTURE §4.34a.2 / §5.2.6-D (v1.94 + errata v1.94.1⟨sellado-display⟩).
 *
 * EL BUG: un producto SELLADO se pinta como su carta ANCLA (ej. «Exeggcute») en la preparación,
 * el acta del pedido y el correo de confirmación, porque las superficies leen `item.card.name` sin
 * rama de sellado. La pieza reservada ES la sellada (`sealedProductId`/`sealedProductName` poblados,
 * `productType='sealed'`); es solo display.
 *
 * Este archivo fija el cuerpo PURO y las PROYECCIONES server-side que lo consumen:
 *   (i)   la preparación devuelve el `SealedProduct.name` y NO el `card.name` del ancla;
 *   (ii)  el resolutor único `pieceDisplayIdentityOf` nunca pinta el ancla para el nombre de un
 *         sellado — sin nombre resoluble pinta «Sellado sin identificar», jamás «Exeggcute»;
 *         la IMAGEN sí cae al ancla (clase P, aceptado §5.2.6).
 *   (iii) `cardSnapshot` congela la identidad CORRECTA del sellado.
 *
 * ⭐ v1.94.1 — añade los TRES escapes que QA/techlead cazaron sobre `b70e272` (accesos ALIASEADOS que el
 *   `grep '\.card\.name'` no vio), ejercitados sobre el CUERPO REAL de cada servicio (método privado, sin
 *   mocks de la lógica): `toClientShipmentItem` (§5, BLOQUEANTE), la imagen del tracking de invitado (§4-G)
 *   y la tarjeta del correo AV-12 (`refund-ledger`). La corrida de punta a punta BD/HTTP del flujo completo
 *   (checkout→preparación→`/orders/:id`→rastreo cliente+invitado→AV-12) vive en la suite de integración
 *   `test/integration/sealed-display-flow.e2e-spec.ts` (entregada en este cambio; QA la ejecuta en el gate).
 */
import { pieceDisplayIdentityOf, UNIDENTIFIED_SEALED_NAME } from '../src/common/piece-display-identity';
import { preparationCardOf } from '../src/modules/shipments/preparation-view';
import { OrdersService } from '../src/modules/orders/orders.service';
import { ShipmentsService } from '../src/modules/shipments/shipments.service';
import { GuestCheckoutService } from '../src/modules/orders/guest-checkout.service';
import { FROZEN_CARD_FACT_KEYS } from '../src/modules/orders/order-item-card';

// Ancla del set — el single «Exeggcute» que el bug pintaba para el sellado.
const ANCLA = { name: 'Exeggcute', number: '2', imageSmallUrl: 'http://img/exeggcute.png', set: { name: 'Obsidian Flames' } };

// Pieza SELLADA bien capturada: su identidad de sellado está poblada (snapshot por-pieza M-37).
const sealedPiece = (over: Record<string, unknown> = {}) => ({
  productType: 'sealed' as const,
  finish: 'normal' as const,
  gradingCompany: null,
  gradeValue: null,
  rawCondition: null,
  sealedCondition: 'mint' as const,
  sealedProductId: 'sp_1',
  sealedProductName: 'Obsidian Flames Elite Trainer Box',
  sealedImageUrl: 'http://img/etb.jpg',
  card: ANCLA,
  ...over,
});

describe('§5.2.6-D (i) — preparationCardOf pinta el SELLADO, no el ancla', () => {
  it('sellado con snapshot ⇒ nombre del SealedProduct, NO «Exeggcute»', () => {
    const dto = preparationCardOf(sealedPiece());
    expect(dto.name).toBe('Obsidian Flames Elite Trainer Box');
    expect(dto.name).not.toBe('Exeggcute');
  });

  it('sellado SIN nombre resoluble ⇒ «Sellado sin identificar», JAMÁS el ancla', () => {
    const dto = preparationCardOf(sealedPiece({ sealedProductId: null, sealedProductName: null, sealedImageUrl: null }));
    expect(dto.name).toBe(UNIDENTIFIED_SEALED_NAME);
    expect(dto.name).not.toBe('Exeggcute');
  });

  it('no-sellado (raw) ⇒ el nombre del single, exactamente como hoy', () => {
    const dto = preparationCardOf({
      productType: 'raw' as const,
      finish: 'normal' as const,
      gradingCompany: null,
      gradeValue: null,
      rawCondition: 'NM' as const,
      sealedCondition: null,
      sealedProductId: null,
      sealedProductName: null,
      sealedImageUrl: null,
      card: ANCLA,
    });
    expect(dto.name).toBe('Exeggcute');
  });
});

describe('§4.34a.2 — pieceDisplayIdentityOf (resolutor único, puro)', () => {
  it('sellado vivo (sealedProduct unido) manda sobre el snapshot y sobre el ancla', () => {
    const r = pieceDisplayIdentityOf({
      productType: 'sealed',
      card: ANCLA,
      sealedProductId: 'sp_1',
      sealedProductName: 'nombre viejo del snapshot',
      sealedImageUrl: 'http://img/snap.jpg',
      sealedProduct: { name: 'ETB Pitch Black', imageUrl: 'http://img/live.jpg' },
    });
    expect(r.isSealed).toBe(true);
    expect(r.name).toBe('ETB Pitch Black');
    expect(r.name).not.toBe('Exeggcute');
  });

  it('sellado sin vivo ⇒ snapshot sealedProductName; nunca el ancla', () => {
    const r = pieceDisplayIdentityOf({
      productType: 'sealed',
      card: ANCLA,
      sealedProductId: 'sp_1',
      sealedProductName: 'Obsidian Flames Elite Trainer Box',
      sealedImageUrl: 'http://img/etb.jpg',
    });
    expect(r.name).toBe('Obsidian Flames Elite Trainer Box');
    expect(r.name).not.toBe('Exeggcute');
    expect(r.imageSmallUrl).toBe('http://img/etb.jpg');
  });

  it('sellado sin nombre ⇒ «Sellado sin identificar»; la IMAGEN sí cae al ancla (clase P)', () => {
    const r = pieceDisplayIdentityOf({
      productType: 'sealed',
      card: ANCLA,
      sealedProductId: null,
      sealedProductName: null,
      sealedImageUrl: null,
    });
    expect(r.name).toBe(UNIDENTIFIED_SEALED_NAME);
    expect(r.name).not.toBe('Exeggcute');
    // La imagen del ancla es la cola aceptada (§5.2.6); solo el NOMBRE jamás cae al ancla.
    expect(r.imageSmallUrl).toBe('http://img/exeggcute.png');
  });

  it('sellado con nombre en blanco se trata como ausente (money-safe): «Sellado sin identificar»', () => {
    const r = pieceDisplayIdentityOf({
      productType: 'sealed',
      card: ANCLA,
      sealedProductId: 'sp_1',
      sealedProductName: '   ',
      sealedImageUrl: null,
    });
    expect(r.name).toBe(UNIDENTIFIED_SEALED_NAME);
  });

  it('no-sellado ⇒ card.name / card.imageSmallUrl, isSealed=false', () => {
    const r = pieceDisplayIdentityOf({
      productType: 'raw',
      card: ANCLA,
      sealedProductId: null,
      sealedProductName: null,
    });
    expect(r.isSealed).toBe(false);
    expect(r.name).toBe('Exeggcute');
    expect(r.imageSmallUrl).toBe('http://img/exeggcute.png');
  });
});

describe('§5.2.6-D (ii) — cardSnapshot congela la identidad CORRECTA del sellado', () => {
  // cardSnapshot es puro: no toca ninguna dependencia, así que el servicio se arma con nulls.
  const svc = new OrdersService(null as never, null as never, null as never, null as never, null as never);
  const snapshot = (over: Record<string, unknown> = {}) =>
    (svc as unknown as { cardSnapshot: (i: unknown) => Record<string, unknown> }).cardSnapshot({
      cardId: 'c1',
      productType: 'sealed',
      rawCondition: null,
      gradingCompany: null,
      gradeValue: null,
      sealedProductId: 'sp_1',
      sealedProductName: 'Obsidian Flames Elite Trainer Box',
      sealedImageUrl: 'http://img/etb.jpg',
      card: { name: 'Exeggcute', number: '2', set: { name: 'Obsidian Flames' } },
      ...over,
    });

  it('sellado ⇒ `name` del SealedProduct (no el ancla), + sealedProductId + productType', () => {
    const snap = snapshot();
    expect(snap.name).toBe('Obsidian Flames Elite Trainer Box');
    expect(snap.name).not.toBe('Exeggcute');
    expect(snap.sealedProductId).toBe('sp_1');
    expect(snap.sealedProductName).toBe('Obsidian Flames Elite Trainer Box');
    expect(snap.productType).toBe('sealed');
    // `cardId`/`number` del ancla SE CONSERVAN (pertenencia al set + cola de la cascada).
    expect(snap.cardId).toBe('c1');
    expect(snap.number).toBe('2');
  });

  it('sellado legado sin nombre ⇒ `name` = «Sellado sin identificar», sealedProductId: null, sin sealedProductName', () => {
    const snap = snapshot({ sealedProductId: null, sealedProductName: null, sealedImageUrl: null });
    expect(snap.name).toBe(UNIDENTIFIED_SEALED_NAME);
    expect(snap.name).not.toBe('Exeggcute');
    expect(snap.sealedProductId).toBeNull();
    // ⛔ nunca se congela la copia display como si fuera un hecho de la compra.
    expect('sealedProductName' in snap).toBe(false);
  });

  it('no-sellado ⇒ `name` del ancla y SIN claves de sellado (ausentes en raw/graded)', () => {
    const snap = snapshot({ productType: 'raw', rawCondition: 'NM', sealedProductId: null, sealedProductName: null });
    expect(snap.name).toBe('Exeggcute');
    expect('sealedProductId' in snap).toBe(false);
    expect('sealedProductName' in snap).toBe(false);
  });

  it('la allowlist de hechos congelados trae las dos claves de sellado (candado §5.2.6)', () => {
    expect(FROZEN_CARD_FACT_KEYS).toContain('sealedProductId');
    expect(FROZEN_CARD_FACT_KEYS).toContain('sealedProductName');
  });
});

// ============================================================================
// v1.94.1⟨sellado-display⟩ — LOS TRES ESCAPES, sobre el CUERPO REAL del servicio.
// Cada servicio se arma con `null` en sus dependencias: las proyecciones de display que probamos
// son PURAS (no tocan Prisma/Nest), así que el método privado corre tal cual en producción.
// ============================================================================

describe('§4.34a.2(E) escape #1 — toClientShipmentItem (ClientShipmentItemDTO §5, BLOQUEANTE)', () => {
  const svc = new ShipmentsService(null as never, null as never, null as never);
  const toItem = (si: unknown) =>
    (svc as unknown as { toClientShipmentItem: (si: unknown, t?: Map<string, unknown>) => Record<string, any> }).toClientShipmentItem(si);

  const shipmentItem = (over: Record<string, unknown> = {}) => ({
    inventoryItemId: 'inv-1',
    refund: null,
    replacementCase: null,
    inventoryItem: {
      folio: 'INV-000456',
      finish: 'normal',
      productType: 'sealed',
      sealedProductId: 'sp_1',
      sealedProductName: 'Obsidian Flames Elite Trainer Box',
      sealedImageUrl: 'http://img/etb.jpg',
      card: { id: 'c1', name: 'Exeggcute', number: '2', imageSmallUrl: 'http://img/exeggcute.png', set: { name: 'Obsidian Flames' } },
      ...over,
    },
  });

  it('sellado ⇒ name/imagen del SealedProduct (nunca el ancla) + `productType` para que el front oculte `number`', () => {
    const dto = toItem(shipmentItem());
    expect(dto.productType).toBe('sealed');
    expect(dto.card.name).toBe('Obsidian Flames Elite Trainer Box');
    expect(dto.card.name).not.toBe('Exeggcute');
    expect(dto.card.imageSmallUrl).toBe('http://img/etb.jpg');
    expect(dto.card.imageSmallUrl).not.toBe('http://img/exeggcute.png');
    // `number` del ancla VIAJA (el front lo oculta por `productType`); `id` del ancla se conserva.
    expect(dto.card.number).toBe('2');
    expect(dto.card.id).toBe('c1');
  });

  it('sellado sin nombre resoluble ⇒ «Sellado sin identificar»; imagen cae al ancla (cola aceptada)', () => {
    const dto = toItem(shipmentItem({ sealedProductId: null, sealedProductName: null, sealedImageUrl: null }));
    expect(dto.card.name).toBe(UNIDENTIFIED_SEALED_NAME);
    expect(dto.card.name).not.toBe('Exeggcute');
    expect(dto.card.imageSmallUrl).toBe('http://img/exeggcute.png');
  });

  it('no-sellado (raw) ⇒ name/imagen del single, exactamente como hoy', () => {
    const dto = toItem(shipmentItem({ productType: 'raw', rawCondition: 'NM', sealedProductId: null, sealedProductName: null, sealedImageUrl: null }));
    expect(dto.productType).toBe('raw');
    expect(dto.card.name).toBe('Exeggcute');
    expect(dto.card.imageSmallUrl).toBe('http://img/exeggcute.png');
  });
});

describe('§4.34a.2(E) escape #2 — imagen del tracking de invitado (GuestTrackingItemDTO §4-G)', () => {
  const svc = new GuestCheckoutService(null as never, null as never, null as never, null as never, null as never, null as never);
  const track = (order: unknown) =>
    (svc as unknown as { toTrackingDto: (o: unknown, exp: Date) => Record<string, any> }).toTrackingDto(order, new Date(Date.now() + 3600_000));

  const guestOrder = (invOver: Record<string, unknown> = {}) => ({
    orderNumber: 'TCG-000123',
    status: 'settled',
    createdAt: new Date(),
    settledAt: new Date(),
    guestEmail: 'invitado@example.com',
    claimedAt: null,
    totalCents: 50000,
    subtotalCents: 40000,
    shippingFeeCents: 10000,
    ivaCents: 0,
    ivaRatePct: 16,
    processingFeeCents: 0,
    // QA-REL-1: el desglose del seguimiento exige la convención de la fila (no hay `??` por defecto).
    priceConvention: 'IVA_EXCLUSIVE',
    paymentMethodBrand: null,
    paymentMethodLast4: null,
    locale: 'es',
    shippingAddressSnapshot: { city: 'CDMX', state: 'CDMX', postalCode: '06600', recipientName: 'Juan Pérez', line1: 'x', phone: '5500000000', country: 'MX' },
    shipmentRequests: [],
    refunds: [],
    accessoryLines: [],
    items: [
      {
        unitPriceCents: 40000,
        refund: null,
        inventoryItem: {
          finish: 'normal',
          productType: 'sealed',
          rawCondition: null,
          sealedSubtype: 'etb',
          gradingCompany: null,
          gradeValue: null,
          sealedProductId: 'sp_1',
          sealedProductName: 'Obsidian Flames Elite Trainer Box',
          sealedImageUrl: 'http://img/etb.jpg',
          card: { name: 'Exeggcute', number: '2', imageSmallUrl: 'http://img/exeggcute.png', set: { name: 'Obsidian Flames' } },
          ...invOver,
        },
      },
    ],
  });

  it('sellado ⇒ el NOMBRE y la IMAGEN salen del resolutor (caja), NO del single ancla', () => {
    const dto = track(guestOrder());
    const it = dto.items[0];
    expect(it.productType).toBe('sealed');
    expect(it.name).toBe('Obsidian Flames Elite Trainer Box');
    expect(it.name).not.toBe('Exeggcute');
    // ⭐ el escape que QA cazó: la imagen caía al arte del single; ahora es la de la caja.
    expect(it.imageSmallUrl).toBe('http://img/etb.jpg');
    expect(it.imageSmallUrl).not.toBe('http://img/exeggcute.png');
  });

  it('sellado con `sealedImageUrl` ausente ⇒ la imagen cae al ancla (cola aceptada, clase P)', () => {
    const dto = track(guestOrder({ sealedImageUrl: null }));
    const it = dto.items[0];
    expect(it.name).toBe('Obsidian Flames Elite Trainer Box'); // el nombre sigue sin tocar el ancla
    expect(it.imageSmallUrl).toBe('http://img/exeggcute.png');
  });

  it('no-sellado ⇒ imagen del single, como hoy', () => {
    const dto = track(guestOrder({ productType: 'raw', rawCondition: 'NM', sealedProductId: null, sealedProductName: null, sealedImageUrl: null }));
    expect(dto.items[0].imageSmallUrl).toBe('http://img/exeggcute.png');
    expect(dto.items[0].name).toBe('Exeggcute');
  });
});

describe('§4.34a.2(E) escape #3 — tarjeta del correo AV-12 (refund-ledger, resolutor sobre `originalInventoryItem`)', () => {
  // El correo AV-12 nombra la carta del caso con `pieceDisplayIdentityOf(originalInventoryItem).name`
  // cuando no hay acta (`r.orderItem` null, caso de retiro). Esta es la MISMA llamada del servicio sobre
  // la MISMA forma que carga el `include` ensanchado de `:522`. El cruce BD/HTTP + render del correo vive
  // en la suite de integración; aquí se fija el contrato del resolutor para ese input.
  const originalInventoryItem = (over: Record<string, unknown> = {}) => ({
    productType: 'sealed' as const,
    sealedProductId: 'sp_1',
    sealedProductName: 'Obsidian Flames Elite Trainer Box',
    sealedImageUrl: 'http://img/etb.jpg',
    card: { name: 'Exeggcute', imageSmallUrl: 'http://img/exeggcute.png', set: { name: 'Obsidian Flames' } },
    ...over,
  });

  it('sellado ⇒ nombre del SealedProduct, NUNCA «Exeggcute»', () => {
    expect(pieceDisplayIdentityOf(originalInventoryItem()).name).toBe('Obsidian Flames Elite Trainer Box');
    expect(pieceDisplayIdentityOf(originalInventoryItem()).name).not.toBe('Exeggcute');
  });

  it('sellado sin nombre resoluble ⇒ «Sellado sin identificar», JAMÁS el ancla', () => {
    const name = pieceDisplayIdentityOf(originalInventoryItem({ sealedProductId: null, sealedProductName: null })).name;
    expect(name).toBe(UNIDENTIFIED_SEALED_NAME);
    expect(name).not.toBe('Exeggcute');
  });
});
