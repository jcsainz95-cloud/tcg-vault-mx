/**
 * customer-quote.ts — 💰 §ENV3 (DECISIONES punto 8): «Capturar guía» preselecciona la tarifa que casa con lo cotizado al cliente. PURO.
 * `snapshot.serviceCode` primero; si esa tarifa no está en la cotización del operador, la siguiente de `ship_service_order`
 * (`fallback: true`). ⛔ La pantalla no empareja servicios: lo decide el servidor.
 */
export interface CustomerQuoteDTO {
  serviceCode: string;
  serviceName: string;
  chargedCents: number;
  costQuotedCents: number;
  preselectedRateId: string | null;
  fallback: boolean;
}

const snake = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').replace(/^fedex_/, '');

export function customerQuoteOf(
  snapshot: unknown,
  chargedCents: number,
  rates: ReadonlyArray<{ rateId: string; carrierName: string; serviceName: string; hidden?: boolean }>,
  serviceOrder: readonly string[],
): CustomerQuoteDTO | null {
  const s = snapshot as { serviceCode?: unknown; serviceName?: unknown; costQuotedCents?: unknown; free?: unknown } | null;
  if (!s || typeof s !== 'object' || typeof s.serviceCode !== 'string' || !Number.isSafeInteger(s.costQuotedCents)) return null;
  const find = (code: string) => rates.find((r) => r.carrierName === 'fedex' && !r.hidden && snake(r.serviceName) === snake(code));
  const quoted = s.free === 'threshold' ? undefined : find(s.serviceCode);
  let pick = quoted;
  let fallback = false;
  if (!pick) {
    for (const code of serviceOrder) {
      pick = find(code);
      if (pick) break;
    }
    fallback = pick !== undefined;
  }
  return {
    serviceCode: s.serviceCode,
    serviceName: typeof s.serviceName === 'string' ? s.serviceName : '',
    chargedCents,
    costQuotedCents: s.costQuotedCents as number,
    preselectedRateId: pick?.rateId ?? null,
    fallback,
  };
}
