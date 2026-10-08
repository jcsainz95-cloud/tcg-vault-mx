import { describe, it, expect } from 'vitest';
import es from '../../messages/es.json';
import en from '../../messages/en.json';

/**
 * AC-UX-14 (`DESIGN_SYSTEM §AC-UX.15/.16`): toda clave de accesorios existe en `es` y `en` con los MISMOS
 * marcadores `{x}`. Canario: borrar una en `en` (o cambiar un marcador) pone esto rojo.
 */
type Tree = Record<string, unknown>;

function get(tree: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, k) => (acc && typeof acc === 'object' ? (acc as Tree)[k] : undefined), tree);
}
function leaves(obj: unknown, prefix: string): [string, string][] {
  if (typeof obj === 'string') return [[prefix, obj]];
  if (!obj || typeof obj !== 'object') return [];
  return Object.entries(obj as Tree).flatMap(([k, v]) => leaves(v, `${prefix}.${k}`));
}
const placeholders = (s: string) =>
  [...s.matchAll(/\{(\w+)(?:,[^{}]*(?:\{[^{}]*\}[^{}]*)*)?\}/g)].map((m) => m[1]).sort();

/** Los espacios de nombres de §AC (los textos de AC-UX.15 viven aquí). */
const NAMESPACES = [
  'accessories',
  'checkout.accessories',
  'checkout.suggestions',
  'checkout.bundleOffer',
  'checkout.accessoryNotice',
  'checkout.accessoryPayError',
  'decksMeta.energy',
  'decksMeta.bundle',
  'admin.accessories',
  'admin.m4.prep.ship.accessory',
  'admin.m3.accessories',
];

/** Claves sueltas fuera de esos espacios. */
const SINGLE_KEYS = [
  'storeTabs.accessories',
  'checkout.subtotalHintProducts',
  'checkout.payNoAmount',
  'admin.modules.accessories',
  'admin.m10.shipping.packages.customerFee',
  'admin.m10.shipping.packages.noFee',
  'admin.m10.shipping.packages.feeRule',
  'admin.m10.shipping.packages.noneCharges',
  'admin.m10.shipping.packages.feeRange',
  'admin.m9.sales.mix.accessory',
];

/** Muestras de AC-UX.15 que deben existir con este texto exacto en ES (las que fija el diseño). */
const DS_ES: [string, string][] = [
  ['storeTabs.accessories', 'Accesorios'],
  ['accessories.signedInNotice', 'Los accesorios se compran con envío a domicilio. Pronto también desde tu cuenta.'],
  ['checkout.suggestions.title', '¿Te falta algo?'],
  ['checkout.subtotalHintProducts', 'Precio de venta de tus productos, con IVA incluido.'],
  ['checkout.accessories.boxHint', 'Calculado por el tamaño de la caja que necesita tu pedido.'],
  ['decksMeta.bundle.needsDeck', 'Primero agrega el deck con «Agregar de jalón»: el paquete solo va con el deck completo.'],
  ['admin.accessories.subtitle', 'Fundas, carpetas, energías y demás. Sin foto no se publica.'],
];

