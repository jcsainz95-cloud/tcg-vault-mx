/**
 * 💰 AC-B37 — censo estático (§AC.6 (2) y §AC.15).
 *
 * (1) Todo fichero de `src/` que suelta piezas con `releaseReservationData` (salvo donde se DEFINE) llama también a
 *     `releaseAccessoryReservations(`: si una ruta suelta las cartas y no los accesorios, el `reservedQty` queda apartado
 *     para siempre (y la tienda dice «agotado» con existencias en el estante).
 * (2) Los sitios del censo de §AC.15 leen renglones de accesorio (o el fichero declara por qué no, abajo).
 * Cada predicado con su CANARIO: un texto que debe hacerlo saltar, para que el candado no pase por estar ciego.
 */
import * as fs from 'fs';
import * as path from 'path';

const SRC = path.join(__dirname, '..', 'src');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}

/** Quita comentarios de línea y de bloque (para que un nombre en un comentario no cuente como llamada). */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

export const usesRelease = (text: string) => /\breleaseReservationData\b/.test(code(text));
export const callsAccessoryRelease = (text: string) => /\breleaseAccessoryReservations\s*\(/.test(code(text));
/** Lee renglones directamente, o llama al cuerpo único que los lee (`accessory-stock.ts` / `accessory-prep.ts`). */
const readsAccessoryLines = (text: string) =>
  /\b(orderAccessoryLine|shipmentAccessoryLine|accessoryLines?|OrderAccessoryLine|ShipmentAccessoryLine|releaseAccessoryReservations|restockAccessoriesOnFullRefund|settleAccessories|accessoryInsuredCents|expiredAccessoryOrderIds)\b/.test(code(text));

const DEFINER = path.join(SRC, 'modules', 'orders', 'reservation.ts');

describe('AC-B37 (1) — quien suelta cartas suelta accesorios', () => {
  it('canario: el predicado ve el uso y la falta de llamada, y no se deja engañar por un comentario', () => {
    const malo = `import { releaseReservationData } from './reservation';\n// releaseAccessoryReservations(tx, id)\nfoo(releaseReservationData);`;
    expect(usesRelease(malo)).toBe(true);
    expect(callsAccessoryRelease(malo)).toBe(false);
    expect(callsAccessoryRelease(`${malo}\nawait releaseAccessoryReservations(tx, orderId);`)).toBe(true);
  });

  it('el censo no está vacío (ciego): al menos los 3 ficheros de §AC.6 (2)', () => {
    const users = walk(SRC).filter((f) => f !== DEFINER && usesRelease(fs.readFileSync(f, 'utf8')));
    const rel = users.map((f) => path.relative(SRC, f)).sort();
    expect(rel).toEqual(
      expect.arrayContaining(['modules/orders/orders.service.ts', 'modules/payments/payments.service.ts', 'modules/payments/refunds/release-unsettled-refund.ts']),
    );
  });

  it('todo fichero que usa releaseReservationData llama a releaseAccessoryReservations', () => {
    const missing = walk(SRC)
      .filter((f) => f !== DEFINER)
      .filter((f) => {
        const t = fs.readFileSync(f, 'utf8');
        return usesRelease(t) && !callsAccessoryRelease(t);
      })
      .map((f) => path.relative(SRC, f));
    expect(missing).toEqual([]);
  });

  it('cada sitio de §AC.6 (2) lo llama al menos tantas veces como suelta (por fichero)', () => {
    const count = (t: string, re: RegExp) => (code(t).match(re) ?? []).length;
    for (const f of ['modules/orders/orders.service.ts', 'modules/payments/payments.service.ts']) {
      const t = fs.readFileSync(path.join(SRC, f), 'utf8');
      const releases = count(t, /data:\s*releaseReservationData/g);
      const calls = count(t, /releaseAccessoryReservations\s*\(/g);
      expect({ f, ok: calls >= releases }).toEqual({ f, ok: true });
    }
  });
});

/**
 * (2) §AC.15. Los que NO leen renglones lo declaran aquí con su porqué (una línea), para que el censo sea una decisión
 * escrita y no un olvido:
 *  - `payments/refunds/origin.ts`: resuelve el ORIGEN de una CARTA (la pieza única); el renglón lleva su propio precio
 *    congelado (`OrderAccessoryLine.unitPriceCents`), no hay origen que resolver.
 *  - `orders/order-public-status.ts`: `clientRefundOf` decide por `kind` de la fila (sirve igual a carta y renglón); el
 *    seguimiento expone los renglones por `accessoryLines` con `refundedQty`.
 *  - `payments/refunds/mail/refund-notice.templates.ts`: pinta `cards[].name`; el nombre «Penny sleeves ×1» lo arma
 *    `refund-ledger.service.ts` (que sí está en la lista).
 */
const MUST_READ = [
  'modules/orders/guest-checkout.service.ts',
  'modules/orders/orders.service.ts',
  'modules/payments/payments.service.ts',
  'modules/payments/refunds/full-refund.service.ts',
  'modules/payments/refunds/release-unsettled-refund.ts',
  'modules/payments/refunds/refund-ledger.service.ts',
  'modules/orders/order-refund.service.ts',
  'modules/shipments/shipment-prep.service.ts',
  'modules/shipments/shipments.service.ts',
  'modules/shipments/label-quote.service.ts',
  'modules/admin/pnl-core.ts',
  'modules/orders/admin-orders.controller.ts',
  'modules/sales-analytics/sales-analytics.service.ts',
  'modules/orders/mail/guest-order.templates.ts',
  'modules/orders/mail/order-notice.templates.ts',
];

describe('AC-B37 (2) — los sitios de §AC.15 leen renglones de accesorio', () => {
  it('canario: un fichero sin renglones no pasa', () => {
    expect(readsAccessoryLines('const items = order.items; // accessoryLines')).toBe(false);
    expect(readsAccessoryLines('const a = order.accessoryLines;')).toBe(true);
  });

  it.each(MUST_READ)('%s', (f) => {
    expect(readsAccessoryLines(fs.readFileSync(path.join(SRC, f), 'utf8'))).toBe(true);
  });
});
