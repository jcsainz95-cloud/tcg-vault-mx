/**
 * MOCK · réplica de los códigos de descuento (API_CONTRACT §DSC, v1.110.3).
 *
 * ⚠️ **SIMULADOR, no la fuente.** En producción todo esto lo decide el servidor (`backend/src/common/money.ts`
 * `discountOf`/`allocateDiscount` y el módulo `discounts`); el front pinta `discount`, `breakdown` e `items[]` tal
 * como llegan (DCO-F2). Existe para que el modo mock no muestre una cifra que el sistema real no produciría.
 * Paridad con las cifras del contrato: `discounts.parity.test.ts`.
 *
 * Lo que replica (cada punto con su sección):
 *  - §DSC.2 elegibilidad (paquete de energías nunca; `productScopes`; `destinations`, el retiro cuenta como
 *    `direct_ship`), mínimo ANTES del descuento e inclusivo [D7], nominal `D0` (`floor` del %, tope, monto fijo
 *    `min(amount, B)`) y el recorte `D0 = min(D0, B − U)` (I-4: cada unidad conserva ≥ 1 centavo);
 *  - §DSC.3 reparto POR UNIDAD al centavo con mayor resto, en BigInt;
 *  - §DSC.4 orden del cálculo: el umbral de envío se mide sobre `S' = S − D` [D2]; el envío gratis (tipo c) no
 *    aplica a bóveda / sobre el umbral / con caja grande; total < MX$10.00 ⇒ `TOTAL_BELOW_MINIMUM`;
 *  - §DSC.6 genérico idéntico en los seis casos y límite de intentos (`invalid` y `not_applicable`, este una vez por
 *    código y ventana, v1.110.3); precedencia de motivos de §DSC.4 (v1.110.3);
 *  - §DSC.8 retiro: solo envío gratis sin filtros, total MX$0.00.
 *
 * Lo que NO replica (y dónde se mide de verdad): el candado de fila y la carrera del último uso (DCO-B6, backend),
 * el ciclo reservado→consumido→liberado por webhook y barrido (DCO-B5: aquí la sesión deja el uso `reserved` y no
 * hay webhook), el tiempo constante del camino `invalid` (pentester).
 */

import './sentinel';
import type {
  DiscountAuditAction,
  DiscountAuditEntry,
  DiscountCodeBatchDTO,
  DiscountCodeDTO,
  DiscountCodeState,
  DiscountCodeStatus,
  DiscountKind,
  DiscountNotApplicableReason,
  DiscountPreviewRequest,
  DiscountPreviewResponse,
  DiscountProductScope,
  DiscountQuoteDTO,
  DiscountRedemptionStatus,
  DiscountReportDTO,
  FulfillmentMode,
  BreakdownDTO,
  OrderDiscountDTO,
} from '@/types/contract';

// ---------------------------------------------------------------------------------------------------------------
// Puro: §DSC.2–§DSC.3
// ---------------------------------------------------------------------------------------------------------------

/** Una línea del carrito tal como la ve el cálculo: `P` exhibido por unidad, `q` unidades. */
export interface DiscountLine {
  /** `inventoryItemId` (pieza) o `accessoryId` (accesorio); el paquete lleva el slug del deck. */
  id: string;
  /** `item` = pieza (orden canónico primero), `accessory` = renglón de accesorio, `energy_bundle` = paquete [D9]. */
  kind: 'item' | 'accessory' | 'energy_bundle';
  /** Tipo para el filtro: el de la pieza, o `accessory` (energía suelta incluida). `null` para el paquete. */
  scope: DiscountProductScope | null;
  priceCents: number;
  quantity: number;
}

/** La configuración del código que el cálculo necesita (subconjunto de `DiscountCodeDTO`). */
export interface DiscountRule {
  kind: DiscountKind;
  percentPct: number | null;
  amountCents: number | null;
  maxDiscountCents: number | null;
  minSubtotalCents: number | null;
  productScopes: DiscountProductScope[];
  destinations: FulfillmentMode[];
}

export type DiscountDestination = FulfillmentMode | 'withdrawal';

export type DiscountOfResult =
  | {
      ok: true;
      /** `B`: Σ P·q de las elegibles. */
      eligibleCents: number;
      /** `D` (≤ `D0`): Σ q·u exacto. 0 para `free_shipping`. */
      discountCents: number;
      /** `D0` nominal tras el recorte de I-4 (para la paridad; el cliente nunca lo ve). */
      nominalCents: number;
      /**
       * v1.110.3 (DCO-B21): SOLO el tope en pesos — `percent ∧ maxDiscountCents ≠ null ∧ floor(B × pct / 100) > tope`. El recorte
       * por `B`, por I-4 o por el residuo de §DSC.3 no es `capped`.
       */
      capped: boolean;
      /** Descuento por unidad, por `id` de línea (solo elegibles con u > 0). */
      unitDiscounts: Map<string, number>;
    }
  | { ok: false; reason: DiscountNotApplicableReason; details: Record<string, number | string[]> };