describe('AC-UX-14 · paridad ES/EN de accesorios', () => {
  it.each(NAMESPACES)('%s existe en los dos idiomas', (ns) => {
    expect(get(es, ns), `es:${ns}`).toBeTypeOf('object');
    expect(get(en, ns), `en:${ns}`).toBeTypeOf('object');
  });

  it.each(NAMESPACES)('%s: mismas claves y mismos marcadores', (ns) => {
    const a = Object.fromEntries(leaves(get(es, ns), ns));
    const b = Object.fromEntries(leaves(get(en, ns), ns));
    expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
    for (const k of Object.keys(a)) expect(placeholders(b[k] ?? ''), k).toEqual(placeholders(a[k]));
  });

  it.each(SINGLE_KEYS)('%s existe en los dos idiomas con los mismos marcadores', (k) => {
    const a = get(es, k);
    const b = get(en, k);
    expect(typeof a, `es:${k}`).toBe('string');
    expect(typeof b, `en:${k}`).toBe('string');
    expect(placeholders(b as string)).toEqual(placeholders(a as string));
  });

  it.each(DS_ES)('%s = el texto de §AC-UX.15', (k, text) => {
    expect(get(es, k)).toBe(text);
  });

  it('las siete categorías y los ocho tipos de energía tienen rótulo en los dos idiomas', () => {
    for (const c of ['sleeves', 'toploaders', 'binders', 'deck_boxes', 'playmats', 'energy', 'other']) {
      expect(get(es, `accessories.category.${c}`)).toBeTypeOf('string');
      expect(get(en, `accessories.category.${c}`)).toBeTypeOf('string');
    }
    for (const t of ['grass', 'fire', 'water', 'lightning', 'psychic', 'fighting', 'darkness', 'metal']) {
      expect(get(es, `accessories.energyType.${t}`)).toBeTypeOf('string');
      expect(get(en, `accessories.energyType.${t}`)).toBeTypeOf('string');
    }
  });

  it('⛔ ningún texto de accesorios sugiere cerrar sesión ni comprar como invitado (P-AC-1)', () => {
    const all = NAMESPACES.flatMap((ns) => [...leaves(get(es, ns), ns), ...leaves(get(en, ns), ns)]);
    const offenders = all.filter(([, v]) => /cerrar sesión|cierra sesión|sign out|log out|como invitado|as a guest/i.test(v));
    expect(offenders).toEqual([]);
  });

  /**
   * AC-UX.v1.86.4 (`DESIGN_SYSTEM`): el paquete que sale por existencias NO promete energías sueltas. `insufficient_stock`
   * puede significar que no queda ninguna; el copy solo dice el condicional («si nos quedan…»). Mutación: restaurar el
   * texto viejo en una de las cinco ⇒ rojo.
   */
  const NO_LOOSE_PROMISE_KEYS = [
    'checkout.accessoryPayError.bundle',
    'checkout.accessoryPayError.bundleNoName',
    'checkout.accessoryNotice.bundleNoStock',
    'checkout.accessoryNotice.bundleNoStockNoName',
    'decksMeta.bundle.noStock',
  ];
  it.each(NO_LOOSE_PROMISE_KEYS)('%s no promete energías sueltas (AC-UX.v1.86.4)', (k) => {
    for (const [loc, tree] of [['es', es], ['en', en]] as const) {
      const v = get(tree, k);
      expect(typeof v, `${loc}:${k}`).toBe('string');
      expect(v as string, `${loc}:${k}`).not.toMatch(/las energías las puedes agregar|las que haya|you can add the energy cards|the ones we have/i);
    }
  });

  it.each([
    ['checkout.accessoryPayError.bundle', 'El paquete de energías de {deck} ya no se puede pagar. No se cobró nada. Lo quitamos del carrito. Si nos quedan energías sueltas, puedes agregarlas desde el deck.', "The energy bundle for {deck} can no longer be paid for. You weren't charged. We removed it from your cart. If we still have some energy cards left, you can add them one by one from the deck."],
    ['checkout.accessoryPayError.bundleNoName', 'Un paquete de energías ya no se puede pagar. No se cobró nada. Lo quitamos del carrito. Si nos quedan energías sueltas, puedes agregarlas desde el deck.', "An energy bundle can no longer be paid for. You weren't charged. We removed it from your cart. If we still have some energy cards left, you can add them one by one from the deck."],
    ['checkout.accessoryNotice.bundleNoStock', 'El paquete de energías de {deck} salió del carrito: ya no tenemos todas sus energías. Si nos quedan algunas sueltas, puedes agregarlas desde el deck.', 'The energy bundle for {deck} left your cart: we no longer have all its energy cards. If we still have some left, you can add them one by one from the deck.'],
    ['checkout.accessoryNotice.bundleNoStockNoName', 'Un paquete de energías salió del carrito: ya no tenemos todas sus energías. Si nos quedan algunas sueltas, puedes agregarlas desde el deck.', 'An energy bundle left your cart: we no longer have all its energy cards. If we still have some left, you can add them one by one from the deck.'],
    ['decksMeta.bundle.noStock', 'Paquete de energías no disponible: no tenemos todas las que pide este deck. Abajo ves cuáles nos quedan para agregarlas sueltas.', "Energy bundle not available: we don't have all the energy cards this deck needs. Below you can see which ones we still have to add one by one."],
  ])('%s = el texto literal de AC-UX.v1.86.4 (es/en)', (k, esText, enText) => {
    expect(get(es, k)).toBe(esText);
    expect(get(en, k)).toBe(enText);
  });

  /**
   * AC-UX.gates (`DESIGN_SYSTEM`, 2026-10-08): `hintItem.arrived_damaged` lleva sujeto («el producto») y las seis
   * variantes de `shippedRefund` para pedidos con accesorios, con el texto LITERAL de la tabla §3. Mismos marcadores
   * que la clave de cartas (`done*` ⇒ `{ref}` y `{reason}`). Canario: borrar una en `en` o cambiar un marcador ⇒ rojo.
   */
  it.each([
    ['admin.m3.shippedReason.hintItem.arrived_damaged', 'Llegó, pero el producto no estaba como se vendió.', "It arrived, but the item wasn't as sold."],
    ['admin.m3.shippedRefund.warningAccessories', 'Los accesorios no vuelven a existencias: el cliente los tiene o los tuvo. Solo se puede reembolsar completo si no llegó o si llegó en mala condición.', "The accessories don't go back into stock: the customer has or had them. It can only be fully refunded if it didn't arrive or arrived in bad condition."],
    ['admin.m3.shippedRefund.warningMixed', 'Ni las cartas vuelven a inventario ni los accesorios a existencias: el cliente los tiene o los tuvo. Solo se puede reembolsar completo si no llegó o si llegó en mala condición.', 'Neither the cards go back into inventory nor the accessories into stock: the customer has or had them. It can only be fully refunded if it didn\'t arrive or arrived in bad condition.'],
    ['admin.m3.shippedRefund.bodyAccessories', 'Se devuelve lo que queda del cobro. El envío no se toca y los accesorios no vuelven a existencias ni a la venta. El motivo queda guardado a tu nombre. El cliente recibe el correo de reembolso de siempre.', "What's left of the charge is refunded. The shipment isn't touched and the accessories don't go back into stock or on sale. The reason is saved under your name. The customer gets the usual refund email."],
    ['admin.m3.shippedRefund.bodyMixed', 'Se devuelve lo que queda del cobro. El envío no se toca y ni las cartas ni los accesorios vuelven a inventario ni a la venta. El motivo queda guardado a tu nombre. El cliente recibe el correo de reembolso de siempre.', "What's left of the charge is refunded. The shipment isn't touched and neither the cards nor the accessories go back into inventory or on sale. The reason is saved under your name. The customer gets the usual refund email."],
    ['admin.m3.shippedRefund.doneAccessories', 'Reembolso hecho del pedido {ref}. Motivo guardado: «{reason}». Los accesorios no vuelven a existencias.', "Order {ref} refunded. Reason saved: “{reason}”. The accessories don't go back into stock."],
    ['admin.m3.shippedRefund.doneMixed', 'Reembolso hecho del pedido {ref}. Motivo guardado: «{reason}». Ni las cartas ni los accesorios vuelven a inventario.', 'Order {ref} refunded. Reason saved: “{reason}”. Neither the cards nor the accessories go back into inventory.'],
  ])('%s = el texto literal de AC-UX.gates (es/en)', (k, esText, enText) => {
    expect(get(es, k)).toBe(esText);
    expect(get(en, k)).toBe(enText);
  });

  it.each(['warning', 'body', 'done'])('admin.m3.shippedRefund.%s: las variantes Accessories/Mixed tienen los marcadores de la de cartas', (base) => {
    for (const tree of [es, en]) {
      const ref = placeholders(get(tree, `admin.m3.shippedRefund.${base}`) as string);
      for (const v of ['Accessories', 'Mixed']) expect(placeholders(get(tree, `admin.m3.shippedRefund.${base}${v}`) as string ?? ''), `${base}${v}`).toEqual(ref);
    }
  });
});
