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

/** Fila del `ShippingQuoteLog` de una guía comprada (transporte SIN seguro, como la tabla), o `null` si el pedido no es de §ENV3. */
export function labelLogRowOf(snapshot: unknown, postalCode: unknown, serviceCode: string | null, transportCents: number) {
  const s = snapshot as { profile?: { package?: unknown; perBoxKg?: unknown; boxes?: unknown } } | null;
  const p = s?.profile;
  if (!p || p.boxes !== 1 || typeof p.package !== 'string' || typeof p.perBoxKg !== 'number' || !serviceCode) return null;
  if (typeof postalCode !== 'string' || !/^\d{5}$/.test(postalCode) || !Number.isSafeInteger(transportCents) || transportCents <= 0) return null;
  return { prefix2: postalCode.slice(0, 2), profileKey: `${p.package}:${p.perBoxKg}`, serviceCode, costCents: transportCents, source: 'label' as const };
}
