/**
 * AC-B60 (parte pura): `OrderAccessoryLineDTO` con las llaves EXACTAS de §AC.19.6 (lista blanca, ⛔ `spread`), la foto
 * VIGENTE (§AC.19.1, AC-B55) y el paquete con `photo: null`. 💰 Los importes por cantidad (`amountByQtyCents`, §AC.9 /
 * §AC.12) y la vista `deliveredRefund` de M3 (§AC.12 v1.86.2) salen del mismo cuerpo `itemMissingRefundComponents`.
 */
import { itemMissingRefundComponents } from '../src/common/money';
import {
  AccessoryLineReadRow,
  AccessoryRefundOrderMoney,
  accessoryAmountByQtyCents,
  accessoryDeliveredRefundOf,
  accessoryMailLinesOf,
  toOrderAccessoryLineDTO,
} from '../src/modules/orders/accessory-lines-view';
import { guestOrderConfirmationTemplate } from '../src/modules/orders/mail/guest-order.templates';
import { orderSettledTemplate } from '../src/modules/orders/mail/order-notice.templates';

const ORDER: AccessoryRefundOrderMoney = {
  status: 'settled',
  priceConvention: 'IVA_INCLUSIVE',
  subtotalCents: 80000,
  shippingFeeCents: 15000,
  processingFeeCents: 4617,
  ivaCents: 13103,
  ivaRatePct: 16,
  totalCents: 99617,
};

const accessoryRow = (over: Partial<AccessoryLineReadRow> = {}): AccessoryLineReadRow => ({
  id: 'line-1',
  kind: 'accessory',
  quantity: 3,
  unitPriceCents: 8900,
  refundedQty: 1,
  snapshot: { name: 'Penny sleeves', category: 'sleeves', energyType: null, photoVersion: 'aaaaaaaaaaaaaaaa' },
  deckName: null,
  accessoryId: 'acc-1',
  accessory: { id: 'acc-1', photoVersion: 'bbbbbbbbbbbbbbbb' },
  components: [],
  ...over,
});

const bundleRow = (): AccessoryLineReadRow => ({
  id: 'line-2',
  kind: 'energy_bundle',
  quantity: 1,
  unitPriceCents: 2000,
  refundedQty: 0,
  snapshot: { name: 'Paquete de energías', category: 'energy', energyType: null, photoVersion: null },
  deckName: 'Dragapult ex',
  accessoryId: null,
  accessory: null,
  components: [
    { energyType: 'fire', quantity: 8 },
    { energyType: 'psychic', quantity: 4 },
  ],
});

describe('AC-B60 toOrderAccessoryLineDTO — llaves exactas (§AC.19.6)', () => {
  it('accesorio: id, kind, name (snapshot), photo VIGENTE, cantidades e importes; ⛔ costo, snapshot, accessoryId, status', () => {
    const dto = toOrderAccessoryLineDTO(accessoryRow());
    expect(Object.keys(dto).sort()).toEqual(
      ['components', 'deckName', 'id', 'kind', 'lineTotalCents', 'name', 'photo', 'quantity', 'refundedQty', 'unitPriceCents'].sort(),
    );
    expect(dto).toEqual({
      id: 'line-1',
      kind: 'accessory',
      name: 'Penny sleeves',
      photo: {
        url: '/api/v1/accessories/acc-1/photo/bbbbbbbbbbbbbbbb/full',
        thumbUrl: '/api/v1/accessories/acc-1/photo/bbbbbbbbbbbbbbbb/thumb',
      },
      quantity: 3,
      unitPriceCents: 8900,
      lineTotalCents: 26700,
      refundedQty: 1,
      deckName: null,
      components: [],
    });
  });

  it('AC-B55: la foto se arma con la versión VIGENTE del accesorio, ⛔ con snapshot.photoVersion', () => {
    const dto = toOrderAccessoryLineDTO(accessoryRow());
    expect(dto.photo!.url).toContain('bbbbbbbbbbbbbbbb');
    expect(JSON.stringify(dto)).not.toContain('aaaaaaaaaaaaaaaa');
  });

  it('accesorio sin foto vigente ⇒ photo null', () => {
    expect(toOrderAccessoryLineDTO(accessoryRow({ accessory: { id: 'acc-1', photoVersion: null } })).photo).toBeNull();
  });

  it('paquete: name = deckName, photo null, components por tipo', () => {
    const dto = toOrderAccessoryLineDTO(bundleRow());
    expect(dto).toEqual({
      id: 'line-2',
      kind: 'energy_bundle',
      name: 'Dragapult ex',
      photo: null,
      quantity: 1,
      unitPriceCents: 2000,
      lineTotalCents: 2000,
      refundedQty: 0,
      deckName: 'Dragapult ex',
      components: [
        { energyType: 'fire', quantity: 8 },
        { energyType: 'psychic', quantity: 4 },
      ],
    });
  });

  it('deliveredRefund solo cuando se pasa (M3); ⛔ ausente (no undefined como llave) en el seguimiento', () => {
    const plain = toOrderAccessoryLineDTO(accessoryRow());
    expect(Object.prototype.hasOwnProperty.call(plain, 'deliveredRefund')).toBe(false);
    const m3 = toOrderAccessoryLineDTO(accessoryRow(), { kind: 'not_refundable', reason: 'not_delivered' });
    expect(m3.deliveredRefund).toEqual({ kind: 'not_refundable', reason: 'not_delivered' });
  });

  it('⛔ spread: llaves internas de la fila no viajan aunque vengan', () => {
    const row = { ...accessoryRow(), unitCostCents: 3000, status: 'sold', settledWithoutStock: true } as AccessoryLineReadRow;
    const s = JSON.stringify(toOrderAccessoryLineDTO(row));
    for (const k of ['unitCostCents', 'snapshot', 'accessoryId', 'status', 'settledWithoutStock']) expect(s).not.toContain(`"${k}"`);
  });
});

