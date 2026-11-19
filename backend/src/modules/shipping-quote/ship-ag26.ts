/**
 * ship-ag26.ts — 💰 §ENV3 (DECISIONES punto 8): AG-26 `label_over_customer_quote`. PURO.
 * «Guía más cara que lo cotizado al cliente» = `costoReal > costQuotedCents + ship_cost_over_quote_cents`. ⛔ No es AG-5
 * (`label_charge_drift` mide la guía contra la cotización del OPERADOR, otra base): no se mezclan. Informativo; nada se bloquea.
 * Solo pedidos con `shippingQuoteSnapshot` de UNA caja (con N cajas la guía de una caja no es comparable con el Σ cotizado).
 */
export interface Ag26Input {
  snapshot: unknown;
  /** Lo que costó la guía (total + seguro), centavos. */
  costRealCents: number;
  toleranceCents: number;
  boughtService: string;
  folio: string | null;
}

export interface Ag26Facts {
  folio: string | null;
  costQuotedCents: number;
  costRealCents: number;
  differenceCents: number;
  quotedService: string;
  boughtService: string;
}

export function ag26Of(i: Ag26Input): Ag26Facts | null {
  const s = i.snapshot as { costQuotedCents?: unknown; serviceName?: unknown; free?: unknown; profile?: { boxes?: unknown } } | null;
  if (!s || typeof s !== 'object') return null;
  if (!Number.isSafeInteger(s.costQuotedCents) || (s.costQuotedCents as number) <= 0) return null; // sin cotización de costo (gratis por umbral, sin datos)
  if (s.profile?.boxes !== 1) return null;
  const quoted = s.costQuotedCents as number;
  if (i.costRealCents <= quoted + i.toleranceCents) return null;
  return {
    folio: i.folio,
    costQuotedCents: quoted,
    costRealCents: i.costRealCents,
    differenceCents: i.costRealCents - quoted,
    quotedService: typeof s.serviceName === 'string' ? s.serviceName : '',
    boughtService: i.boughtService,
  };
}

const snake = (x: string) => x.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').replace(/^fedex_/, '');

/**
 * Fila del `ShippingQuoteLog` de una guía comprada (transporte SIN seguro, como la tabla). DECISIONES §ENV3 punto 17(3): la muestra lleva el
 * servicio COMPRADO real (no el cotizado), solo FedEx a DOMICILIO y de `ship_service_order`; ⛔ nunca `free_threshold`, tabla ni sucursal.
 * Solo pedidos con snapshot de §ENV3 y de UNA caja (perfil de la tabla).
 */
export function labelLogRowOf(i: {
  snapshot: unknown;
  postalCode: unknown;
  rate: { carrierName: string; serviceName: string; deliveryKind: string };
  serviceOrder: readonly string[];
  transportCents: number;
}) {
  const s = i.snapshot as { profile?: { package?: unknown; perBoxKg?: unknown; boxes?: unknown } } | null;
  const p = s?.profile;
  if (!p || p.boxes !== 1 || typeof p.package !== 'string' || typeof p.perBoxKg !== 'number') return null;
  if (i.rate.carrierName !== 'fedex' || i.rate.deliveryKind !== 'home') return null;
  const serviceCode = i.serviceOrder.find((c) => snake(c) === snake(i.rate.serviceName));
  if (!serviceCode || serviceCode === 'free_threshold') return null;
  if (typeof i.postalCode !== 'string' || !/^\d{5}$/.test(i.postalCode) || !Number.isSafeInteger(i.transportCents) || i.transportCents <= 0) return null;
  return { prefix2: i.postalCode.slice(0, 2), profileKey: `${p.package}:${p.perBoxKg}`, serviceCode, costCents: i.transportCents, source: 'label' as const };
}