/** Orden canónico de §DSC.3: piezas por `inventoryItemId` asc, luego accesorios por `accessoryId` asc. */
function canonical(lines: DiscountLine[]): DiscountLine[] {
  const rank = (l: DiscountLine) => (l.kind === 'item' ? 0 : l.kind === 'accessory' ? 1 : 2);
  return [...lines].sort((a, b) => rank(a) - rank(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * §DSC.3 — `allocateDiscount`. Entrada: elegibles en orden canónico y `D0`. Devuelve `u` por línea y `D = D0 − R`.
 * Productos en BigInt: `D0 × P` puede pasar de 2⁵³.
 */
export function allocateDiscount(
  lines: ReadonlyArray<{ priceCents: number; quantity: number }>,
  d0: number,
): { unit: number[]; discountCents: number } {
  const B = lines.reduce((s, l) => s + BigInt(l.priceCents) * BigInt(l.quantity), 0n);
  if (B === 0n || d0 <= 0) return { unit: lines.map(() => 0), discountCents: 0 };
  const D0 = BigInt(d0);
  const u = lines.map((l) => (D0 * BigInt(l.priceCents)) / B);
  const rest = lines.map((l) => (D0 * BigInt(l.priceCents)) % B);
  let R = D0 - lines.reduce((s, l, i) => s + BigInt(l.quantity) * u[i], 0n);
  const order = lines.map((_, i) => i).sort((a, b) => (rest[a] === rest[b] ? a - b : rest[b] > rest[a] ? 1 : -1));
  let took = true;
  while (took && R > 0n) {
    took = false;
    for (const i of order) {
      const q = BigInt(lines[i].quantity);
      if (q <= R && u[i] + 1n <= BigInt(lines[i].priceCents) - 1n) {
        u[i] += 1n;
        R -= q;
        took = true;
      }
    }
  }
  return { unit: u.map((x) => Number(x)), discountCents: Number(D0 - R) };
}

/**
 * §DSC.2 — elegibilidad, mínimo [D7] y nominal; §DSC.3 — reparto. Puro. Motivos en el orden de §DSC.4 (v1.110.3) que le tocan
 * a la parte pura: `NO_SHIPPING` → `DESTINATION` → `NO_ELIGIBLE_ITEMS` → `MIN_SUBTOTAL`. `LARGE_BOX` y `ALREADY_FREE_SHIPPING`
 * (4 y 5) dependen del envío y los pone `evaluateMockDiscount` ANTES del mínimo; `details` mínimos (DCO-B9).
 */
export function discountOf(lines: DiscountLine[], rule: DiscountRule, destination: DiscountDestination): DiscountOfResult {
  const dest: FulfillmentMode = destination === 'withdrawal' ? 'direct_ship' : destination;
  if (rule.kind === 'free_shipping' && destination === 'vault') {
    return { ok: false, reason: 'NO_SHIPPING', details: {} };
  }
  if (rule.destinations.length > 0 && !rule.destinations.includes(dest)) {
    return { ok: false, reason: 'DESTINATION', details: {} };
  }
  const eligible = canonical(lines).filter(
    (l) => l.kind !== 'energy_bundle' && l.scope !== null && (rule.productScopes.length === 0 || rule.productScopes.includes(l.scope)),
  );
  if (eligible.length === 0) {
    return { ok: false, reason: 'NO_ELIGIBLE_ITEMS', details: { productScopes: [...rule.productScopes] } };
  }
  const B = eligible.reduce((s, l) => s + l.priceCents * l.quantity, 0);
  if (rule.minSubtotalCents != null && B < rule.minSubtotalCents) {
    return { ok: false, reason: 'MIN_SUBTOTAL', details: { missingCents: rule.minSubtotalCents - B } };
  }
  const U = eligible.reduce((s, l) => s + l.quantity, 0);
  let d0 = 0;
  let capped = false;
  if (rule.kind === 'percent') {
    d0 = Number((BigInt(B) * BigInt(rule.percentPct ?? 0)) / 100n);
    capped = rule.maxDiscountCents != null && d0 > rule.maxDiscountCents;
    if (rule.maxDiscountCents != null) d0 = Math.min(d0, rule.maxDiscountCents);
  } else if (rule.kind === 'fixed_amount') {
    d0 = Math.min(rule.amountCents ?? 0, B);
  }
  d0 = Math.max(0, Math.min(d0, B - U));
  const { unit, discountCents } = allocateDiscount(eligible, d0);
  const unitDiscounts = new Map<string, number>();
  eligible.forEach((l, i) => {
    if (unit[i] > 0) unitDiscounts.set(l.id, unit[i]);
  });
  return { ok: true, eligibleCents: B, discountCents, nominalCents: d0, capped, unitDiscounts };
}

/**
 * §DSC.6 «Proyección de línea» (v1.110.3) — lo que el proyector del servidor añade a una línea con rebaja `u > 0`:
 * `unitPriceCents` = cobrado, `unitDiscountCents` = `u`, `unitPriceBeforeDiscountCents` = cobrado + `u`. Sin rebaja, los
 * tres campos se omiten (I-1). Es simulador del servidor: las pantallas pintan el campo, ⛔ no lo suman (DCO-F6).
 */
export function mockProjectUnit(
  priceBeforeCents: number,
  u: number,
): { unitPriceCents: number; unitDiscountCents?: number; unitPriceBeforeDiscountCents?: number } {
  return u > 0
    ? { unitPriceCents: priceBeforeCents - u, unitDiscountCents: u, unitPriceBeforeDiscountCents: priceBeforeCents }
    : { unitPriceCents: priceBeforeCents };
}

/** Igual que `mockProjectUnit` para un renglón de accesorio: `lineTotalCents` = `q ×` cobrado y `lineTotalBeforeDiscountCents`. */
export function mockProjectAccessoryLine<L extends { unitPriceCents: number; quantity: number; lineTotalCents: number }>(l: L, u: number): L {
  if (u <= 0) return l;
  return {
    ...l,
    ...mockProjectUnit(l.unitPriceCents, u),
    lineTotalCents: l.quantity * (l.unitPriceCents - u),
    lineTotalBeforeDiscountCents: l.quantity * l.unitPriceCents,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Almacén mock: códigos, usos, intentos fallidos
// ---------------------------------------------------------------------------------------------------------------

interface MockCode extends DiscountRule {
  id: string;
  code: string;
  batchId: string | null;
  startsAt: string;
  endsAt: string | null;
  maxTotalUses: number | null;
  maxUsesPerCustomer: number | null;
  status: DiscountCodeStatus;
  archivedAt: string | null;
  firstReservedAt: string | null;
  createdAt: string;
}

interface MockRedemption {
  codeId: string;
  status: DiscountRedemptionStatus;
  customer: string;
  at: string;
  kind: 'order' | 'withdrawal';
  folio: string;
  discountCents: number;
  shippingWaivedCents: number;
  totalCents: number;
}

interface MockBatch {
  id: string;
  prefix: string;
  quantity: number;
  createdAt: string;
}

/** §DSC.7 (v1.110.1): `AuditLog` con antes → después, por `entityType` `DiscountCode`/`DiscountCodeBatch`. */
interface MockAudit extends DiscountAuditEntry {
  entityType: 'DiscountCode' | 'DiscountCodeBatch';
  entityId: string;
}

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

function seedCodes(now: number): MockCode[] {
  const base = {
    batchId: null,
    percentPct: null,
    amountCents: null,
    maxDiscountCents: null,
    minSubtotalCents: null,
    productScopes: [] as DiscountProductScope[],
    destinations: [] as FulfillmentMode[],
    startsAt: iso(now - 30 * DAY),
    endsAt: null,
    maxTotalUses: null,
    maxUsesPerCustomer: 1,
    status: 'active' as DiscountCodeStatus,
    archivedAt: null,
    firstReservedAt: null,
    createdAt: iso(now - 30 * DAY),
  };
  return [
    // Los de la maqueta (`docs/mockups/dsc-checkout.html`): 10 % con tope, envío gratis, monto fijo.
    { ...base, ...MOCK_SEPT10_RULE, id: 'dsc-sept10', code: 'SEPT10', maxTotalUses: 100, firstReservedAt: iso(now - 20 * DAY) },
    { ...base, id: 'dsc-envio25', code: 'ENVIO25', kind: 'free_shipping' },
    { ...base, id: 'dsc-nuevo20', code: 'NUEVO20', kind: 'fixed_amount', amountCents: 20000, maxTotalUses: 200 },
    // DL1/DL3 (§DSC-UX.8): un código de 20 caracteres (el máximo) con importe de 5 cifras.
    { ...base, id: 'dsc-largo', code: 'EVENTO-OTONO-2026-AB', kind: 'fixed_amount', amountCents: 1234500 },
    // Con motivo (C6/C7).
    { ...base, id: 'dsc-min2000', code: 'MINIMO2000', kind: 'percent', percentPct: 10, minSubtotalCents: 200000 },
    { ...base, id: 'dsc-sellado15', code: 'SELLADO15', kind: 'percent', percentPct: 15, productScopes: ['sealed'] },
    { ...base, id: 'dsc-casa10', code: 'CASA10', kind: 'percent', percentPct: 10, destinations: ['direct_ship'] },
    // Genéricos (C5): pausado, vencido, programado, agotado.
    { ...base, id: 'dsc-boveda10', code: 'BOVEDA10', kind: 'percent', percentPct: 10, minSubtotalCents: 100000, status: 'paused' },
    { ...base, id: 'dsc-verano15', code: 'VERANO15', kind: 'percent', percentPct: 15, startsAt: iso(now - 90 * DAY), endsAt: iso(now - 60 * DAY), maxTotalUses: 100, firstReservedAt: iso(now - 80 * DAY) },
    { ...base, id: 'dsc-futuro', code: 'FUTURO30', kind: 'percent', percentPct: 30, startsAt: iso(now + 10 * DAY) },
    { ...base, id: 'dsc-agotado', code: 'AGOTADO5', kind: 'percent', percentPct: 5, maxTotalUses: 1, firstReservedAt: iso(now - 5 * DAY) },
  ];
}

function seedRedemptions(now: number): MockRedemption[] {
  const r = (codeId: string, status: DiscountRedemptionStatus, i: number, discountCents: number, totalCents: number): MockRedemption => ({
    codeId,
    status,
    customer: `cliente${i}@ejemplo.mx`,
    at: iso(now - i * DAY),
    kind: 'order',
    folio: `TCG-1004${String(80 + i).padStart(2, '0')}`,
    discountCents,
    shippingWaivedCents: 0,
    totalCents,
  });
  return [
    r('dsc-sept10', 'consumed', 1, 42000, 409800),
    r('dsc-sept10', 'consumed', 2, 15000, 162000),
    r('dsc-sept10', 'reserved', 3, 9000, 90500),
    r('dsc-verano15', 'consumed', 4, 30000, 180000),
    r('dsc-agotado', 'consumed', 5, 5000, 99000),
  ];
}

/**
 * Bitácora sembrada de SEPT10 (para que «Cambios» no salga vacía en el modo mock). `action` con los valores de la lista
 * cerrada de §DSC.7 v1.110.2 (`DISCOUNT_AUDIT_ACTIONS`).
 */
function seedAudit(now: number): MockAudit[] {
  const actor = { id: 'usr-owner', name: 'JC' };
  return [
    {
      entityType: 'DiscountCode',
      entityId: 'dsc-sept10',
      at: iso(now - 30 * DAY),
      actor,
      action: 'discount.code.created',
      changes: [
        { field: 'kind', before: null, after: 'percent' },
        { field: 'percentPct', before: null, after: 10 },
        { field: 'maxDiscountCents', before: null, after: 50000 },
        { field: 'maxTotalUses', before: null, after: 50 },
      ],
    },
    {
      entityType: 'DiscountCode',
      entityId: 'dsc-sept10',
      at: iso(now - 10 * DAY),
      actor,
      action: 'discount.code.updated',
      changes: [{ field: 'maxTotalUses', before: 50, after: 100 }],
    },
  ];
}

/** Diales de §DSC.1 (semilla): 10 fallidos en 15 min ⇒ 15 min de bloqueo. */
// ────────────────────────────────────────────────────────────────────────────────────────────
// MOCK §DSC.6 «Dónde se ve el pedido» (914): un pedido YA cobrado con `SEPT10` (10 %), servido por `getOrder` y
// `getAdminOrder` con el id de abajo, y por `trackGuestOrder` con un token `mock…discount…`. Sin código, ningún
// detalle del mock trae `discount` ni `unitDiscountCents` (I-1). Importes ilustrativos, coherentes entre sí:
// exhibido 140 800 − D 14 080 = cobrado 126 720 = `subtotalCents` (I-3); `IVA_INCLUSIVE` ⇒ total = subtotal + comisión.
// ────────────────────────────────────────────────────────────────────────────────────────────
export const MOCK_DISCOUNTED_ORDER_ID = 'ord-dsc-1';
export const MOCK_DISCOUNTED_ORDER_NUMBER = 'TCG-100480';
export const MOCK_ORDER_DISCOUNT: OrderDiscountDTO = {
  code: 'SEPT10',
  kind: 'percent',
  merchandiseBeforeDiscountCents: 140_800,
  discountCents: 14_080,
  shippingWaivedCents: 0,
};
/**
 * La regla de `SEPT10` sembrada (10 %, tope 50 000), para que el seguimiento mock con código pase por `discountOf` en vez de
 * calcular su propio descuento (techlead TL-DSC-6).
 */
export const MOCK_SEPT10_RULE: DiscountRule = {
  kind: 'percent',
  percentPct: 10,
  amountCents: null,
  maxDiscountCents: 50000,
  minSubtotalCents: null,
  productScopes: [],
  destinations: [],
};
/** La rebaja por unidad de su única carta (exhibido 140 800). */
export const MOCK_DISCOUNTED_UNIT_DISCOUNT_CENTS = 14_080;
export const MOCK_DISCOUNTED_ORDER_BREAKDOWN: BreakdownDTO = {
  subtotalCents: 126_720,
  ivaCents: 17_479,
  ivaRatePct: 16,
  processingFeeCents: 4_800,
  totalCents: 131_520,
  currency: 'MXN',
  priceConvention: 'IVA_INCLUSIVE',
  ivaIncluded: true,
};

export const MOCK_DISCOUNT_THROTTLE = { maxFailures: 10, windowMin: 15, blockMin: 15 } as const;

interface State {
  codes: MockCode[];
  redemptions: MockRedemption[];
  batches: MockBatch[];
  audit: MockAudit[];
  /**
   * Intentos fallidos del navegador (una sola clave: el mock no distingue IP). `counted` = los códigos `not_applicable` ya
   * contados en esta ventana (el `countedCodeHashes` de §DSC.1, aquí en claro: es memoria del navegador).
   */
  throttle: { failures: number; windowStartedAt: number; blockedUntil: number | null; counted: Set<string> };
  seq: number;
}

function fresh(now = Date.now()): State {
  return {
    codes: seedCodes(now),
    redemptions: seedRedemptions(now),
    batches: [],
    audit: seedAudit(now),
    throttle: { failures: 0, windowStartedAt: now, blockedUntil: null, counted: new Set() },
    seq: 1,
  };
}

let state: State = fresh();

/** Solo pruebas: vuelve al estado sembrado. */
export function resetMockDiscounts(now = Date.now()): void {
  state = fresh(now);
}

/** §DSC.6: `trim` + mayúsculas (el front además quita espacios al teclear). */
export function normalizeDiscountCode(raw: string): string {
  return raw.trim().toUpperCase();
}

function inUse(codeId: string): number {
  return state.redemptions.filter((r) => r.codeId === codeId && r.status !== 'released').length;
}

function stateOf(c: MockCode, now: number): DiscountCodeState {
  if (c.status === 'paused') return 'paused';
  if (c.endsAt && now >= Date.parse(c.endsAt)) return 'expired';
  if (now < Date.parse(c.startsAt)) return 'scheduled';
  if (c.maxTotalUses != null && inUse(c.id) >= c.maxTotalUses) return 'exhausted';
  return 'live';
}

/** ¿El código «existe» para un cliente? (no archivado, activo, vigente, con usos, y con usos para ESE cliente). */
function liveFor(raw: string, customer: string | null, now: number): MockCode | null {
  const code = normalizeDiscountCode(raw);
  const c = state.codes.find((x) => x.code === code && !x.archivedAt);
  if (!c || stateOf(c, now) !== 'live') return null;
  if (customer && c.maxUsesPerCustomer != null) {
    const mine = state.redemptions.filter((r) => r.codeId === c.id && r.status !== 'released' && r.customer === customer).length;
    if (mine >= c.maxUsesPerCustomer) return null;
  }
  return c;
}

/** §DSC.6 — límite de intentos: durante el bloqueo, todo código (válido incluido) da `rate_limited`. */
function blockedSeconds(now: number): number | null {
  const t = state.throttle;
  if (t.blockedUntil != null && now < t.blockedUntil) return Math.ceil((t.blockedUntil - now) / 1000);
  if (t.blockedUntil != null && now >= t.blockedUntil) {
    state.throttle = { failures: 0, windowStartedAt: now, blockedUntil: null, counted: new Set() };
  }
  return null;
}

/**
 * §DSC.6 «Límite de intentos» (v1.110.3, `HECHOS.md` 2026-10-26 «…un código vigente que no aplica cuenta como intento»):
 * cuentan los `invalid` y los `not_applicable`; un `not_applicable` cuenta UNA vez por código y ventana (`notApplicableCode`),
 * así re-cotizar el mismo código mientras se llena el carrito no bloquea. `applied` no llama aquí.
 */
function countFailure(now: number, notApplicableCode?: string): void {
  const t = state.throttle;
  if (now - t.windowStartedAt > MOCK_DISCOUNT_THROTTLE.windowMin * 60_000) {
    t.failures = 0;
    t.windowStartedAt = now;
    t.counted = new Set();
  }
  if (notApplicableCode !== undefined) {
    if (t.counted.has(notApplicableCode)) return;
    t.counted.add(notApplicableCode);
  }
  t.failures += 1;
  if (t.failures >= MOCK_DISCOUNT_THROTTLE.maxFailures) t.blockedUntil = now + MOCK_DISCOUNT_THROTTLE.blockMin * 60_000;
}

/** Lo que la composición del quote/sesión necesita para cerrar el cálculo (§DSC.4). */
export interface DiscountOrderContext {
  destination: DiscountDestination;
  lines: DiscountLine[];
  /** Correo normalizado o id de cuenta; `null` = el quote no conoce al cliente (lo decide `session`). */
  customer: string | null;
  /**
   * Cierra el pedido con la mercancía descontada `S'` y dice qué pasaría con el envío: `subtotalCents` es `S'`,
   * `freeShipping` pide `E = 0`. Devuelve `null` si el tipo c no aplica (con el motivo) o la composición.
   */
  close: (args: { subtotalCents: number; freeShipping: boolean }) =>
    | { ok: true; totalCents: number; shippingWaivedCents: number }
    | { ok: false; reason: DiscountNotApplicableReason; details?: Record<string, number | string[]> };
  now?: number;
}

/** El resultado del mock para un request con código: el DTO del quote y, si aplica, lo necesario para repintar. */
export type MockDiscountEvaluation =
  | { dto: Exclude<DiscountQuoteDTO, { outcome: 'applied' }>; applied: null }
  | {
      dto: Extract<DiscountQuoteDTO, { outcome: 'applied' }>;
      applied: { discountCents: number; unitDiscounts: Map<string, number>; freeShipping: boolean; codeId: string };
    };

/** Mínimo que Stripe acepta (`StripeService.MIN_CHARGE_CENTS`, §DSC.4 paso 7). */
export const MOCK_MIN_TOTAL_CENTS = 1000;

/**
 * §DSC.6 — evalúa un código para un carrito. `invalid` suma un fallido y `not_applicable` también, una vez por código y
 * ventana (§DSC.6 «Límite de intentos», v1.110.3). Motivos en el orden de §DSC.4 (v1.112.1): `NO_SHIPPING` → `DESTINATION` →
 * `NO_ELIGIBLE_ITEMS` → `LARGE_BOX` → `ALREADY_FREE_SHIPPING` → `MIN_SUBTOTAL` → `TOTAL_BELOW_MINIMUM` → `ZERO_DISCOUNT`
 * (paridad DCO-B20/B22).
 */
export function evaluateMockDiscount(raw: string, ctx: DiscountOrderContext): MockDiscountEvaluation {
  const now = ctx.now ?? Date.now();
  const blocked = blockedSeconds(now);
  if (blocked != null) return { dto: { outcome: 'rate_limited', retryAfterSeconds: blocked }, applied: null };
  const c = liveFor(raw, ctx.customer, now);
  if (!c) {
    countFailure(now);
    return { dto: { outcome: 'invalid' }, applied: null };
  }
  const notApplicable = (reason: DiscountNotApplicableReason, details: Record<string, number | string[]> = {}) => {
    countFailure(now, c.code);
    return { dto: { outcome: 'not_applicable' as const, code: c.code, reason, details }, applied: null };
  };
  // §DSC.8 — el retiro solo acepta envío gratis sin mínimo ni filtros, y destino vacío o con `direct_ship`.
  if (ctx.destination === 'withdrawal') {
    if (c.kind !== 'free_shipping') return notApplicable('WITHDRAWAL_ONLY_FREE_SHIPPING');
    // §DSC.4 (v1.110.3): `WITHDRAWAL_ONLY_FREE_SHIPPING` → `WITHDRAWAL_FILTERED` → `DESTINATION` → `ALREADY_FREE_SHIPPING`.
    if (c.minSubtotalCents != null || c.productScopes.length > 0) return notApplicable('WITHDRAWAL_FILTERED');
    if (c.destinations.length > 0 && !c.destinations.includes('direct_ship')) return notApplicable('DESTINATION');
    const closed = ctx.close({ subtotalCents: 0, freeShipping: true });
    if (!closed.ok) return notApplicable(closed.reason, closed.details);
    return {
      dto: { outcome: 'applied', code: c.code, kind: c.kind, merchandiseBeforeDiscountCents: 0, discountCents: 0, shippingWaivedCents: closed.shippingWaivedCents },
      applied: { discountCents: 0, unitDiscounts: new Map(), freeShipping: true, codeId: c.id },
    };
  }
  const r = discountOf(ctx.lines, c, ctx.destination);
  // 1-3 (`NO_SHIPPING`, `DESTINATION`, `NO_ELIGIBLE_ITEMS`) salen de la parte pura; el mínimo (6) espera.
  if (!r.ok && r.reason !== 'MIN_SUBTOTAL') return notApplicable(r.reason, r.details);
  const S = ctx.lines.reduce((s, l) => s + l.priceCents * l.quantity, 0);
  const freeShipping = c.kind === 'free_shipping';
  // 4-5 (`LARGE_BOX`, `ALREADY_FREE_SHIPPING`) ganan al mínimo: con envío gratis `D = 0`, así que `S' = S` aunque falte mínimo.
  const closed = ctx.close({ subtotalCents: S - (r.ok ? r.discountCents : 0), freeShipping });
  if (freeShipping && !closed.ok) return notApplicable(closed.reason, closed.details);
  if (!r.ok) return notApplicable(r.reason, r.details);
  if (!closed.ok) return notApplicable(closed.reason, closed.details);
  if (closed.totalCents < MOCK_MIN_TOTAL_CENTS) return notApplicable('TOTAL_BELOW_MINIMUM', { minTotalCents: MOCK_MIN_TOTAL_CENTS });
  // 8 (v1.112.1, §DSC.3 / I-7 «ningún uso sin beneficio»): `%`/monto cuyo reparto da `D = 0` (`floor` a 0, `B = U`, o el
  // residuo no cabe) ⇒ no aplica, sin uso apartado y contando intento como todo `not_applicable` (DCO-B22).
  if (!freeShipping && r.discountCents === 0) return notApplicable('ZERO_DISCOUNT');
  return {
    dto: {
      outcome: 'applied',
      code: c.code,
      kind: c.kind,
      merchandiseBeforeDiscountCents: S,
      discountCents: r.discountCents,
      shippingWaivedCents: closed.shippingWaivedCents,
    },
    applied: { discountCents: r.discountCents, unitDiscounts: r.unitDiscounts, freeShipping, codeId: c.id },
  };
}

/** §DSC.5 (simplificado): la sesión aparta el uso. En el mock no hay webhook: se queda `reserved`. */
export function reserveMockDiscount(args: {
  codeId: string;
  customer: string;
  kind: 'order' | 'withdrawal';
  folio: string;
  discountCents: number;
  shippingWaivedCents: number;
  totalCents: number;
  /** §DSC.8: el retiro gratis nace `consumed` (no hay cobro que esperar). */
  consumed?: boolean;
}): void {
  const now = Date.now();
  state.redemptions.push({
    codeId: args.codeId,
    status: args.consumed ? 'consumed' : 'reserved',
    customer: args.customer,
    at: iso(now),
    kind: args.kind,
    folio: args.folio,
    discountCents: args.discountCents,
    shippingWaivedCents: args.shippingWaivedCents,
    totalCents: args.totalCents,
  });
  const c = state.codes.find((x) => x.id === args.codeId);
  if (c && !c.firstReservedAt) c.firstReservedAt = iso(now);
}

/** Para el `422` de la sesión: el mismo DTO que el quote, traducido a error del contrato (§0). */
export function sessionErrorOf(dto: Exclude<DiscountQuoteDTO, { outcome: 'applied' }>): {
  status: number;
  code: string;
  details?: Record<string, unknown>;
} {
  if (dto.outcome === 'rate_limited') {
    return { status: 429, code: 'DISCOUNT_CODE_RATE_LIMITED', details: { retryAfterSeconds: dto.retryAfterSeconds } };
  }
  if (dto.outcome === 'not_applicable') {
    return { status: 422, code: 'DISCOUNT_CODE_NOT_APPLICABLE', details: { reason: dto.reason, ...dto.details } };
  }
  return { status: 422, code: 'DISCOUNT_CODE_INVALID' };
}

// ---------------------------------------------------------------------------------------------------------------
// Panel del dueño (§DSC.7)
// ---------------------------------------------------------------------------------------------------------------

const CREATED_BY = { id: 'usr-owner', name: 'JC' };

/** §DSC.7: Σ `Order.discountCents` con uso `consumed` — la MISMA cuenta que `DiscountReportDTO.discountGivenCents`. */
function discountGivenOf(codeIds: string[]): number {
  return state.redemptions
    .filter((r) => codeIds.includes(r.codeId) && r.status === 'consumed' && r.kind === 'order')
    .reduce((s, r) => s + r.discountCents, 0);
}

function audit(entityType: MockAudit['entityType'], entityId: string, action: DiscountAuditAction, changes: MockAudit['changes']): void {
  if (changes.length === 0) return;
  state.audit.push({ entityType, entityId, at: iso(Date.now()), actor: { ...CREATED_BY }, action, changes });
}

/** Antes → después de los campos que cambian (los iguales no se anotan). */
function diff(before: Record<string, unknown>, after: Record<string, unknown>, fields: readonly string[]): MockAudit['changes'] {
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  return fields.filter((f) => !same(before[f], after[f])).map((f) => ({ field: f, before: before[f] ?? null, after: after[f] ?? null }));
}

const CONFIG_FIELDS = [
  'kind',
  'percentPct',
  'amountCents',
  'maxDiscountCents',
  'minSubtotalCents',
  'productScopes',
  'destinations',
  'startsAt',
  'endsAt',
] as const;
const CODE_FIELDS = [...CONFIG_FIELDS, 'maxTotalUses', 'maxUsesPerCustomer', 'status'] as const;
const asRecord = (x: object) => x as unknown as Record<string, unknown>;

function toDTO(c: MockCode, now = Date.now()): DiscountCodeDTO {
  const consumed = state.redemptions.filter((r) => r.codeId === c.id && r.status === 'consumed').length;
  const reservedNow = state.redemptions.filter((r) => r.codeId === c.id && r.status === 'reserved').length;
  return {
    id: c.id,
    code: c.code,
    batchId: c.batchId,
    kind: c.kind,
    percentPct: c.percentPct,
    amountCents: c.amountCents,
    maxDiscountCents: c.maxDiscountCents,
    minSubtotalCents: c.minSubtotalCents,
    productScopes: [...c.productScopes],
    destinations: [...c.destinations],
    startsAt: c.startsAt,
    endsAt: c.endsAt,
    maxTotalUses: c.maxTotalUses,
    maxUsesPerCustomer: c.maxUsesPerCustomer,
    status: c.status,
    state: stateOf(c, now),
    locked: c.firstReservedAt != null,
    usage: { consumed, reservedNow, limit: c.maxTotalUses, discountGivenCents: discountGivenOf([c.id]) },
    createdAt: c.createdAt,
    createdBy: CREATED_BY,
  };
}

export class MockDiscountError extends Error {
  constructor(
    public status: number,
    public code: string,
    public details?: Record<string, unknown>,
  ) {
    super(code);
  }
}

export function mockListCodes(q: {
  status?: DiscountCodeStatus;
  state?: DiscountCodeState;
  batchId?: string;
  q?: string;
}): DiscountCodeDTO[] {
  const now = Date.now();
  return state.codes
    .filter((c) => !c.archivedAt)
    .filter((c) => (q.batchId ? c.batchId === q.batchId : c.batchId === null))
    .map((c) => toDTO(c, now))
    .filter((d) => (q.status ? d.status === q.status : true))
    .filter((d) => (q.state ? d.state === q.state : true))
    .filter((d) => (q.q ? d.code.startsWith(normalizeDiscountCode(q.q)) : true))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function mockGetCode(id: string): DiscountCodeDTO {
  const c = state.codes.find((x) => x.id === id && !x.archivedAt);
  if (!c) throw new MockDiscountError(404, 'NOT_FOUND');
  return toDTO(c);
}

const CODE_RE = /^[A-Z0-9-]{4,20}$/;

/** §DSC.7 `422 VALIDATION_ERROR` por `kind` (la misma lista de campos que el servidor valida). */
function validateConfig(b: Partial<DiscountRule> & { kind?: DiscountKind; endsAt?: string | null; startsAt?: string }): void {
  const bad = (field: string) => {
    throw new MockDiscountError(422, 'VALIDATION_ERROR', { field });
  };
  if (b.kind === 'percent' && !(Number.isInteger(b.percentPct) && b.percentPct! >= 1 && b.percentPct! <= 100)) bad('percentPct');
  if (b.kind === 'fixed_amount' && !(Number.isInteger(b.amountCents) && b.amountCents! >= 1)) bad('amountCents');
  if (b.kind === 'free_shipping' && b.destinations?.length === 1 && b.destinations[0] === 'vault') bad('destinations');
  // Como `validateConfig` del backend sobre la config FUSIONADA: un campo de otro tipo que sobrevive a un PATCH se rechaza.
  if (b.percentPct != null && b.kind !== 'percent') bad('percentPct');
  if (b.amountCents != null && b.kind !== 'fixed_amount') bad('amountCents');
  if (b.maxDiscountCents != null && (b.kind !== 'percent' || b.maxDiscountCents < 1)) bad('maxDiscountCents');
  if (b.minSubtotalCents != null && b.minSubtotalCents < 1) bad('minSubtotalCents');
  if (b.endsAt && b.startsAt && Date.parse(b.endsAt) <= Date.parse(b.startsAt)) bad('endsAt');
}

export function mockCreateCode(body: import('@/types/contract').DiscountCodeCreateRequest): DiscountCodeDTO {
  const code = normalizeDiscountCode(body.code);
  if (!CODE_RE.test(code)) throw new MockDiscountError(422, 'VALIDATION_ERROR', { field: 'code' });
  if (state.codes.some((c) => c.code === code)) throw new MockDiscountError(409, 'DISCOUNT_CODE_TAKEN');
  const startsAt = body.startsAt ?? iso(Date.now());
  validateConfig({ ...body, startsAt });
  const c: MockCode = {
    id: `dsc-${state.seq++}-${code.toLowerCase()}`,
    code,
    batchId: null,
    kind: body.kind,
    percentPct: body.kind === 'percent' ? body.percentPct ?? null : null,
    amountCents: body.kind === 'fixed_amount' ? body.amountCents ?? null : null,
    maxDiscountCents: body.kind === 'percent' ? body.maxDiscountCents ?? null : null,
    minSubtotalCents: body.minSubtotalCents ?? null,
    productScopes: body.productScopes ?? [],
    destinations: body.destinations ?? [],
    startsAt,
    endsAt: body.endsAt ?? null,
    maxTotalUses: body.maxTotalUses ?? null,
    maxUsesPerCustomer: body.maxUsesPerCustomer === undefined ? 1 : body.maxUsesPerCustomer,
    status: 'active',
    archivedAt: null,
    firstReservedAt: null,
    createdAt: iso(Date.now()),
  };
  state.codes.push(c);
  audit('DiscountCode', c.id, 'discount.code.created', diff({}, asRecord(c), ['code', ...CODE_FIELDS]));
  return toDTO(c);
}

/** Campos editables tras el primer uso (§DSC.7, criterio 912). */
export const UNLOCKED_FIELDS = ['status', 'endsAt', 'maxTotalUses'] as const;

export function mockPatchCode(id: string, patch: import('@/types/contract').DiscountCodePatchRequest): DiscountCodeDTO {
  const c = state.codes.find((x) => x.id === id && !x.archivedAt);
  if (!c) throw new MockDiscountError(404, 'NOT_FOUND');
  // §DSC.7 (v1.112.1): ausente ⇒ no se toca; `null` limpia; `productScopes`/`destinations` `null` ≡ `[]`; `startsAt: null` ⇒ 422.
  if ('startsAt' in patch && (patch as { startsAt?: unknown }).startsAt === null) {
    throw new MockDiscountError(422, 'VALIDATION_ERROR', { field: 'startsAt' });
  }
  const changes: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    changes[k] = (k === 'productScopes' || k === 'destinations') && v === null ? [] : v;
  }
  // `lockedFields` = los campos cuyo valor CAMBIA (un `null` que limpia cuenta; uno sobre un campo ya nulo, no), como el backend.
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const changed = Object.keys(changes).filter((k) => !same((c as unknown as Record<string, unknown>)[k], changes[k]));
  if (c.firstReservedAt) {
    const lockedFields = changed.filter((k) => !(UNLOCKED_FIELDS as readonly string[]).includes(k));
    if (lockedFields.length > 0) throw new MockDiscountError(409, 'DISCOUNT_CODE_LOCKED', { lockedFields });
    if (c.batchId && changed.includes('maxTotalUses')) throw new MockDiscountError(409, 'DISCOUNT_CODE_LOCKED', { lockedFields: ['maxTotalUses'] });
  }
  if (changes.maxTotalUses != null && (changes.maxTotalUses as number) < inUse(c.id)) {
    throw new MockDiscountError(409, 'DISCOUNT_CODE_LIMIT_BELOW_USES', { inUse: inUse(c.id) });
  }
  const next = { ...c, ...changes } as MockCode;
  validateConfig(next);
  const before = { ...c };
  Object.assign(c, changes);
  audit('DiscountCode', c.id, 'discount.code.updated', diff(asRecord(before), asRecord(c), CODE_FIELDS));
  return toDTO(c);
}

export function mockSetCodeStatus(id: string, status: DiscountCodeStatus): DiscountCodeDTO {
  const c = state.codes.find((x) => x.id === id && !x.archivedAt);
  if (!c) throw new MockDiscountError(404, 'NOT_FOUND');
  // Idempotente (§DSC.7): sin cambio no hay fila de bitácora.
  if (c.status !== status) audit('DiscountCode', c.id, status === 'paused' ? 'discount.code.paused' : 'discount.code.resumed', [{ field: 'status', before: c.status, after: status }]);
  c.status = status;
  return toDTO(c);
}

export function mockArchiveCode(id: string): void {
  const c = state.codes.find((x) => x.id === id && !x.archivedAt);
  if (!c) throw new MockDiscountError(404, 'NOT_FOUND');
  if (state.redemptions.some((r) => r.codeId === id)) throw new MockDiscountError(409, 'DISCOUNT_CODE_HAS_USES');
  c.archivedAt = iso(Date.now());
  audit('DiscountCode', c.id, 'discount.code.archived', [{ field: 'archivedAt', before: null, after: c.archivedAt }]);
}

/** §DSC.7 — alfabeto de los códigos de lote (sin 0/O/1/I/L/U). */
export const BATCH_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';

function randomSuffix(): string {
  let s = '';
  for (let i = 0; i < 10; i++) s += BATCH_ALPHABET[Math.floor(Math.random() * BATCH_ALPHABET.length)];
  return s;
}

/**
 * §DSC.7 (v1.110.2): `status` paused ⇔ ningún código SIN USAR (sin `reserved` ni `consumed`) está `active`; si no queda
 * ninguno sin usar, paused ⇔ TODOS pausados (lote agotado y no pausado = `active` + `exhausted`). `state` con la
 * precedencia de `DiscountCodeDTO` y `exhausted` ⇔ todos `consumed`; `locked` ⇔ alguno con `firstReservedAt`.
 */
function batchDTO(b: MockBatch, now = Date.now()): DiscountCodeBatchDTO {
  const codes = state.codes.filter((c) => c.batchId === b.id);
  const first = codes[0];
  const isConsumed = (c: MockCode) => state.redemptions.some((r) => r.codeId === c.id && r.status === 'consumed');
  const used = codes.filter(isConsumed).length;
  const reservedNow = state.redemptions.filter((r) => r.status === 'reserved' && codes.some((c) => c.id === r.codeId)).length;
  const unused = codes.filter((c) => inUse(c.id) === 0);
  const pool = unused.length > 0 ? unused : codes;
  const status: DiscountCodeStatus = pool.some((c) => c.status === 'active') ? 'active' : 'paused';
  const st: DiscountCodeState =
    status === 'paused'
      ? 'paused'
      : first.endsAt && now >= Date.parse(first.endsAt)
        ? 'expired'
        : now < Date.parse(first.startsAt)
          ? 'scheduled'
          : codes.every(isConsumed)
            ? 'exhausted'
            : 'live';
  return {
    id: b.id,
    prefix: b.prefix,
    quantity: b.quantity,
    createdAt: b.createdAt,
    createdBy: { ...CREATED_BY },
    kind: first.kind,
    percentPct: first.percentPct,
    amountCents: first.amountCents,
    maxDiscountCents: first.maxDiscountCents,
    minSubtotalCents: first.minSubtotalCents,
    productScopes: [...first.productScopes],
    destinations: [...first.destinations],
    startsAt: first.startsAt,
    endsAt: first.endsAt,
    status,
    state: st,
    usedCodes: used,
    reservedNow,
    locked: codes.some((c) => c.firstReservedAt != null),
  };
}

export function mockCreateBatch(body: import('@/types/contract').DiscountCodeBatchCreateRequest): {
  batch: DiscountCodeBatchDTO;
  codesCsvPath: string;
} {
  const prefix = normalizeDiscountCode(body.prefix);
  if (!/^[A-Z0-9]{2,8}$/.test(prefix)) throw new MockDiscountError(422, 'VALIDATION_ERROR', { field: 'prefix' });
  if (!(Number.isInteger(body.quantity) && body.quantity >= 1 && body.quantity <= 500)) {
    throw new MockDiscountError(422, 'VALIDATION_ERROR', { field: 'quantity' });
  }
  const startsAt = body.startsAt ?? iso(Date.now());
  validateConfig({ ...body, startsAt });
  const b: MockBatch = { id: `batch-${state.seq++}`, prefix, quantity: body.quantity, createdAt: iso(Date.now()) };
  state.batches.push(b);
  for (let i = 0; i < body.quantity; i++) {
    let code = `${prefix}-${randomSuffix()}`;
    while (state.codes.some((c) => c.code === code)) code = `${prefix}-${randomSuffix()}`;
    state.codes.push({
      id: `${b.id}-${i}`,
      code,
      batchId: b.id,
      kind: body.kind,
      percentPct: body.kind === 'percent' ? body.percentPct ?? null : null,
      amountCents: body.kind === 'fixed_amount' ? body.amountCents ?? null : null,
      maxDiscountCents: body.kind === 'percent' ? body.maxDiscountCents ?? null : null,
      minSubtotalCents: body.minSubtotalCents ?? null,
      productScopes: body.productScopes ?? [],
      destinations: body.destinations ?? [],
      startsAt,
      endsAt: body.endsAt ?? null,
      maxTotalUses: 1,
      maxUsesPerCustomer: 1,
      status: 'active',
      archivedAt: null,
      firstReservedAt: null,
      createdAt: b.createdAt,
    });
  }
  audit('DiscountCodeBatch', b.id, 'discount.batch.created', [
    { field: 'prefix', before: null, after: prefix },
    { field: 'quantity', before: null, after: body.quantity },
    ...diff({}, asRecord(state.codes.find((c) => c.batchId === b.id)!), CONFIG_FIELDS),
  ]);
  return { batch: batchDTO(b), codesCsvPath: `/admin/discount-code-batches/${b.id}/codes.csv` };
}

export function mockListBatches(): DiscountCodeBatchDTO[] {
  return state.batches.map((b) => batchDTO(b)).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function mockGetBatch(id: string): DiscountCodeBatchDTO {
  const b = state.batches.find((x) => x.id === id);
  if (!b) throw new MockDiscountError(404, 'NOT_FOUND');
  return batchDTO(b);
}

/** §DSC.7 (911): pausa/reanuda los N códigos del lote en una sola operación (todos, como `updateMany` del backend). */
export function mockSetBatchStatus(id: string, status: DiscountCodeStatus): DiscountCodeBatchDTO {
  const b = state.batches.find((x) => x.id === id);
  if (!b) throw new MockDiscountError(404, 'NOT_FOUND');
  const before = batchDTO(b).status;
  for (const c of state.codes) if (c.batchId === id) c.status = status;
  const after = batchDTO(b).status;
  if (before !== after) {
    audit('DiscountCodeBatch', b.id, status === 'paused' ? 'discount.batch.paused' : 'discount.batch.resumed', [{ field: 'status', before, after }]);
  }
  return batchDTO(b);
}

/** §DSC.7 — `code,status,usedAt` con la defensa CSV de §15.7 (los códigos no empiezan por `=+-@`: alfabeto propio). */
export function mockBatchCsv(id: string): string {
  const b = state.batches.find((x) => x.id === id);
  if (!b) throw new MockDiscountError(404, 'NOT_FOUND');
  const lines = state.codes
    .filter((c) => c.batchId === id)
    .map((c) => {
      const used = state.redemptions.find((r) => r.codeId === c.id && r.status === 'consumed');
      return `${c.code},${c.status},${used ? used.at : ''}`;
    });
  return ['code,status,usedAt', ...lines].join('\n') + '\n';
}

/** Descarga auditada (`discount.batch.codes_exported` / `discount.{code,batch}.report_exported`): una fila con lo que salió. */
export function mockAuditExport(
  entityType: MockAudit['entityType'],
  id: string,
  action: Extract<DiscountAuditAction, `${string}_exported`>,
  rows: number,
): void {
  audit(entityType, id, action, [{ field: action === 'discount.batch.codes_exported' ? 'codes' : 'rows', before: null, after: rows }]);
}

function reportFor(codeIds: string[], limit: number | null, batch: boolean): DiscountReportDTO {
  const rs = state.redemptions.filter((r) => codeIds.includes(r.codeId));
  const consumed = rs.filter((r) => r.status === 'consumed');
  const orders = consumed.filter((r) => r.kind === 'order');
  const withdrawals = consumed.filter((r) => r.kind === 'withdrawal');
  const codeOf = (id: string) => state.codes.find((c) => c.id === id)?.code ?? '';
  return {
    consumed: consumed.length,
    reservedNow: rs.filter((r) => r.status === 'reserved').length,
    limit,
    paidOrders: orders.length,
    discountGivenCents: discountGivenOf(codeIds),
    shippingWaivedOrdersCents: orders.reduce((s, r) => s + r.shippingWaivedCents, 0),
    shippingWaivedWithdrawalsCents: withdrawals.reduce((s, r) => s + r.shippingWaivedCents, 0),
    withdrawals: withdrawals.length,
    salesCollectedCents: orders.reduce((s, r) => s + r.totalCents, 0),
    refundedOrders: 0,
    refundedCents: 0,
    lateConsumed: 0,
    rows: rs.map((r) => ({
      at: r.at,
      kind: r.kind,
      folio: r.folio,
      customerEmail: r.customer,
      code: codeOf(r.codeId),
      discountCents: r.discountCents,
      shippingWaivedCents: r.shippingWaivedCents,
      totalCents: r.totalCents,
      refundedCents: 0,
      status: r.status,
    })),
    ...(batch ? { usedCodes: consumed.map((r) => ({ code: codeOf(r.codeId), at: r.at })) } : {}),
  };
}

export function mockCodeReport(id: string): DiscountReportDTO {
  const c = state.codes.find((x) => x.id === id);
  if (!c) throw new MockDiscountError(404, 'NOT_FOUND');
  return reportFor([id], c.maxTotalUses, false);
}

export function mockBatchReport(id: string): DiscountReportDTO {
  const b = state.batches.find((x) => x.id === id);
  if (!b) throw new MockDiscountError(404, 'NOT_FOUND');
  const ids = state.codes.filter((c) => c.batchId === id).map((c) => c.id);
  return reportFor(ids, b.quantity, true);
}

/** CSV del reporte (pesos con 2 decimales, §15.7). */
export function mockReportCsv(r: DiscountReportDTO): string {
  const pesos = (c: number) => (c / 100).toFixed(2);
  const rows = r.rows.map((x) =>
    [x.at, x.kind, x.folio, x.customerEmail ?? '', x.code, pesos(x.discountCents), pesos(x.shippingWaivedCents), pesos(x.totalCents), pesos(x.refundedCents), x.status].join(','),
  );
  return ['at,kind,folio,customerEmail,code,discount,shippingWaived,total,refunded,status', ...rows].join('\n') + '\n';
}

/** §DSC.7 (v1.110.1) — bitácora de un código o de un lote, la más reciente primero. */
export function mockAudit(entityType: MockAudit['entityType'], id: string): DiscountAuditEntry[] {
  const exists = entityType === 'DiscountCode' ? state.codes.some((c) => c.id === id) : state.batches.some((b) => b.id === id);
  if (!exists) throw new MockDiscountError(404, 'NOT_FOUND');
  return state.audit
    .filter((a) => a.entityType === entityType && a.entityId === id)
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .map(({ at, actor, action, changes }) => ({ at, actor: actor ? { ...actor } : null, action, changes: changes.map((c) => ({ ...c })) }));
}

/**
 * §DSC.7 (v1.110.1) — `POST /admin/discount-codes/preview`: `discountOf`/`allocateDiscount` sobre el carrito de
 * ejemplo, cero escrituras. Destino del ejemplo: domicilio si la config lo admite; si no, bóveda.
 * v1.110.2: muestra a la que no aplica (mínimo, filtros, destino) ⇒ `{ 0, 0, false }` sin motivo; `free_shipping` ⇒
 * siempre `{ 0, 0, false }` (la muestra no lleva envío); v1.112.1: `ZERO_DISCOUNT` ⇒ `{ 0, 0, false }`.
 */
export function mockPreview(body: DiscountPreviewRequest): DiscountPreviewResponse {
  validateConfig({ ...body, startsAt: body.startsAt ?? iso(Date.now()) });
  if (!Array.isArray(body.sampleLines) || body.sampleLines.length < 1 || body.sampleLines.length > 5) {
    throw new MockDiscountError(422, 'VALIDATION_ERROR', { field: 'sampleLines' });
  }
  const rule: DiscountRule = {
    kind: body.kind,
    percentPct: body.percentPct ?? null,
    amountCents: body.amountCents ?? null,
    maxDiscountCents: body.maxDiscountCents ?? null,
    minSubtotalCents: body.minSubtotalCents ?? null,
    productScopes: body.productScopes ?? [],
    destinations: body.destinations ?? [],
  };
  const lines: DiscountLine[] = body.sampleLines.map((l, i) => ({
    id: `sample-${i}`,
    kind: l.scope === 'accessory' ? 'accessory' : 'item',
    scope: l.scope,
    priceCents: l.priceCents,
    quantity: l.quantity,
  }));
  const dest: FulfillmentMode = rule.destinations.length === 0 || rule.destinations.includes('direct_ship') ? 'direct_ship' : 'vault';
  const r = discountOf(lines, rule, dest);
  // v1.112.1: `ZERO_DISCOUNT` (reparto con `D = 0`) también ⇒ `{ 0, 0, false }`, aunque `D0 > 0`.
  if (!r.ok || rule.kind === 'free_shipping' || r.discountCents === 0) return { discountCents: 0, nominalCents: 0, capped: false };
  // v1.110.3 (DCO-B21): `nominalCents` y `capped` tal cual los da `discountOf`; aquí no se recalcula nada.
  return { discountCents: r.discountCents, nominalCents: r.nominalCents, capped: r.capped };
}