describe('💰 accessoryAmountByQtyCents — [k−1] = itemMissingRefundComponents(order, k × P).amountCents', () => {
  it('3 fundas de 8900', () => {
    expect(accessoryAmountByQtyCents(ORDER, 8900, 3)).toEqual([1, 2, 3].map((k) => itemMissingRefundComponents(ORDER, k * 8900).amountCents));
  });
  it('n = 0 ⇒ []', () => {
    expect(accessoryAmountByQtyCents(ORDER, 8900, 0)).toEqual([]);
  });
});

describe('💰 accessoryDeliveredRefundOf — la vista de M3 (§AC.12 v1.86.2)', () => {
  const line = { kind: 'accessory' as const, quantity: 3, refundedQty: 1, unitPriceCents: 8900 };
  it('refundable: refundableQty = quantity − refundedQty; amountByQtyCents de largo refundableQty', () => {
    expect(accessoryDeliveredRefundOf({ order: ORDER, line, shipmentStatus: 'entregado', deckCovered: false })).toEqual({
      kind: 'refundable',
      refundableQty: 2,
      amountByQtyCents: accessoryAmountByQtyCents(ORDER, 8900, 2),
    });
  });
  it('orden no liquidada ⇒ order_not_settled', () => {
    expect(accessoryDeliveredRefundOf({ order: { ...ORDER, status: 'refunded' }, line, shipmentStatus: 'entregado', deckCovered: false })).toEqual({
      kind: 'not_refundable',
      reason: 'order_not_settled',
    });
  });
  it('todo reembolsado ⇒ fully_refunded', () => {
    expect(accessoryDeliveredRefundOf({ order: ORDER, line: { ...line, refundedQty: 3 }, shipmentStatus: 'entregado', deckCovered: false })).toEqual({
      kind: 'not_refundable',
      reason: 'fully_refunded',
    });
  });
  it('envío no entregado (o sin línea de envío) ⇒ not_delivered', () => {
    for (const s of ['picking', 'guia', 'enviado', null]) {
      expect(accessoryDeliveredRefundOf({ order: ORDER, line, shipmentStatus: s, deckCovered: false })).toEqual({ kind: 'not_refundable', reason: 'not_delivered' });
    }
  });
  it('paquete sin su deck reembolsado ⇒ bundle_requires_deck; con el deck ⇒ refundable entero (1)', () => {
    const b = { kind: 'energy_bundle' as const, quantity: 1, refundedQty: 0, unitPriceCents: 2000 };
    expect(accessoryDeliveredRefundOf({ order: ORDER, line: b, shipmentStatus: 'entregado', deckCovered: false })).toEqual({
      kind: 'not_refundable',
      reason: 'bundle_requires_deck',
    });
    expect(accessoryDeliveredRefundOf({ order: ORDER, line: b, shipmentStatus: 'entregado', deckCovered: true })).toEqual({
      kind: 'refundable',
      refundableQty: 1,
      amountByQtyCents: [itemMissingRefundComponents(ORDER, 2000).amountCents],
    });
  });
});

describe('AC-B60 correo AV-2 / confirmación de invitado con accesorios: ⛔ foto del accesorio (§AC.19.1)', () => {
  const imgs = (html: string) => (html.match(/<img/gi) ?? []).length;
  const acc = accessoryMailLinesOf([accessoryRow(), bundleRow()]);
  it('renglones del correo: nombre, cantidad, unitario, total; paquete con deck y componentes; ⛔ foto', () => {
    expect(acc).toEqual([
      { name: 'Penny sleeves', quantity: 3, unitPriceCents: 8900, lineTotalCents: 26700, deckName: null, components: [] },
      {
        name: 'Dragapult ex',
        quantity: 1,
        unitPriceCents: 2000,
        lineTotalCents: 2000,
        deckName: 'Dragapult ex',
        components: [
          { energyType: 'fire', quantity: 8 },
          { energyType: 'psychic', quantity: 4 },
        ],
      },
    ]);
    expect(JSON.stringify(acc)).not.toContain('photo');
  });
  it('la confirmación de invitado nombra el accesorio con su cantidad y no lleva <img', () => {
    const m = guestOrderConfirmationTemplate(
      { orderNumber: 'TCG-000001', items: [], totalCents: 30000, trackingUrl: 'http://x/t', accessoryLines: acc } as Parameters<typeof guestOrderConfirmationTemplate>[0],
      'es',
    );
    expect(m.html).toContain('Penny sleeves');
    expect(m.html).toContain('×3');
    expect(m.text).toContain('Penny sleeves ×3');
    // ⛔ foto del accesorio: el único <img> es el del esqueleto de marca (el mismo número que sin accesorios).
    const plain = guestOrderConfirmationTemplate({ orderNumber: 'TCG-000001', items: [], totalCents: 30000, trackingUrl: 'http://x/t' }, 'es');
    expect(imgs(m.html)).toBe(imgs(plain.html));
    expect(m.html).not.toContain('/photo/');
  });
  it('AV-2 (cliente registrado) también los nombra y no lleva <img', () => {
    const m = orderSettledTemplate(
      { orderNumber: 'TCG-000002', orderId: 'o1', items: [], totalCents: 30000, accessoryLines: acc } as Parameters<typeof orderSettledTemplate>[0],
      'es',
    );
    expect(m.html).toContain('Penny sleeves');
    const plain = orderSettledTemplate({ orderNumber: 'TCG-000002', orderId: 'o1', items: [], totalCents: 30000 }, 'es');
    expect(imgs(m.html)).toBe(imgs(plain.html));
    expect(m.html).not.toContain('/photo/');
  });
});
