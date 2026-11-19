/**
 * ship-quote-token.ts — 💰🔒 §ENV3 (DECISIONES punto 7): el `quoteId` es un token HMAC infalsificable, sin estado en servidor.
 *
 *     token = base64url(JSON{ v:1, cp, h, fee, exp, iat, … }) + "." + domainHmac('ship-quote:v1:', parte1)
 *
 * Misma disciplina que `deck-pull-token.ts`: forma del texto → firma (tiempo constante) → forma de la carga → vigencia. Una firma mala
 * nunca llega a parsear JSON. La llave es la de `PiiCryptoService` (⛔ ningún secreto nuevo). La carga lleva todo lo que el pedido
 * congela (`snapshot`), así el servidor no necesita recordar nada y el cliente no puede cambiar una cifra sin romper la firma.
 */
export const SHIP_QUOTE_DOMAIN = 'ship-quote:v1:';
export const SHIP_QUOTE_TOKEN_MAX_LENGTH = 2048;
const IAT_FUTURE_SKEW_S = 300;

export interface ShipQuoteSnapshot {
  serviceCode: string;
  serviceName: string;
  carrier: string;
  etaDays: number;
  /** Costo de guía cotizado (centavos, con IVA y seguro, Σ de todas las cajas). */
  costQuotedCents: number;
  extendedAreaCents: number;
  marginCents: number;
  source: 'live' | 'table';
  profile: { package: string; boxes: number; perBoxKg: number; perBoxCoverageCents: number };
  /** `'threshold'` si la cotización se emitió con el pedido ya sobre el umbral (cobro 0). */
  free?: 'threshold';
}

export interface ShipQuotePayload {
  v: 1;
  cp: string;
  /** hashPerfil */
  h: string;
  /** cobro al cliente (centavos, IVA dentro) */
  fee: number;
  iat: number;
  exp: number;
  snap: ShipQuoteSnapshot & { quotedAt: string };
}

export interface ShipQuoteSigner {
  domainHmac(domain: string, value: string): string;
  constantTimeEquals(a?: string | null, b?: string | null): boolean;
}

export type ShipQuoteVerdict =
  | { ok: true; payload: ShipQuotePayload }
  | { ok: false; reason: 'invalid_token' | 'expired'; payload: null };

const B64URL = /^[A-Za-z0-9_-]+$/;
const INVALID: ShipQuoteVerdict = { ok: false, reason: 'invalid_token', payload: null };

export function signShipQuote(signer: ShipQuoteSigner, p: Omit<ShipQuotePayload, 'v'>): string {
  // Orden de llaves FIJO: el texto firmado es determinista.
  const json = JSON.stringify({ v: 1, cp: p.cp, h: p.h, fee: p.fee, iat: p.iat, exp: p.exp, snap: p.snap });
  const part1 = Buffer.from(json, 'utf8').toString('base64url');
  return `${part1}.${signer.domainHmac(SHIP_QUOTE_DOMAIN, part1)}`;
}

function isInt(n: unknown): n is number {
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
}

export function verifyShipQuote(signer: ShipQuoteSigner, token: unknown, nowSec: number): ShipQuoteVerdict {
  if (typeof token !== 'string' || token.length === 0 || token.length > SHIP_QUOTE_TOKEN_MAX_LENGTH) return INVALID;
  const parts = token.split('.');
  if (parts.length !== 2 || !B64URL.test(parts[0]) || parts[1].length === 0) return INVALID;
  if (!signer.constantTimeEquals(signer.domainHmac(SHIP_QUOTE_DOMAIN, parts[0]), parts[1])) return INVALID;
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    return INVALID;
  }
  const snap = o.snap as ShipQuotePayload['snap'] | undefined;
  if (
    o.v !== 1 ||
    typeof o.cp !== 'string' ||
    typeof o.h !== 'string' ||
    !isInt(o.fee) ||
    !isInt(o.iat) ||
    !isInt(o.exp) ||
    !snap ||
    typeof snap !== 'object' ||
    typeof snap.serviceCode !== 'string' ||
    !isInt(snap.costQuotedCents)
  ) {
    return INVALID;
  }
  if (o.iat > nowSec + IAT_FUTURE_SKEW_S) return INVALID;
  if (nowSec >= o.exp) return { ok: false, reason: 'expired', payload: null };
  return { ok: true, payload: o as unknown as ShipQuotePayload };
}
