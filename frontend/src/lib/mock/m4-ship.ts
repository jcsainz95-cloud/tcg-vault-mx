/**
 * MOCK · SERVIDOR FALSO de §M4-SHIP v1.80.6 (docs/API_CONTRACT.md §M4-SHIP.1–.18, §M3, §5, §0).
 *
 * Replica la conducta observable del contrato —códigos de error, idempotencias y los importes que el
 * servidor calcula— para que la pantalla se construya y se pruebe contra lo que el backend va a
 * responder. ⛔ La pantalla NUNCA calcula un importe: aquí se calculan porque este módulo hace de
 * servidor (`refundPreviewCents`, el reparto Stripe/SPEI, `dueAt`/`overdue`).
 *
 * Estado vivo en memoria del navegador: se reinicia con cada carga completa y con `resetMockM4Ship()`.
 * Los ids de piezas y clientes son los de `fixtures.ts` (Ash, Misty, Ana, Bruno, Gary).
 */
import { SHIPPED_REFUND_REASONS } from '@/types/contract';
import type {
  FullRefundReviewDTO,
  RecordShippedRefundReasonRequest,
  RecordShippedRefundReasonResponse,
  ShippedRefundReason,
  HoldingDTO,
  AdminOrderDetailDTO,
  AdminRefundRowDTO,
  AdminRefundsFilters,
  AdminRefundsResponse,
  AdminShipmentDTO,
  CaseRefundPreviewDTO,
  CaseRefundRequest,
  CaseRefundResponse,
  ChargebackInventoryRequest,
  ChargebackInventoryResponse,
  ManualRefundDTO,
  ManualRefundsFilters,
  ManualRefundsResponse,
  MarkManualRefundPaidRequest,
  MissingReason,
  OperatorRefundSummaryResponse,
  PaymentRefundDTO,
  PickingListSummaryDTO,
  PreparationItemStatus,
  ReclaimVaultRequest,
  ReclaimVaultResponse,
  RefundOrderRequest,
  RefundOrderResponse,
  ReplaceCaseRequest,
  ReplaceCaseResponse,
  ReplacementCandidateDTO,
  ReplacementCaseDTO,
  ReplacementCaseDetailDTO,
  ReplacementCaseRefDTO,
  ReplacementCasesFilters,
  RevealManualRefundClabeResponse,
  Role,
  SetShipPrepItemResponse,
  ShipmentStatus,
  ShipPreparationItemDTO,
  ShipPreparationOrderDTO,
  ShipPreparationStateDTO,
  UnprepareShipmentResponse,
  PrepareShipmentResponse,
  VaultPieceDTO,
  VoidCaseResponse,
} from '@/types/contract';
import { ApiFixtureError, ApiFixtureNotFound } from './fixtures';
import { withdrawabilityOf } from './holding-withdrawable';
import {
  caseRefundComponents,
  caseRefundContextOf,
  itemMissingAmountCents,
  itemMissingRefundComponents,
  manualRefundComponentsOf,
  subtractRefundComponents,
  type RefundComponents,
} from './refund-math';

// ────────────────────────────────────────────────────────────────────────────────────────────
// Actores y constantes del servidor falso
// ────────────────────────────────────────────────────────────────────────────────────────────

export const MOCK_SHIP_OPERATOR = { userId: 'u-op1', name: 'Operador Bóveda' };
const MOCK_SUPER = { userId: 'u-sa1', name: 'Dueño' };
/** Dial `operator_refund_cap_24h_cents` (seed D-3 = MX$5,000). */
export const MOCK_OPERATOR_REFUND_CAP_CENTS = 500_000;
/** Dial `case_refund_hard_multiplier` (seed 5) y la constante `CASE_REFUND_CONFIRM_MULTIPLIER` (2). */
const CASE_REFUND_HARD_MULTIPLIER = 5;
const CASE_REFUND_CONFIRM_MULTIPLIER = 2;
/** `REPLACEMENT_CASE_DUE_MS` = 7 × 24 h (§M4-SHIP.15.12). */
export const REPLACEMENT_CASE_DUE_MS = 7 * 24 * 3600 * 1000;
const CLABE_RECENT_CHANGE_MS = 72 * 3600 * 1000;

function nowIso(): string {
  return new Date().toISOString();
}
function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
}
function clone<T>(v: T): T {
  return structuredClone(v);
}
let seq = 100;
function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}-${seq}`;
}

/** Quién llama al servidor falso: el dial local de rol del back-office (`lib/role.tsx`). */
export function mockCallerRole(): Role {
  if (typeof window === 'undefined') return 'super_admin';
  const stored = window.localStorage.getItem('tcg.role');
  return stored === 'vault_operator' || stored === 'customer' ? stored : 'super_admin';
}
function callerActor(): { userId: string; name: string | null } {
  return mockCallerRole() === 'super_admin' ? MOCK_SUPER : MOCK_SHIP_OPERATOR;
}
function requireSuperAdmin(): void {
  if (mockCallerRole() !== 'super_admin') {
    throw new ApiFixtureError(403, 'MONEY_OUT_FORBIDDEN', 'Only super_admin may execute money-out actions');
  }
}

// ────────────────────────────────────────────────────────────────────────────────────────────
// Órdenes de origen (columnas PERSISTIDAS, §M4-SHIP.4) y la fórmula de `item_missing`
// ────────────────────────────────────────────────────────────────────────────────────────────

interface MockOriginOrder {
  id: string;
  orderNumber: string;
  status: 'settled' | 'refunded' | 'chargeback';
  fulfillmentMode: 'direct_ship' | 'vault';
  userId: string | null;
  priceConvention: 'IVA_INCLUSIVE' | 'IVA_EXCLUSIVE';
  subtotalCents: number; // S
  shippingFeeCents: number; // E
  processingFeeCents: number; // F
  ivaCents: number;
  ivaRatePct: number;
  totalCents: number;
  /** `PaymentRefund` `order_full` viva (requested|submitted) ⇒ la carta no entra a una caja (SEC-SHIP-A5 (b)). */
  pendingFullRefund: boolean;
  fullRefundClosedAt: string | null;
  /** MOCK §M4-SHIP.18.12 (1): sello «el reembolso total llegó con el pedido ya enviado». */
  fullRefundAfterShipment?: boolean;
  /** MOCK §M4-SHIP.18.12 (1)/(6): el motivo registrado (M3 o el registro posterior). */
  shippedRefund?: { reason: ShippedRefundReason; note: string | null; at: string; by: { id: string; name: string | null } } | null;
  chargebackNeedsManual: boolean;
}

/**
 * El ejemplo que se le enseña al dueño (§M4-SHIP.4, D-1): cartas de MX$500 y MX$300, envío MX$150,
 * comisión MX$46.17 ⇒ total MX$996.17. Falta la de MX$300 ⇒ **MX$314.58**.
 */
const ORIGIN_ORDERS: Record<string, MockOriginOrder> = {
  'ord-5001': {
    id: 'ord-5001', orderNumber: 'TCG-000123', status: 'settled', fulfillmentMode: 'direct_ship', userId: 'u-780',
    priceConvention: 'IVA_INCLUSIVE', subtotalCents: 80_000, shippingFeeCents: 15_000, processingFeeCents: 4_617,
    ivaCents: 13_103, ivaRatePct: 16, totalCents: 99_617, pendingFullRefund: false, fullRefundClosedAt: null,
    chargebackNeedsManual: false,
  },
  'ord-5002': {
    id: 'ord-5002', orderNumber: 'TCG-000124', status: 'settled', fulfillmentMode: 'direct_ship', userId: null,
    priceConvention: 'IVA_INCLUSIVE', subtotalCents: 65_000, shippingFeeCents: 15_000, processingFeeCents: 3_886,
    ivaCents: 11_034, ivaRatePct: 16, totalCents: 83_886, pendingFullRefund: false, fullRefundClosedAt: null,
    chargebackNeedsManual: false,
  },
  // Compra a BÓVEDA de Misty (origen de las cartas de su retiro `shp-7002`).
  'ord-4101': {
    id: 'ord-4101', orderNumber: 'TCG-000101', status: 'settled', fulfillmentMode: 'vault', userId: 'u-778',
    priceConvention: 'IVA_INCLUSIVE', subtotalCents: 70_000, shippingFeeCents: 0, processingFeeCents: 3_415,
    ivaCents: 9_655, ivaRatePct: 16, totalCents: 73_415, pendingFullRefund: false, fullRefundClosedAt: null,
    chargebackNeedsManual: false,
  },
  // Compra a BÓVEDA de Gary (origen de su retiro preparado `shp-7006` con un caso abierto).
  'ord-4102': {
    id: 'ord-4102', orderNumber: 'TCG-000102', status: 'settled', fulfillmentMode: 'vault', userId: 'u-781',
    priceConvention: 'IVA_INCLUSIVE', subtotalCents: 90_000, shippingFeeCents: 0, processingFeeCents: 4_336,
    ivaCents: 12_414, ivaRatePct: 16, totalCents: 94_336, pendingFullRefund: false, fullRefundClosedAt: null,
    chargebackNeedsManual: false,
  },
  // Compra a BÓVEDA de Ana (origen del caso vencido `rc-9002` y del cerrado `rc-9003`).
  'ord-4103': {
    id: 'ord-4103', orderNumber: 'TCG-000103', status: 'settled', fulfillmentMode: 'vault', userId: 'u-777',
    priceConvention: 'IVA_INCLUSIVE', subtotalCents: 120_000, shippingFeeCents: 0, processingFeeCents: 5_749,
    ivaCents: 16_552, ivaRatePct: 16, totalCents: 125_749, pendingFullRefund: false, fullRefundClosedAt: null,
    chargebackNeedsManual: false,
  },
  // M3: compra a bóveda de Ana ya liquidada y colocada (`ord-9001` del listado de M3).
  'ord-9001': {
    id: 'ord-9001', orderNumber: 'TCG-009001', status: 'settled', fulfillmentMode: 'vault', userId: 'u-777',
    priceConvention: 'IVA_INCLUSIVE', subtotalCents: 160_000, shippingFeeCents: 0, processingFeeCents: 8_520,
    ivaCents: 22_069, ivaRatePct: 16, totalCents: 168_520, pendingFullRefund: false, fullRefundClosedAt: null,
    chargebackNeedsManual: false,
  },
  // M3: compra a bóveda de Bruno YA reembolsada entera (por webhook), con una carta en caja.
  'ord-9004': {
    id: 'ord-9004', orderNumber: 'TCG-009004', status: 'refunded', fulfillmentMode: 'vault', userId: 'u-778',
    priceConvention: 'IVA_INCLUSIVE', subtotalCents: 45_000, shippingFeeCents: 0, processingFeeCents: 2_400,
    ivaCents: 6_207, ivaRatePct: 16, totalCents: 47_400, pendingFullRefund: false, fullRefundClosedAt: isoDaysAgo(1),
    chargebackNeedsManual: true,
  },
};
let origins: Record<string, MockOriginOrder> = clone(ORIGIN_ORDERS);

/** `item_missing`: `P + floor(F × P / G)` sobre columnas persistidas (§M4-SHIP.4) — el espejo `refund-math`, un cuerpo. */
function itemMissingCents(o: MockOriginOrder, unitPriceCents: number): number {
  return itemMissingAmountCents(o, unitPriceCents);
}
/** Σ Stripe no fallidas sobre la orden. */
function refundedOnOrder(orderId: string): number {
  return refunds.filter((r) => r.orderId === orderId && r.status !== 'failed').reduce((s, r) => s + r.amountCents, 0);
}

// ────────────────────────────────────────────────────────────────────────────────────────────
// El libro de reembolsos (`PaymentRefund`)
// ────────────────────────────────────────────────────────────────────────────────────────────

interface MockRefundRow extends PaymentRefundDTO {
  orderId: string | null;
  shipmentRequestId: string | null;
  shipmentItemId: string | null;
  orderItemInventoryId: string | null;
  replacementCaseId: string | null;
  customerUserId: string | null;
  orderNumber: string | null;
  item: { folio: string; cardName: string } | null;
  /** Stripe transitorio en el primer intento: la fila se queda `requested` hasta `retry`. */
  stripeTransientOnce?: boolean;
  /** Componentes CONGELADOS de la fila (M-61); `toManual` los copia tal cual (`stripe_failed`). */
  components?: RefundComponents;
}

function seedRefunds(): MockRefundRow[] {
  return [
    // Un reembolso de OPERADOR de ayer (item_missing de un directo ya enviado) — alimenta la vista del súper-admin.
    {
      id: 'pr-8001', kind: 'item_missing', status: 'succeeded', amountCents: 31_458, missingReason: 'not_found',
      requestedAt: isoDaysAgo(1), requestedBy: { ...MOCK_SHIP_OPERATOR, role: 'vault_operator' },
      submittedAt: isoDaysAgo(1), succeededAt: isoDaysAgo(1), failedAt: null, failureCode: null,
      orderId: 'ord-5003', shipmentRequestId: 'shp-7001', shipmentItemId: 'sit-9001-2', orderItemInventoryId: 'inv-1099',
      replacementCaseId: null, customerUserId: 'u-777', orderNumber: 'TCG-000120', item: { folio: 'INV-000199', cardName: 'Ponyta' },
    },
    // Un `case_refund` que Stripe RECHAZÓ en definitiva (→ «Pasar a transferencia»).
    {
      id: 'pr-8002', kind: 'case_refund', status: 'failed', amountCents: 40_000, missingReason: null,
      requestedAt: isoDaysAgo(2), requestedBy: { ...MOCK_SUPER, role: 'super_admin' },
      submittedAt: null, succeededAt: null, failedAt: isoDaysAgo(2), failureCode: 'charge_already_refunded',
      orderId: 'ord-4103', shipmentRequestId: null, shipmentItemId: null, orderItemInventoryId: 'inv-1310',
      replacementCaseId: 'rc-9003', customerUserId: 'u-777', orderNumber: 'TCG-000103', item: { folio: 'INV-000311', cardName: 'Growlithe' },
    },
  ];
}
let refunds: MockRefundRow[] = seedRefunds();

function toRefundDTO(r: MockRefundRow): PaymentRefundDTO {
  const { id, kind, status, amountCents, missingReason, requestedAt, requestedBy, submittedAt, succeededAt, failedAt, failureCode } = r;
  return { id, kind, status, amountCents, missingReason, requestedAt, requestedBy, submittedAt, succeededAt, failedAt, failureCode };
}

/** `executeRefund` (§M4-SHIP.7): fuera de la tx. El doble de Stripe acepta salvo la fila marcada transitoria. */
function executeRefund(r: MockRefundRow): void {
  if (r.status !== 'requested') return;
  if (r.stripeTransientOnce) {
    r.stripeTransientOnce = false; // el reintento la encuentra
    return;
  }
  r.status = 'submitted';
  r.submittedAt = nowIso();
}

/** Tope de 24 h del operador (§M4-SHIP.5 paso 6). */
function operatorUsedCents(actorId: string): number {
  const since = Date.now() - 24 * 3600 * 1000;
  return refunds
    .filter((r) => r.requestedBy.userId === actorId && r.kind !== 'order_full' && r.status !== 'failed' && new Date(r.requestedAt).getTime() > since)
    .reduce((s, r) => s + r.amountCents, 0);
}

// ────────────────────────────────────────────────────────────────────────────────────────────
// Piezas de bóveda (para `vaultPieces`, «Mi bóveda» y la clasificación del reclamo)
// ────────────────────────────────────────────────────────────────────────────────────────────

type MockVaultPieceState = VaultPieceDTO['state'];
interface MockVaultPiece {
  orderId: string;
  orderItemId: string;
  inventoryItemId: string;
  folio: string;
  cardName: string;
  unitPriceCents: number;
  state: MockVaultPieceState;
  /** Retiro vivo que la contiene (id), si está en caja. */
  shipmentId: string | null;
  pendingConfirmation: boolean;
}
function seedVaultPieces(): MockVaultPiece[] {
  return [
    // ord-9001 (Ana): una en su cajón, una ya retirada (⇒ M3 exige `confirmPiecesWithCustomer`).
    { orderId: 'ord-9001', orderItemId: 'oi-9001-1', inventoryItemId: 'inv-1002', folio: 'INV-000102', cardName: 'Blastoise', unitPriceCents: 128_000, state: 'in_custody', shipmentId: null, pendingConfirmation: false },
    { orderId: 'ord-9001', orderItemId: 'oi-9001-2', inventoryItemId: 'inv-1090', folio: 'INV-000190', cardName: 'Latias', unitPriceCents: 32_000, state: 'already_withdrawn', shipmentId: null, pendingConfirmation: false },
    // ord-9004 (Bruno, ya reembolsada por webhook): una devuelta pendiente de confirmar, una en caja (retiro con guía).
    { orderId: 'ord-9004', orderItemId: 'oi-9004-1', inventoryItemId: 'inv-1401', folio: 'INV-000401', cardName: 'Onix', unitPriceCents: 20_000, state: 'returned', shipmentId: null, pendingConfirmation: true },
    { orderId: 'ord-9004', orderItemId: 'oi-9004-2', inventoryItemId: 'inv-1402', folio: 'INV-000402', cardName: 'Vulpix', unitPriceCents: 25_000, state: 'in_packed_withdrawal', shipmentId: 'shp-7007', pendingConfirmation: false },
  ];
}
let vaultPieces: MockVaultPiece[] = seedVaultPieces();

function vaultPiecesOf(orderId: string): VaultPieceDTO[] {
  return vaultPieces
    .filter((p) => p.orderId === orderId)
    .map(({ orderItemId, inventoryItemId, folio, cardName, state, pendingConfirmation }) => ({ orderItemId, inventoryItemId, folio, cardName, state, pendingConfirmation }));
}

// ────────────────────────────────────────────────────────────────────────────────────────────
// La cubeta ENVÍO (`ShipPreparationOrderDTO`) — estado vivo
// ────────────────────────────────────────────────────────────────────────────────────────────

interface ShipLineMeta {
  /** Orden de origen del dinero de la línea (`resolveOrigin`), o null ⇒ `no_origin_order`. */
  originOrderId: string | null;
  unitPriceCents: number;
  refundId: string | null;
  caseId: string | null;
}
interface MockShipOrder {
  dto: ShipPreparationOrderDTO;
  meta: Record<string, ShipLineMeta>; // por shipmentItemId
  /** `ShipmentRequest.totalCents` (solo retiro: el cobro propio del envío). */
  shipmentTotalCents: number;
  shipmentFeeCents: number;
  shipmentIvaCents: number;
  shipmentProcessingFeeCents: number;
  status: ShipmentStatus;
}

function shipItem(
  shipmentItemId: string,
  inventoryItemId: string,
  folio: string,
  card: ShipPreparationItemDTO['card'],
  currentLocation: ShipPreparationItemDTO['currentLocation'],
  over: Partial<ShipPreparationItemDTO> = {},
): ShipPreparationItemDTO {
  return {
    shipmentItemId,
    inventoryItemId,
    folio,
    quantity: 1,
    card,
    currentLocation,
    prepStatus: 'pending',
    missingReason: null,
    prepMarkedBy: null,
    availability: { kind: 'available' },
    refund: { kind: 'refundable', amountCents: 0 },
    ...over,
  };
}

function shipSeed(): MockShipOrder[] {
  const shp7004: ShipPreparationOrderDTO = {
    destination: 'ship',
    shipmentId: 'shp-7004',
    kind: 'guest_direct_ship',
    orderId: 'ord-5001',
    orderNumber: 'TCG-000123',
    requestedAt: '2026-08-13T16:45:00Z',
    customer: { userId: 'u-780', email: 'ash@example.com', lastName: 'Ketchum', fullName: 'Ash Ketchum' },
    shipTo: {
      recipientName: 'Ash Ketchum', line1: 'Av. Insurgentes Sur 1234', line2: 'Depto 5B', neighborhood: 'Del Valle',
      city: 'Ciudad de México', state: 'CDMX', postalCode: '03100', country: 'MX', phone: '5551239876',
    },
    preparation: { status: 'in_progress', refundPreviewCents: 0, total: 2, pending: 2, picked: 0, missing: 0, blocked: 0 },
    items: [
      shipItem('sit-9004-1', 'inv-1012', 'INV-000112',
        { name: 'Charizard', setName: 'Base Set', finish: 'holofoil', conditionLabel: 'PSA 9', imageSmallUrl: 'https://images.pokemontcg.io/base1/4.png' },
        { kind: 'assigned', label: 'C01-F01-S02' }),
      shipItem('sit-9004-2', 'inv-1013', 'INV-000113',
        { name: 'Pikachu', setName: 'Base Set', finish: 'normal', conditionLabel: 'NM', imageSmallUrl: 'https://images.pokemontcg.io/base1/58.png' },
        { kind: 'assigned', label: 'C01-F01-S03' }),
    ],
  };
  const shp7002: ShipPreparationOrderDTO = {
    destination: 'ship',
    shipmentId: 'shp-7002',
    kind: 'vault_withdrawal',
    orderId: null,
    orderNumber: null,
    requestedAt: '2026-08-13T09:30:00Z',
    customer: { userId: 'u-778', email: 'bruno@example.com', lastName: null, fullName: 'Misty' },
    shipTo: {
      recipientName: null, line1: 'Calle Falsa 123', line2: null, neighborhood: null,
      city: 'Guadalajara', state: 'JAL', postalCode: '44100', country: 'MX', phone: '3331234567',
    },
    preparation: { status: 'in_progress', refundPreviewCents: 0, total: 2, pending: 2, picked: 0, missing: 0, blocked: 0 },
    items: [
      shipItem('sit-9002-1', 'inv-1001', 'INV-000101',
        { name: 'Zapdos', setName: 'Base Set', finish: 'normal', conditionLabel: 'NM', imageSmallUrl: 'https://images.pokemontcg.io/base1/16.png' },
        { kind: 'assigned', label: 'C03-F02-S15' }),
      shipItem('sit-9002-2', 'inv-1008', 'INV-000108',
        { name: 'Machamp', setName: 'Base Set', finish: 'reverse_holo', conditionLabel: 'LP', imageSmallUrl: null },
        { kind: 'unassigned' }),
    ],
  };
  const shp7005: ShipPreparationOrderDTO = {
    destination: 'ship',
    shipmentId: 'shp-7005',
    kind: 'guest_direct_ship',
    orderId: 'ord-5002',
    orderNumber: 'TCG-000124',
    requestedAt: '2026-08-12T08:15:00Z',
    customer: { userId: null, email: 'invitado@example.com', lastName: null, fullName: null },
    shipTo: {
      recipientName: null, line1: 'Blvd. Adolfo López Mateos 500', line2: null, neighborhood: null,
      city: 'León', state: 'GTO', postalCode: '37000', country: 'MX', phone: '4779876543',
    },
    preparation: { status: 'in_progress', refundPreviewCents: 0, total: 1, pending: 1, picked: 0, missing: 0, blocked: 0 },
    items: [
      shipItem('sit-9005-1', 'inv-1014', 'INV-000114',
        { name: 'Blastoise', setName: 'Base Set', finish: 'holofoil', conditionLabel: 'NM', imageSmallUrl: 'https://images.pokemontcg.io/base1/2.png' },
        { kind: 'assigned', label: 'C02-F01-S08' }),
    ],
  };
  // Retiro de Gary YA PREPARADO con un caso «Por reponer» abierto (la guía espera, §M4-SHIP.15.6).
  const shp7006: ShipPreparationOrderDTO = {
    destination: 'ship',
    shipmentId: 'shp-7006',
    kind: 'vault_withdrawal',
    orderId: null,
    orderNumber: null,
    requestedAt: '2026-08-11T11:00:00Z',
    customer: { userId: 'u-781', email: 'gary@example.com', lastName: 'Oak', fullName: 'Gary Oak' },
    shipTo: {
      recipientName: 'Gary Oak', line1: 'Paseo de la Reforma 222', line2: null, neighborhood: 'Juárez',
      city: 'Ciudad de México', state: 'CDMX', postalCode: '06600', country: 'MX', phone: '5559998877',
    },
    preparation: {
      status: 'prepared', preparedAt: isoDaysAgo(2), preparedBy: MOCK_SHIP_OPERATOR, openReplacements: 1,
      total: 2, pending: 0, picked: 1, missing: 1, blocked: 0,
    },
    items: [
      shipItem('sit-9006-1', 'inv-1201', 'INV-000301',
        { name: 'Pidgeot', setName: 'Jungle', finish: 'holofoil', conditionLabel: 'NM', imageSmallUrl: null },
        { kind: 'assigned', label: 'C10-F02-S01' },
        { prepStatus: 'picked', prepMarkedBy: MOCK_SHIP_OPERATOR, refund: { kind: 'to_replacement' } }),
      shipItem('sit-9006-2', 'inv-1202', 'INV-000302',
        { name: 'Charmander', setName: 'Base Set', finish: 'normal', conditionLabel: 'NM', imageSmallUrl: 'https://images.pokemontcg.io/base1/46.png' },
        { kind: 'assigned', label: 'C10-F02-S01' },
        {
          prepStatus: 'missing', missingReason: 'not_found', prepMarkedBy: MOCK_SHIP_OPERATOR,
          refund: { kind: 'replacement', case: { id: 'rc-9001', status: 'open', missingReason: 'not_found', openedAt: isoDaysAgo(2), resolvedAt: null, replacement: null } },
        }),
    ],
  };
  return [
    { dto: shp7004, status: 'picking', shipmentTotalCents: 0, shipmentFeeCents: 0, shipmentIvaCents: 0, shipmentProcessingFeeCents: 0,
      meta: { 'sit-9004-1': { originOrderId: 'ord-5001', unitPriceCents: 50_000, refundId: null, caseId: null },
              'sit-9004-2': { originOrderId: 'ord-5001', unitPriceCents: 30_000, refundId: null, caseId: null } } },
    { dto: shp7002, status: 'picking', shipmentTotalCents: 20_300, shipmentFeeCents: 17_500, shipmentIvaCents: 2_414, shipmentProcessingFeeCents: 2_800,
      meta: { 'sit-9002-1': { originOrderId: 'ord-4101', unitPriceCents: 42_000, refundId: null, caseId: null },
              'sit-9002-2': { originOrderId: 'ord-4101', unitPriceCents: 28_000, refundId: null, caseId: null } } },
    { dto: shp7005, status: 'picking', shipmentTotalCents: 0, shipmentFeeCents: 0, shipmentIvaCents: 0, shipmentProcessingFeeCents: 0,
      meta: { 'sit-9005-1': { originOrderId: 'ord-5002', unitPriceCents: 65_000, refundId: null, caseId: null } } },
    { dto: shp7006, status: 'picking', shipmentTotalCents: 20_300, shipmentFeeCents: 17_500, shipmentIvaCents: 2_414, shipmentProcessingFeeCents: 2_800,
      meta: { 'sit-9006-1': { originOrderId: 'ord-4102', unitPriceCents: 55_000, refundId: null, caseId: null },
              'sit-9006-2': { originOrderId: 'ord-4102', unitPriceCents: 35_000, refundId: null, caseId: 'rc-9001' } } },
  ];
}
let ships: MockShipOrder[] = shipSeed();

/** Re-deriva `refund` de cada línea y `preparation` como lo hace el servidor (§M4-SHIP.3). */
function recomputeShip(s: MockShipOrder): void {
  const isWithdrawal = s.dto.kind === 'vault_withdrawal';
  let refundPreview = 0;
  const counts = { total: s.dto.items.length, pending: 0, picked: 0, missing: 0, blocked: 0 };
  let anyPicked = false;
  for (const it of s.dto.items) {
    const m = s.meta[it.shipmentItemId];
    const origin = m.originOrderId ? origins[m.originOrderId] : null;
    if (it.availability.kind === 'blocked') counts.blocked += 1;
    else if (it.prepStatus === 'pending') counts.pending += 1;
    else if (it.prepStatus === 'picked') {
      counts.picked += 1;
      anyPicked = true;
    } else counts.missing += 1;

    if (m.refundId) {
      const row = refunds.find((r) => r.id === m.refundId)!;
      it.refund = { kind: 'refunded', refund: toRefundDTO(row) };
    } else if (isWithdrawal) {
      if (m.caseId) {
        const c = cases.find((x) => x.id === m.caseId)!;
        it.refund = { kind: 'replacement', case: caseRef(c) };
      } else it.refund = { kind: 'to_replacement' };
    } else if (!origin) {
      it.refund = { kind: 'not_refundable', reason: 'no_origin_order' };
    } else if (origin.status !== 'settled') {
      it.refund = { kind: 'not_refundable', reason: 'order_not_settled' };
    } else if (origin.priceConvention !== 'IVA_INCLUSIVE') {
      it.refund = { kind: 'not_refundable', reason: 'legacy_convention' };
    } else {
      const cents = itemMissingCents(origin, m.unitPriceCents);
      it.refund = { kind: 'refundable', amountCents: cents };
      if (it.prepStatus === 'missing' && it.availability.kind === 'available') refundPreview += cents;
    }
  }
  const openCases = isWithdrawal
    ? s.dto.items.filter((i) => {
        const cid = s.meta[i.shipmentItemId].caseId;
        return cid && cases.find((c) => c.id === cid)?.status === 'open';
      }).length
    : 0;
  // Cierre (§M4-SHIP.5 paso 5, v1.80.6): nada `picked` tras el acto ⇒ `order_remaining` / `shipment_fee`.
  const wouldClose = !anyPicked && counts.pending === 0 && openCases === 0 && counts.total > 0;
  if (wouldClose) {
    if (isWithdrawal) refundPreview += s.shipmentTotalCents;
    else {
      const origin = origins[s.dto.orderId!];
      // Todas las líneas con fila no fallida o a punto de tenerla ⇒ el resto de la orden.
      const missingAll = s.dto.items.every((i) => i.prepStatus === 'missing' || s.meta[i.shipmentItemId].refundId || i.availability.kind === 'blocked');
      if (origin && missingAll) refundPreview = origin.totalCents - refundedOnOrder(origin.id);
    }
  }
  const prev = s.dto.preparation;
  s.dto.preparation =
    prev.status === 'prepared'
      ? { status: 'prepared', preparedAt: prev.preparedAt, preparedBy: prev.preparedBy, openReplacements: openCases, ...counts }
      : { status: 'in_progress', refundPreviewCents: refundPreview, ...counts };
}

// ────────────────────────────────────────────────────────────────────────────────────────────
// El apartado «Por reponer» (`ReplacementCase`) — estado vivo
// ────────────────────────────────────────────────────────────────────────────────────────────

interface MockCase extends ReplacementCaseDTO {
  originItemInventoryId: string;
  unitPriceCents: number;
  marketCents: number | null;
  marketCapturedDate: string | null;
  customerHasClabe: boolean;
  candidates: ReplacementCandidateDTO[];
  /** shipmentItemId de la línea del retiro (source=withdrawal). */
  shipmentItemId: string | null;
}

const drawerAna = { id: 'loc-3', label: 'C10-F01-S01', zone: 'customer_custody' as const, customerPieceCount: 4 };

function seedCases(): MockCase[] {
  const base = {
    resolvedAt: null, resolvedBy: null, replacement: null, refund: null, voidNote: null,
    refundContext: null, refundCapture: null, manualRefunds: null,
  };
  return [
    {
      ...base,
      id: 'rc-9001', source: 'withdrawal', status: 'open', missingReason: 'not_found',
      customer: { userId: 'u-781', fullName: 'Gary Oak', email: 'gary@example.com' },
      original: {
        inventoryItemId: 'inv-1202', folio: 'INV-000302',
        card: { name: 'Charmander', setName: 'Base Set', finish: 'normal', conditionLabel: 'NM', imageSmallUrl: 'https://images.pokemontcg.io/base1/46.png' },
        identity: { cardId: 'c-charmander', productType: 'raw', finish: 'normal', cardProductId: 461, rawCondition: 'NM', gradingCompany: null, gradeValue: null, sealedProductId: null, sealedCondition: null },
        pieceStatus: 'lost', currentLocation: { kind: 'assigned', label: 'C10-F02-S01' },
      },
      origin: { orderId: 'ord-4102', orderNumber: 'TCG-000102', orderStatus: 'settled' },
      shipment: { id: 'shp-7006', status: 'picking', preparedAt: isoDaysAgo(2) },
      placement: null,
      destination: 'package',
      customerDrawers: [],
      candidateCount: 2,
      openedAt: isoDaysAgo(2), openedBy: MOCK_SHIP_OPERATOR,
      dueAt: '', overdue: false,
      originItemInventoryId: 'inv-1202', unitPriceCents: 35_000, marketCents: 42_000, marketCapturedDate: '2026-09-28', customerHasClabe: true,
      shipmentItemId: 'sit-9006-2',
      candidates: [
        { inventoryItemId: 'inv-1250', folio: 'INV-000350', status: 'listed', currentLocation: { kind: 'assigned', label: 'C01-F03-S07' }, listPriceCents: 39_900 },
        { inventoryItemId: 'inv-1251', folio: 'INV-000351', status: 'in_stock', currentLocation: { kind: 'assigned', label: 'C01-F03-S08' }, listPriceCents: null },
      ],
    },
    {
      ...base,
      id: 'rc-9002', source: 'vault_purchase', status: 'open', missingReason: 'damaged',
      customer: { userId: 'u-777', fullName: 'Ana López', email: 'ana@example.com' },
      original: {
        inventoryItemId: 'inv-1310', folio: 'INV-000310',
        card: { name: 'Pidgeotto', setName: 'Base Set', finish: 'holofoil', conditionLabel: 'NM', imageSmallUrl: null },
        identity: { cardId: 'c-pidgeotto', productType: 'raw', finish: 'holofoil', cardProductId: 470, rawCondition: 'NM', gradingCompany: null, gradeValue: null, sealedProductId: null, sealedCondition: null },
        pieceStatus: 'damaged', currentLocation: { kind: 'assigned', label: 'C03-F02-S16' },
      },
      origin: { orderId: 'ord-4103', orderNumber: 'TCG-000103', orderStatus: 'settled' },
      shipment: null,
      placement: { id: 'vp-7010', orderNumber: 'TCG-000103' },
      destination: 'drawer',
      customerDrawers: [drawerAna],
      candidateCount: 0,
      openedAt: isoDaysAgo(9), openedBy: MOCK_SHIP_OPERATOR,
      dueAt: '', overdue: false,
      // Sin referencia de mercado (`status ≠ priced`) ⇒ R = Q.
      originItemInventoryId: 'inv-1310', unitPriceCents: 60_000, marketCents: null, marketCapturedDate: null, customerHasClabe: false,
      shipmentItemId: null,
      candidates: [],
    },
    {
      ...base,
      id: 'rc-9003', source: 'vault_purchase', status: 'refunded', missingReason: 'not_found',
      customer: { userId: 'u-777', fullName: 'Ana López', email: 'ana@example.com' },
      original: {
        inventoryItemId: 'inv-1311', folio: 'INV-000311',
        card: { name: 'Growlithe', setName: 'Base Set', finish: 'normal', conditionLabel: 'NM', imageSmallUrl: null },
        identity: { cardId: 'c-growlithe', productType: 'raw', finish: 'normal', cardProductId: 471, rawCondition: 'NM', gradingCompany: null, gradeValue: null, sealedProductId: null, sealedCondition: null },
        pieceStatus: 'lost', currentLocation: { kind: 'assigned', label: 'C03-F02-S17' },
      },
      origin: { orderId: 'ord-4103', orderNumber: 'TCG-000103', orderStatus: 'settled' },
      shipment: null,
      placement: { id: 'vp-7010', orderNumber: 'TCG-000103' },
      destination: 'drawer',
      customerDrawers: [drawerAna],
      candidateCount: 0,
      openedAt: isoDaysAgo(12), openedBy: MOCK_SHIP_OPERATOR,
      resolvedAt: isoDaysAgo(2), resolvedBy: MOCK_SUPER,
      refund: null,
      refundCapture: { amountCents: 50_000, reason: 'TCGplayer NM 2026-09-27', paidReferenceCents: 32_874, market: { cents: 48_000, capturedDate: '2026-09-27' }, aboveReferenceConfirmed: false },
      dueAt: '', overdue: false,
      originItemInventoryId: 'inv-1311', unitPriceCents: 32_000, marketCents: 48_000, marketCapturedDate: '2026-09-27', customerHasClabe: true,
      shipmentItemId: null,
      candidates: [],
    },
  ];
}
let cases: MockCase[] = seedCases();

function caseRef(c: MockCase): ReplacementCaseRefDTO {
  return { id: c.id, status: c.status, missingReason: c.missingReason, openedAt: c.openedAt, resolvedAt: c.resolvedAt, replacement: c.replacement };
}

/** Referencias Q, M, R del caso (§M4-SHIP.15.5). */
function caseReferences(c: MockCase) {
  const origin = c.origin ? origins[c.origin.orderId] : null;
  const Q = origin ? itemMissingCents(origin, c.unitPriceCents) : c.unitPriceCents;
  const M = c.marketCents;
  const R = Math.max(Q, M ?? 0);
  return {
    Q, M, R,
    confirmAboveCents: CASE_REFUND_CONFIRM_MULTIPLIER * R,
    limitCents: CASE_REFUND_HARD_MULTIPLIER * R,
    stripeAvailableCents: origin ? Math.max(0, origin.totalCents - refundedOnOrder(origin.id)) : 0,
    origin,
  };
}

function shipOfCase(c: MockCase): MockShipOrder | null {
  return c.shipment ? ships.find((s) => s.dto.shipmentId === c.shipment!.id) ?? null : null;
}

/** ¿Cerraría el retiro si este caso se resuelve sin reposición? (§M4-SHIP.15.6) */
function caseClosesShipment(c: MockCase): boolean {
  const s = shipOfCase(c);
  if (!s || s.status !== 'picking') return false;
  const otherOpen = cases.some((x) => x.id !== c.id && x.status === 'open' && x.shipment?.id === s.dto.shipmentId);
  const anyPicked = s.dto.items.some((i) => i.prepStatus === 'picked' && i.availability.kind === 'available');
  return !otherOpen && !anyPicked;
}

/** Proyección con lo derivado por el servidor (plazo, `refundContext` por rol, PII por rol). */
function projectCase(c: MockCase): ReplacementCaseDTO {
  const isSuper = mockCallerRole() === 'super_admin';
  const dueAt = new Date(new Date(c.openedAt).getTime() + REPLACEMENT_CASE_DUE_MS).toISOString();
  const overdue = c.status === 'open' && Date.now() >= new Date(dueAt).getTime();
  const origin = c.origin ? origins[c.origin.orderId] : null;
  let refundContext: ReplacementCaseDTO['refundContext'] = null;
  if (isSuper && c.status === 'open') {
    if (!origin) refundContext = { available: false, reason: 'no_origin_order' };
    else if (origin.priceConvention !== 'IVA_INCLUSIVE') refundContext = { available: false, reason: 'legacy_convention' };
    else if (origin.status !== 'settled') refundContext = { available: false, reason: 'origin_not_settled' };
    else {
      const r = caseReferences(c);
      refundContext = {
        available: true, paidReferenceCents: r.Q,
        market: r.M !== null ? { cents: r.M, capturedDate: c.marketCapturedDate! } : null,
        referenceCents: r.R, confirmAboveCents: r.confirmAboveCents, limitCents: r.limitCents,
        stripeAvailableCents: r.stripeAvailableCents, closesShipment: caseClosesShipment(c), customerHasClabe: c.customerHasClabe,
      };
    }
  }
  const { originItemInventoryId, unitPriceCents, marketCents, marketCapturedDate, customerHasClabe, candidates, shipmentItemId, ...dto } = c;
  void originItemInventoryId; void unitPriceCents; void marketCents; void marketCapturedDate; void customerHasClabe; void candidates; void shipmentItemId;
  return clone({
    ...dto,
    origin: c.origin ? { ...c.origin, orderStatus: origin?.status ?? c.origin.orderStatus } : null,
    shipment: c.shipment ? { ...c.shipment, status: shipOfCase(c)?.status ?? c.shipment.status } : null,
    candidateCount: c.status === 'open' ? c.candidates.length : 0,
    dueAt, overdue, refundContext,
    refundCapture: isSuper ? c.refundCapture : null,
    manualRefunds: isSuper ? manualRefunds.filter((m) => m.replacementCaseId === c.id).map(projectManualRefund) : null,
    refund: c.refund,
  });
}

// ────────────────────────────────────────────────────────────────────────────────────────────
// La cubeta SPEI (`ManualRefund`) — estado vivo
// ────────────────────────────────────────────────────────────────────────────────────────────

interface MockManualRefund extends Omit<ManualRefundDTO, 'clabeOnFile' | 'clabeMasked' | 'beneficiaryName' | 'clabeUpdatedAt' | 'clabeChangedRecently' | 'paidToCurrentClabe' | 'origin'> {
  replacementCaseId: string;
  originOrderId: string | null;
  paidClabeHmac: string | null;
}
interface MockKyc {
  clabe: string | null;
  clabeHmac: string | null;
  legalName: string | null;
  clabeUpdatedAt: string | null;
}
function seedKyc(): Record<string, MockKyc> {
  return {
    'u-777': { clabe: '012345678901231234', clabeHmac: 'h-ana-1', legalName: 'Ana López Pérez', clabeUpdatedAt: null },
    // Bruno registró su CLABE AYER (⇒ confirmación reforzada `recent_clabe_change`).
    'u-778': { clabe: '032180000118359719', clabeHmac: 'h-bruno-2', legalName: null, clabeUpdatedAt: isoDaysAgo(1) },
    'u-781': { clabe: null, clabeHmac: null, legalName: null, clabeUpdatedAt: null },
  };
}
let kyc: Record<string, MockKyc> = seedKyc();

function seedManualRefunds(): MockManualRefund[] {
  const anaCase = { id: 'rc-9003', source: 'vault_purchase' as const, card: { name: 'Growlithe', setName: 'Base Set', finish: 'normal' as const, conditionLabel: 'NM', imageSmallUrl: null }, folio: 'INV-000311', reason: 'TCGplayer NM 2026-09-27' };
  return [
    // El excedente del caso de Ana (MX$500 capturados; MX$400 cabían en la tarjeta; Stripe rechazó esos MX$400).
    {
      id: 'mr-1001', source: 'case_excess', status: 'pending', amountCents: 10_000,
      components: { merchandiseCents: 0, merchandiseIvaCents: 0, processingFeeCents: 0, compensationCents: 10_000 },
      customer: { userId: 'u-777', fullName: 'Ana López', email: 'ana@example.com' },
      case: anaCase, paymentRefundId: null,
      createdAt: isoDaysAgo(2), createdBy: MOCK_SUPER,
      paidAt: null, paidBy: null, speiReference: null, paidNote: null,
      cancelledAt: null, cancelledBy: null, cancelNote: null, reissuedFromId: null, reissuedAsId: null,
      replacementCaseId: 'rc-9003', originOrderId: 'ord-4103', paidClabeHmac: null,
    },
    // Una cancelada (re-emitible), de Bruno, de un caso anterior ya cerrado.
    {
      id: 'mr-1002', source: 'case_excess', status: 'cancelled', amountCents: 5_000,
      components: { merchandiseCents: 0, merchandiseIvaCents: 0, processingFeeCents: 0, compensationCents: 5_000 },
      customer: { userId: 'u-778', fullName: 'Bruno Díaz', email: 'bruno@example.com' },
      case: { id: 'rc-8990', source: 'withdrawal', card: { name: 'Onix', setName: 'Base Set', finish: 'normal', conditionLabel: 'NM', imageSmallUrl: null }, folio: 'INV-000299', reason: 'Cardmarket 2026-09-20' },
      paymentRefundId: null,
      createdAt: isoDaysAgo(8), createdBy: MOCK_SUPER,
      paidAt: null, paidBy: null, speiReference: null, paidNote: null,
      cancelledAt: isoDaysAgo(6), cancelledBy: MOCK_SUPER, cancelNote: 'Capturado por error: el cliente aceptó crédito en tienda.',
      reissuedFromId: null, reissuedAsId: null,
      replacementCaseId: 'rc-8990', originOrderId: 'ord-4104', paidClabeHmac: null,
    },
  ];
}
let manualRefunds: MockManualRefund[] = seedManualRefunds();

function projectManualRefund(m: MockManualRefund): ManualRefundDTO {
  const k = kyc[m.customer.userId] ?? { clabe: null, clabeHmac: null, legalName: null, clabeUpdatedAt: null };
  const origin = m.originOrderId ? origins[m.originOrderId] : null;
  const changedRecently =
    k.clabeUpdatedAt !== null &&
    (new Date(k.clabeUpdatedAt).getTime() > new Date(m.createdAt).getTime() || Date.now() - new Date(k.clabeUpdatedAt).getTime() < CLABE_RECENT_CHANGE_MS);
  const { replacementCaseId, originOrderId, paidClabeHmac, ...rest } = m;
  void replacementCaseId; void originOrderId;
  return clone({
    ...rest,
    beneficiaryName: k.legalName ?? m.customer.fullName,
    clabeOnFile: k.clabe !== null,
    clabeMasked: k.clabe ? `****${k.clabe.slice(-4)}` : null,
    origin: origin ? { orderId: origin.id, orderNumber: origin.orderNumber, orderStatus: origin.status } : m.originOrderId ? { orderId: m.originOrderId, orderNumber: null, orderStatus: 'settled' } : null,
    paidToCurrentClabe: m.status === 'paid' ? paidClabeHmac === k.clabeHmac : null,
    clabeUpdatedAt: k.clabeUpdatedAt,
    clabeChangedRecently: changedRecently,
  });
}

function revealTokenFor(manualRefundId: string, clabeHmac: string): string {
  return `tok:${manualRefundId}:${clabeHmac}`;
}

// ────────────────────────────────────────────────────────────────────────────────────────────
// Reinicio (pruebas)
// ────────────────────────────────────────────────────────────────────────────────────────────

export function resetMockM4Ship(): void {
  origins = clone(ORIGIN_ORDERS);
  refunds = seedRefunds();
  vaultPieces = seedVaultPieces();
  ships = shipSeed();
  cases = seedCases();
  manualRefunds = seedManualRefunds();
  kyc = seedKyc();
  ships.forEach(recomputeShip);
}
ships.forEach(recomputeShip);

// ────────────────────────────────────────────────────────────────────────────────────────────
// Cola ENVÍO y sus verbos (§M4-SHIP.3 / .5)
// ────────────────────────────────────────────────────────────────────────────────────────────

export function mockShipPreparationQueue(): ShipPreparationOrderDTO[] {
  return clone(ships.filter((s) => s.status === 'picking').map((s) => s.dto));
}

/** Estado vivo del envío para la cola ADMIN (`GET /admin/shipments`): el resto sale de `fixtures`. */
export function mockShipStatusOf(shipmentId: string): MockShipOrder['status'] | null {
  return ships.find((s) => s.dto.shipmentId === shipmentId)?.status ?? null;
}
export function mockShipAdminAdditions(shipmentId: string): Partial<AdminShipmentDTO> | null {
  const s = ships.find((x) => x.dto.shipmentId === shipmentId);
  if (!s) return null;
  const prep = s.dto.preparation;
  return {
    kind: s.dto.kind,
    orderId: s.dto.orderId,
    orderNumber: s.dto.orderNumber ?? undefined,
    customer: s.dto.customer.userId ? { userId: s.dto.customer.userId, fullName: s.dto.customer.fullName, email: s.dto.customer.email ?? '' } : null,
    guestEmail: s.dto.customer.userId ? undefined : s.dto.customer.email ?? undefined,
    preparedAt: prep.status === 'prepared' ? prep.preparedAt : null,
    preparedBy: prep.status === 'prepared' ? prep.preparedBy : null,
    missingCount: s.dto.items.filter((i) => i.prepStatus === 'missing').length,
    addressSnapshot: { ...s.dto.shipTo },
  };
}
export function mockSetShipStatus(shipmentId: string, status: ShipmentStatus): void {
  const s = ships.find((x) => x.dto.shipmentId === shipmentId);
  if (s) s.status = status;
}

function findShip(shipmentId: string): MockShipOrder {
  const s = ships.find((x) => x.dto.shipmentId === shipmentId);
  if (!s) throw new ApiFixtureNotFound(`Shipment ${shipmentId} not found`);
  return s;
}
function shipDTO(s: MockShipOrder): AdminShipmentDTO {
  return {
    id: s.dto.shipmentId,
    status: s.status,
    userId: s.dto.customer.userId,
    requestedAt: s.dto.requestedAt,
    carrier: null,
    trackingNumber: null,
    ...mockShipAdminAdditions(s.dto.shipmentId),
  };
}

/** MOCK de `PATCH /admin/shipments/:id/prep-items/:shipmentItemId` (§M4-SHIP.5). */
export function mockSetShipPrepItem(
  shipmentId: string,
  shipmentItemId: string,
  status: PreparationItemStatus,
  missingReason?: MissingReason,
): SetShipPrepItemResponse {
  if (status === 'missing' && !missingReason) {
    throw new ApiFixtureError(400, 'VALIDATION_ERROR', 'missingReason is required with status=missing', { field: 'missingReason' });
  }
  if (status !== 'missing' && missingReason) {
    throw new ApiFixtureError(400, 'VALIDATION_ERROR', 'missingReason only with status=missing', { field: 'missingReason' });
  }
  const s = findShip(shipmentId);
  const item = s.dto.items.find((i) => i.shipmentItemId === shipmentItemId);
  if (!item) throw new ApiFixtureNotFound(`ShipmentItem ${shipmentItemId} not found`);
  if (s.status !== 'picking') throw new ApiFixtureError(409, 'SHIPMENT_NOT_IN_PREPARATION', 'Shipment is not in preparation', { status: s.status });
  if (s.dto.preparation.status === 'prepared') {
    throw new ApiFixtureError(409, 'PREPARATION_CLOSED', 'Preparation is closed', { preparedAt: s.dto.preparation.preparedAt });
  }
  const meta = s.meta[shipmentItemId];
  if (meta.refundId) throw new ApiFixtureError(409, 'PREP_ITEM_REFUNDED', 'Line already refunded', { refundId: meta.refundId });
  if (meta.caseId) {
    const c = cases.find((x) => x.id === meta.caseId)!;
    throw new ApiFixtureError(409, 'PREP_ITEM_IN_REPLACEMENT', 'Line opened a replacement case', { caseId: c.id, status: c.status });
  }
  if (status !== 'pending' && item.availability.kind === 'blocked') {
    throw new ApiFixtureError(409, 'PREP_ITEM_BLOCKED', 'Item is blocked', { reason: 'piece_not_available', pieceStatus: item.availability.pieceStatus });
  }
  const changed = item.prepStatus !== status || item.missingReason !== (missingReason ?? null);
  if (changed) {
    item.prepStatus = status;
    item.missingReason = status === 'missing' ? missingReason! : null;
    item.prepMarkedBy = status === 'pending' ? null : callerActor();
  }
  recomputeShip(s);
  return clone({ changed, item, preparation: s.dto.preparation });
}

/** MOCK de `POST /admin/shipments/:id/prepared` (§M4-SHIP.5, algoritmo normativo). */
export function mockPrepareShipment(shipmentId: string, expectedRefundCents: number): PrepareShipmentResponse {
  if (!Number.isInteger(expectedRefundCents) || expectedRefundCents < 0) {
    throw new ApiFixtureError(400, 'VALIDATION_ERROR', 'expectedRefundCents must be an integer >= 0', { field: 'expectedRefundCents' });
  }
  const s = findShip(shipmentId);
  if (s.status !== 'picking') throw new ApiFixtureError(409, 'SHIPMENT_NOT_IN_PREPARATION', 'Shipment is not in preparation', { status: s.status });
  if (s.dto.preparation.status === 'prepared') {
    return clone({ outcome: 'already_prepared', shipment: shipDTO(s), preparation: s.dto.preparation, refunds: [], cases: [] });
  }
  recomputeShip(s);
  const prep = s.dto.preparation as Extract<ShipPreparationStateDTO, { status: 'in_progress' }>;
  if (prep.pending > 0) throw new ApiFixtureError(409, 'PREPARATION_INCOMPLETE', 'Preparation incomplete', { pendingCount: prep.pending });
  const isWithdrawal = s.dto.kind === 'vault_withdrawal';

  // Paso 5: no reembolsables (directo) y bloqueadas con origen `settled`.
  const blockedSettled = s.dto.items.filter((i) => {
    if (i.availability.kind !== 'blocked') return false;
    const o = s.meta[i.shipmentItemId].originOrderId;
    return o ? origins[o]?.status === 'settled' : false;
  });
  if (blockedSettled.length > 0) {
    throw new ApiFixtureError(409, 'PREPARATION_HAS_BLOCKED_LINES', 'Blocked lines with settled origin', {
      lines: blockedSettled.map((i) => ({ shipmentItemId: i.shipmentItemId, folio: i.folio })),
    });
  }
  const missingNew = s.dto.items.filter((i) => i.prepStatus === 'missing' && i.availability.kind === 'available' && !s.meta[i.shipmentItemId].refundId && !s.meta[i.shipmentItemId].caseId);
  if (!isWithdrawal) {
    const notRefundable = missingNew.filter((i) => i.refund.kind === 'not_refundable');
    if (notRefundable.length > 0) {
      throw new ApiFixtureError(409, 'REFUND_NOT_AVAILABLE', 'Some lines are not refundable', {
        lines: notRefundable.map((i) => ({ shipmentItemId: i.shipmentItemId, reason: (i.refund as { reason: string }).reason })),
      });
    }
    // Paso 9 (SEC-SHIP-A2): la orden del directo se toma SIEMPRE.
    const origin = origins[s.dto.orderId!];
    if (origin && origin.status !== 'settled') {
      throw new ApiFixtureError(409, 'ORDER_NOT_SETTLED', 'Order is not settled', { orderStatus: origin.status });
    }
  } else {
    // Paso 9 (SEC-SHIP-A5 (b)): las órdenes de origen de las líneas `picked` disponibles.
    const affected = s.dto.items
      .filter((i) => i.prepStatus === 'picked' && i.availability.kind === 'available')
      .map((i) => ({ item: i, origin: s.meta[i.shipmentItemId].originOrderId ? origins[s.meta[i.shipmentItemId].originOrderId!] : null }))
      .filter((x) => x.origin && (x.origin.status !== 'settled' || x.origin.pendingFullRefund));
    if (affected.length > 0) {
      throw new ApiFixtureError(409, 'WITHDRAWAL_LINE_ORIGIN_REFUNDED', 'A picked line belongs to a purchase being refunded', {
        items: affected.map(({ item, origin }) => ({
          inventoryItemId: item.inventoryItemId, folio: item.folio, shipmentItemId: item.shipmentItemId,
          orderId: origin!.id, orderNumber: origin!.orderNumber, orderStatus: origin!.status, pendingFullRefund: origin!.pendingFullRefund,
        })),
      });
    }
  }
  // Paso 6: tope del operador.
  const actor = callerActor();
  const planCents = prep.refundPreviewCents;
  if (mockCallerRole() === 'vault_operator') {
    const used = operatorUsedCents(actor.userId);
    if (used + planCents > MOCK_OPERATOR_REFUND_CAP_CENTS) {
      throw new ApiFixtureError(403, 'MONEY_OUT_LIMIT_EXCEEDED', 'Operator 24h refund cap exceeded', {
        capCents: MOCK_OPERATOR_REFUND_CAP_CENTS, usedCents: used, requestedCents: planCents,
      });
    }
  }
  // Paso 7: la cifra confirmada.
  if (expectedRefundCents !== planCents) {
    throw new ApiFixtureError(409, 'REFUND_PREVIEW_STALE', 'Refund preview is stale', { refundCents: planCents });
  }
  // Pasos 8–13.
  const now = nowIso();
  const created: MockRefundRow[] = [];
  const newCases: ReplacementCaseRefDTO[] = [];
  for (const item of missingNew) {
    const m = s.meta[item.shipmentItemId];
    if (isWithdrawal) {
      const origin = m.originOrderId ? origins[m.originOrderId] : null;
      const c: MockCase = {
        id: nextId('rc'), source: 'withdrawal', status: 'open', missingReason: item.missingReason!,
        customer: { userId: s.dto.customer.userId!, fullName: s.dto.customer.fullName, email: s.dto.customer.email ?? '' },
        original: {
          inventoryItemId: item.inventoryItemId, folio: item.folio, card: item.card,
          identity: { cardId: `c-${item.card.name.toLowerCase()}`, productType: 'raw', finish: item.card.finish, cardProductId: null, rawCondition: 'NM', gradingCompany: null, gradeValue: null, sealedProductId: null, sealedCondition: null },
          pieceStatus: item.missingReason === 'damaged' ? 'damaged' : 'lost', currentLocation: item.currentLocation,
        },
        origin: origin ? { orderId: origin.id, orderNumber: origin.orderNumber, orderStatus: origin.status } : null,
        shipment: { id: s.dto.shipmentId, status: 'picking', preparedAt: now },
        placement: null, destination: 'package', customerDrawers: [], candidateCount: 0,
        openedAt: now, openedBy: actor, resolvedAt: null, resolvedBy: null, replacement: null, refund: null, voidNote: null,
        dueAt: '', overdue: false, refundContext: null, refundCapture: null, manualRefunds: null,
        originItemInventoryId: item.inventoryItemId, unitPriceCents: m.unitPriceCents, marketCents: null, marketCapturedDate: null,
        customerHasClabe: kyc[s.dto.customer.userId!]?.clabe !== null && kyc[s.dto.customer.userId!] !== undefined,
        shipmentItemId: item.shipmentItemId, candidates: [],
      };
      cases.push(c);
      m.caseId = c.id;
      newCases.push(caseRef(c));
    } else {
      const origin = origins[m.originOrderId!];
      const row: MockRefundRow = {
        id: nextId('pr'), kind: 'item_missing', status: 'requested', amountCents: itemMissingCents(origin, m.unitPriceCents),
        components: itemMissingRefundComponents(origin, m.unitPriceCents),
        missingReason: item.missingReason, requestedAt: now, requestedBy: { ...actor, role: mockCallerRole() },
        submittedAt: null, succeededAt: null, failedAt: null, failureCode: null,
        orderId: origin.id, shipmentRequestId: s.dto.shipmentId, shipmentItemId: item.shipmentItemId, orderItemInventoryId: item.inventoryItemId,
        replacementCaseId: null, customerUserId: s.dto.customer.userId, orderNumber: origin.orderNumber, item: { folio: item.folio, cardName: item.card.name },
        // La segunda carta del ejemplo del dueño se queda `requested` la primera vez (Stripe transitorio) ⇒ «Reintentar».
        stripeTransientOnce: item.shipmentItemId === 'sit-9004-1',
      };
      refunds.push(row);
      created.push(row);
      m.refundId = row.id;
    }
  }
  // Cierre (paso 5 / v1.80.6): ninguna línea `picked` y ningún caso abierto.
  const anyPicked = s.dto.items.some((i) => i.prepStatus === 'picked' && i.availability.kind === 'available');
  const openCases = s.dto.items.some((i) => {
    const cid = s.meta[i.shipmentItemId].caseId;
    return cid && cases.find((c) => c.id === cid)?.status === 'open';
  });
  let closed = false;
  if (!anyPicked && !openCases) {
    closed = true;
    if (isWithdrawal) {
      const row: MockRefundRow = {
        id: nextId('pr'), kind: 'shipment_fee', status: 'requested', amountCents: s.shipmentTotalCents, missingReason: null,
        requestedAt: now, requestedBy: { ...actor, role: mockCallerRole() }, submittedAt: null, succeededAt: null, failedAt: null, failureCode: null,
        orderId: null, shipmentRequestId: s.dto.shipmentId, shipmentItemId: null, orderItemInventoryId: null, replacementCaseId: null,
        customerUserId: s.dto.customer.userId, orderNumber: null, item: null,
      };
      refunds.push(row);
      created.push(row);
    } else {
      const origin = origins[s.dto.orderId!];
      const rest = origin.totalCents - refundedOnOrder(origin.id);
      if (rest > 0) {
        const row: MockRefundRow = {
          id: nextId('pr'), kind: 'order_remaining', status: 'requested', amountCents: rest, missingReason: null,
          requestedAt: now, requestedBy: { ...actor, role: mockCallerRole() }, submittedAt: null, succeededAt: null, failedAt: null, failureCode: null,
          orderId: origin.id, shipmentRequestId: s.dto.shipmentId, shipmentItemId: null, orderItemInventoryId: null, replacementCaseId: null,
          customerUserId: s.dto.customer.userId, orderNumber: origin.orderNumber, item: null,
        };
        refunds.push(row);
        created.push(row);
      }
    }
  }
  s.dto.preparation = { status: 'prepared', preparedAt: now, preparedBy: actor, openReplacements: 0, total: prep.total, pending: 0, picked: prep.picked, missing: prep.missing, blocked: prep.blocked };
  if (closed) s.status = 'cancelado';
  // Paso 14: fuera de la tx, Stripe por fila.
  created.forEach(executeRefund);
  recomputeShip(s);
  return clone({
    outcome: closed ? 'closed_nothing_to_ship' : 'prepared',
    shipment: shipDTO(s),
    preparation: s.dto.preparation,
    refunds: created.map(toRefundDTO),
    cases: newCases,
  });
}

/** MOCK de `DELETE /admin/shipments/:id/prepared` (§M4-SHIP.5; v1.80.5: reclama en retiros). */
export function mockUnprepareShipment(shipmentId: string): UnprepareShipmentResponse {
  const s = findShip(shipmentId);
  if (s.status !== 'picking') throw new ApiFixtureError(409, 'SHIPMENT_NOT_IN_PREPARATION', 'Shipment is not in preparation', { status: s.status });
  if (s.dto.preparation.status !== 'prepared') {
    recomputeShip(s);
    return clone({ outcome: 'not_prepared', shipment: shipDTO(s), preparation: s.dto.preparation });
  }
  const counts = { total: s.dto.preparation.total, pending: s.dto.preparation.pending, picked: s.dto.preparation.picked, missing: s.dto.preparation.missing, blocked: s.dto.preparation.blocked };
  s.dto.preparation = { status: 'in_progress', refundPreviewCents: 0, ...counts };
  // SEC-SHIP-A5 (a): en un retiro, reclamar lo que un reembolso total ya cerró.
  const reclaimed: { orderId: string; inventoryItemIds: string[] }[] = [];
  if (s.dto.kind === 'vault_withdrawal') {
    for (const item of s.dto.items) {
      const m = s.meta[item.shipmentItemId];
      const origin = m.originOrderId ? origins[m.originOrderId] : null;
      if (item.prepStatus === 'picked' && item.availability.kind === 'available' && origin?.fullRefundClosedAt) {
        item.availability = { kind: 'blocked', reason: 'piece_not_available', pieceStatus: 'picking' };
        const piece = vaultPieces.find((p) => p.inventoryItemId === item.inventoryItemId);
        if (piece) { piece.state = 'returned'; piece.pendingConfirmation = true; piece.shipmentId = null; }
        origin.chargebackNeedsManual = true;
        let g = reclaimed.find((r) => r.orderId === origin.id);
        if (!g) { g = { orderId: origin.id, inventoryItemIds: [] }; reclaimed.push(g); }
        g.inventoryItemIds.push(item.inventoryItemId);
      }
    }
  }
  recomputeShip(s);
  return clone({ outcome: 'unprepared', shipment: shipDTO(s), preparation: s.dto.preparation, ...(reclaimed.length ? { reclaimed } : {}) });
}

/** Guardas de guía/estado del §M4-SHIP.6 y .9, para que `saveShipmentTracking` / `updateAdminShipmentStatus` las apliquen. */
export function mockAssertShipmentCanAdvance(shipmentId: string, to: 'guia' | 'enviado' | 'entregado' | 'cancelado'): void {
  const s = ships.find((x) => x.dto.shipmentId === shipmentId);
  if (!s) return;
  if (to === 'cancelado') {
    if (s.status === 'picking' || s.status === 'guia') {
      throw new ApiFixtureError(409, 'PAID_SHIPMENT_NOT_CANCELLABLE', 'Paid shipments cannot be cancelled by hand', { status: s.status });
    }
    return;
  }
  if (to === 'guia' && s.status === 'picking') {
    if (s.dto.preparation.status !== 'prepared') {
      throw new ApiFixtureError(409, 'SHIPMENT_NOT_PREPARED', 'Shipment is not prepared', { preparation: s.dto.preparation });
    }
    if (s.dto.preparation.openReplacements > 0) {
      const caseIds = s.dto.items.map((i) => s.meta[i.shipmentItemId].caseId).filter((c): c is string => !!c && cases.find((x) => x.id === c)?.status === 'open');
      throw new ApiFixtureError(409, 'SHIPMENT_HAS_OPEN_REPLACEMENTS', 'Withdrawal has open replacement cases', { caseIds });
    }
  }
  if (to === 'guia' || to === 'enviado') {
    if (s.dto.kind === 'guest_direct_ship') {
      const origin = origins[s.dto.orderId!];
      if (origin && origin.status !== 'settled') throw new ApiFixtureError(409, 'ORDER_NOT_SETTLED', 'Order is not settled', { orderStatus: origin.status });
    } else {
      const picked = s.dto.items.filter((i) => i.prepStatus === 'picked' && i.availability.kind === 'available');
      const affected = picked
        .map((i) => ({ item: i, origin: s.meta[i.shipmentItemId].originOrderId ? origins[s.meta[i.shipmentItemId].originOrderId!] : null }))
        .filter((x) => x.origin && (x.origin.status !== 'settled' || x.origin.pendingFullRefund));
      if (affected.length > 0) {
        throw new ApiFixtureError(409, 'WITHDRAWAL_LINE_ORIGIN_REFUNDED', 'A picked line belongs to a purchase being refunded', {
          items: affected.map(({ item, origin }) => ({ inventoryItemId: item.inventoryItemId, folio: item.folio, shipmentItemId: item.shipmentItemId, orderId: origin!.id, orderNumber: origin!.orderNumber, orderStatus: origin!.status, pendingFullRefund: origin!.pendingFullRefund })),
        });
      }
      // v1.80.6 (SEC-SHIP-M7 / B15): un retiro en `guia` sin nada `picked` disponible no se marca enviado.
      if (to === 'enviado' && picked.length === 0) {
        throw new ApiFixtureError(409, 'CONFLICT', 'Nothing to ship', { reason: 'nothing_to_ship' });
      }
    }
  }
}

/** MOCK de `POST /admin/refunds/:refundId/retry` (§M4-SHIP.5). */
export function mockRetryRefund(refundId: string): PaymentRefundDTO {
  const r = refunds.find((x) => x.id === refundId);
  if (!r) throw new ApiFixtureNotFound(`PaymentRefund ${refundId} not found`);
  if (r.status !== 'requested') throw new ApiFixtureError(409, 'REFUND_NOT_RETRYABLE', 'Refund is not retryable', { status: r.status });
  if (mockCallerRole() !== 'super_admin' && (r.kind === 'order_full' || r.kind === 'case_refund')) {
    throw new ApiFixtureError(403, 'MONEY_OUT_FORBIDDEN', 'Operators only retry shipment refunds');
  }
  executeRefund(r);
  ships.forEach(recomputeShip);
  return clone(toRefundDTO(r));
}

/** MOCK de `GET /admin/shipments/picking-list/summary` (§M4-SHIP.11). `vaultPending` lo aporta el llamador. */
export function mockPickingListSummary(vaultPending: number): PickingListSummaryDTO {
  const shipOpen = ships.filter((s) => s.status === 'picking' && s.dto.preparation.status !== 'prepared');
  const open = cases.filter((c) => c.status === 'open');
  const overdue = open.filter((c) => Date.now() - new Date(c.openedAt).getTime() >= REPLACEMENT_CASE_DUE_MS);
  const stuck = refunds.filter((r) => r.status === 'failed' || (r.status === 'requested' && Date.now() - new Date(r.requestedAt).getTime() > 10 * 60 * 1000)).length;
  const oldestShip = shipOpen.map((s) => s.dto.requestedAt).sort()[0] ?? null;
  return clone({
    ship: shipOpen.length,
    vault: vaultPending,
    oldestRequestedAt: oldestShip,
    stuckRefunds: stuck,
    toReplace: open.length,
    oldestOpenCaseAt: open.map((c) => c.openedAt).sort()[0] ?? null,
    toReplaceOverdue: overdue.length,
    manualRefundsPending: mockCallerRole() === 'super_admin' ? manualRefunds.filter((m) => m.status === 'pending').length : null,
  });
}

// ────────────────────────────────────────────────────────────────────────────────────────────
// «Por reponer» (§M4-SHIP.15)
// ────────────────────────────────────────────────────────────────────────────────────────────

export function mockReplacementCases(filters: ReplacementCasesFilters): { data: ReplacementCaseDTO[]; page: number; pageSize: number; total: number } {
  const state = filters.state ?? 'open';
  let rows = cases.filter((c) => (state === 'open' ? c.status === 'open' : c.status !== 'open'));
  if (filters.source) rows = rows.filter((c) => c.source === filters.source);
  const q = filters.q?.trim().toLowerCase();
  if (q) rows = rows.filter((c) => [c.customer.fullName, c.customer.email, c.original.folio, c.origin?.orderNumber].some((v) => v?.toLowerCase().includes(q)));
  let data = rows.map(projectCase);
  if (filters.overdue) data = data.filter((c) => c.overdue);
  data.sort((a, b) => (state === 'open' ? a.openedAt.localeCompare(b.openedAt) : (b.resolvedAt ?? '').localeCompare(a.resolvedAt ?? '')));
  return { data, page: filters.page ?? 1, pageSize: 25, total: data.length };
}

function findCase(caseId: string): MockCase {
  const c = cases.find((x) => x.id === caseId);
  if (!c) throw new ApiFixtureNotFound(`ReplacementCase ${caseId} not found`);
  return c;
}

export function mockReplacementCase(caseId: string): ReplacementCaseDetailDTO {
  const c = findCase(caseId);
  return { ...projectCase(c), candidates: c.status === 'open' ? clone(c.candidates) : [] };
}

/** Saca la pieza original de la custodia del cliente (a plataforma). */
function originalToPlatform(c: MockCase): void {
  const piece = vaultPieces.find((p) => p.inventoryItemId === c.original.inventoryItemId);
  if (piece) piece.state = 'not_customer';
}

/** MOCK de `POST /admin/replacement-cases/:id/replace` (§M4-SHIP.15.4). */
export function mockReplaceCase(caseId: string, body: ReplaceCaseRequest): ReplaceCaseResponse {
  if (!body.inventoryItemId?.trim()) throw new ApiFixtureError(400, 'VALIDATION_ERROR', 'inventoryItemId required', { field: 'inventoryItemId' });
  const c = findCase(caseId);
  if (c.status !== 'open') {
    if ((c.status === 'replaced' || c.status === 'found') && c.replacement?.inventoryItemId === body.inventoryItemId) {
      return clone({ outcome: 'already_resolved', case: projectCase(c) });
    }
    throw new ApiFixtureError(409, 'CASE_NOT_OPEN', 'Case is not open', { status: c.status, resolvedAt: c.resolvedAt });
  }
  const s = shipOfCase(c);
  const destination: 'package' | 'drawer' = c.source === 'withdrawal' && s?.status === 'picking' ? 'package' : 'drawer';
  if (destination === 'drawer' && !body.locationId) {
    throw new ApiFixtureError(422, 'LOCATION_NOT_AVAILABLE', 'locationId required', { reason: 'location_required', pickedCount: 1 });
  }
  const origin = c.origin ? origins[c.origin.orderId] : null;
  if (origin && origin.status !== 'settled') {
    throw new ApiFixtureError(409, 'CASE_ORIGIN_NOT_SETTLED', 'Origin order is not settled', { originStatus: origin.status });
  }
  const now = nowIso();
  const actor = callerActor();
  if (body.inventoryItemId === c.original.inventoryItemId) {
    // «Apareció»: solo `not_found`.
    if (c.missingReason !== 'not_found') {
      throw new ApiFixtureError(422, 'REPLACEMENT_NOT_ELIGIBLE', 'A damaged piece cannot reappear', { reason: 'same_piece_damaged' });
    }
    c.status = 'found';
    c.resolvedAt = now;
    c.resolvedBy = actor;
    c.replacement = { inventoryItemId: c.original.inventoryItemId, folio: c.original.folio };
    if (s && destination === 'package') {
      const line = s.dto.items.find((i) => i.shipmentItemId === c.shipmentItemId);
      if (line) { line.prepStatus = 'picked'; line.missingReason = null; line.prepMarkedBy = actor; }
    }
  } else {
    const cand = c.candidates.find((x) => x.inventoryItemId === body.inventoryItemId);
    if (!cand) throw new ApiFixtureError(422, 'REPLACEMENT_NOT_ELIGIBLE', 'Candidate not found', { reason: 'not_found' });
    c.status = 'replaced';
    c.resolvedAt = now;
    c.resolvedBy = actor;
    c.replacement = { inventoryItemId: cand.inventoryItemId, folio: cand.folio };
    originalToPlatform(c);
    if (s && destination === 'package') {
      const newItem = shipItem(nextId('sit'), cand.inventoryItemId, cand.folio, c.original.card, cand.currentLocation, {
        prepStatus: 'picked', prepMarkedBy: actor, refund: { kind: 'to_replacement' },
      });
      s.dto.items.push(newItem);
      s.meta[newItem.shipmentItemId] = { originOrderId: c.origin?.orderId ?? null, unitPriceCents: c.unitPriceCents, refundId: null, caseId: null };
    }
  }
  if (s) recomputeShip(s);
  return clone({ outcome: c.status === 'found' ? 'found' : 'replaced', case: projectCase(c), ...(s ? { preparation: s.dto.preparation } : {}) });
}

/** El reparto y los topes de un monto (§M4-SHIP.15.5): un cuerpo para `refund-preview` y `refund`. */
function caseRefundPlan(c: MockCase, amountCents: number | null): CaseRefundPreviewDTO {
  const r = caseReferences(c);
  const closes = caseClosesShipment(c);
  const shipmentFee = closes ? shipOfCase(c)!.shipmentTotalCents : 0;
  if (amountCents === null) {
    return {
      amountCents: null, paidReferenceCents: r.Q, market: r.M !== null ? { cents: r.M, capturedDate: c.marketCapturedDate! } : null,
      referenceCents: r.R, confirmAboveCents: r.confirmAboveCents, limitCents: r.limitCents, confirmation: null,
      stripeAvailableCents: r.stripeAvailableCents, caseStripeCents: null, shipmentFeeCents: shipmentFee, stripeCents: null, manualCents: null,
      closesShipment: closes, customerHasClabe: c.customerHasClabe,
    };
  }
  const stripe = Math.min(amountCents, r.stripeAvailableCents);
  const manual = amountCents - stripe;
  const confirmation = amountCents > r.limitCents ? 'blocked' : amountCents > r.confirmAboveCents ? 'reinforced' : 'none';
  return {
    amountCents, paidReferenceCents: r.Q, market: r.M !== null ? { cents: r.M, capturedDate: c.marketCapturedDate! } : null,
    referenceCents: r.R, confirmAboveCents: r.confirmAboveCents, limitCents: r.limitCents, confirmation,
    stripeAvailableCents: r.stripeAvailableCents, caseStripeCents: stripe, shipmentFeeCents: shipmentFee, stripeCents: stripe + shipmentFee, manualCents: manual,
    closesShipment: closes, customerHasClabe: c.customerHasClabe,
  };
}

function assertCaseRefundable(c: MockCase): void {
  requireSuperAdmin();
  if (c.status !== 'open' && c.status !== 'refunded') throw new ApiFixtureError(409, 'CASE_NOT_OPEN', 'Case is not open', { status: c.status, resolvedAt: c.resolvedAt });
  if (!c.origin) throw new ApiFixtureError(409, 'CASE_REFUND_NOT_AVAILABLE', 'No origin order', { reason: 'no_origin_order' });
  const origin = origins[c.origin.orderId];
  if (origin.priceConvention !== 'IVA_INCLUSIVE') throw new ApiFixtureError(409, 'CASE_REFUND_NOT_AVAILABLE', 'Legacy convention', { reason: 'legacy_convention' });
  if (origin.status !== 'settled') throw new ApiFixtureError(409, 'CASE_ORIGIN_NOT_SETTLED', 'Origin order is not settled', { originStatus: origin.status });
}

/** MOCK de `GET /admin/replacement-cases/:id/refund-preview?amountCents=` (SOLO super_admin). */
export function mockCaseRefundPreview(caseId: string, amountCents: number | null): CaseRefundPreviewDTO {
  const c = findCase(caseId);
  if (c.status !== 'open') throw new ApiFixtureError(409, 'CASE_NOT_OPEN', 'Case is not open', { status: c.status, resolvedAt: c.resolvedAt });
  assertCaseRefundable(c);
  if (amountCents !== null && (!Number.isInteger(amountCents) || amountCents < 1)) {
    throw new ApiFixtureError(400, 'VALIDATION_ERROR', 'amountCents must be an integer >= 1', { field: 'amountCents' });
  }
  return clone(caseRefundPlan(c, amountCents));
}

/** MOCK de `POST /admin/replacement-cases/:id/refund` (§M4-SHIP.15.5, SOLO super_admin). */
export function mockRefundCase(caseId: string, body: CaseRefundRequest): CaseRefundResponse {
  requireSuperAdmin();
  const reason = body.reason?.trim() ?? '';
  if (!Number.isInteger(body.amountCents) || body.amountCents < 1) throw new ApiFixtureError(400, 'VALIDATION_ERROR', 'amountCents invalid', { field: 'amountCents' });
  if (reason.length < 3 || reason.length > 500) throw new ApiFixtureError(400, 'VALIDATION_ERROR', 'reason 3-500', { field: 'reason' });
  if (!Number.isInteger(body.expectedStripeCents) || body.expectedStripeCents < 0) throw new ApiFixtureError(400, 'VALIDATION_ERROR', 'expectedStripeCents', { field: 'expectedStripeCents' });
  if (!Number.isInteger(body.expectedManualCents) || body.expectedManualCents < 0) throw new ApiFixtureError(400, 'VALIDATION_ERROR', 'expectedManualCents', { field: 'expectedManualCents' });
  const c = findCase(caseId);
  if (c.status === 'refunded') {
    return clone({
      outcome: 'already_resolved', case: projectCase(c),
      refunds: refunds.filter((r) => r.replacementCaseId === c.id).map(toRefundDTO),
      manualRefunds: manualRefunds.filter((m) => m.replacementCaseId === c.id).map(projectManualRefund),
    });
  }
  assertCaseRefundable(c);
  const plan = caseRefundPlan(c, body.amountCents);
  if (plan.confirmation === 'blocked') {
    throw new ApiFixtureError(422, 'CASE_REFUND_ABOVE_LIMIT', 'Amount above the hard limit', { referenceCents: plan.referenceCents, limitCents: plan.limitCents });
  }
  if (plan.confirmation === 'reinforced' && body.confirmAboveReference !== true) {
    throw new ApiFixtureError(422, 'CASE_REFUND_CONFIRMATION_REQUIRED', 'Amount above 2x the reference', {
      referenceCents: plan.referenceCents, confirmAboveCents: plan.confirmAboveCents, limitCents: plan.limitCents,
    });
  }
  if (body.expectedStripeCents !== plan.stripeCents || body.expectedManualCents !== plan.manualCents) {
    throw new ApiFixtureError(409, 'REFUND_PREVIEW_STALE', 'Preview is stale', { stripeCents: plan.stripeCents, manualCents: plan.manualCents });
  }
  const now = nowIso();
  const origin = origins[c.origin!.orderId];
  const created: MockRefundRow[] = [];
  const createdManual: MockManualRefund[] = [];
  const Q = plan.paidReferenceCents;
  // §M4-SHIP.15.5 (como `replacement-case.service`): fila Stripe = `caseRefundComponents(stripe)`, fila SPEI =
  // `caseRefundComponents(A) − caseRefundComponents(stripe)` componente a componente (monótona ⇒ sin negativos).
  const ctx = caseRefundContextOf(origin, c.unitPriceCents);
  const compA = caseRefundComponents(body.amountCents, ctx);
  const compStripe = caseRefundComponents(plan.caseStripeCents!, ctx);
  const compManual = subtractRefundComponents(compA, compStripe);
  if (plan.caseStripeCents! > 0) {
    const row: MockRefundRow = {
      id: nextId('pr'), kind: 'case_refund', status: 'requested', amountCents: plan.caseStripeCents!, missingReason: null, components: compStripe,
      requestedAt: now, requestedBy: { ...MOCK_SUPER, role: 'super_admin' }, submittedAt: null, succeededAt: null, failedAt: null, failureCode: null,
      orderId: origin.id, shipmentRequestId: null, shipmentItemId: null, orderItemInventoryId: c.original.inventoryItemId, replacementCaseId: c.id,
      customerUserId: c.customer.userId, orderNumber: origin.orderNumber, item: { folio: c.original.folio, cardName: c.original.card.name },
    };
    refunds.push(row);
    created.push(row);
    c.refund = toRefundDTO(row);
  }
  if (plan.manualCents! > 0) {
    const m: MockManualRefund = {
      id: nextId('mr'), source: 'case_excess', status: 'pending', amountCents: plan.manualCents!,
      components: manualRefundComponentsOf(compManual),
      customer: c.customer, case: { id: c.id, source: c.source, card: c.original.card, folio: c.original.folio, reason },
      paymentRefundId: null, createdAt: now, createdBy: MOCK_SUPER, paidAt: null, paidBy: null, speiReference: null, paidNote: null,
      cancelledAt: null, cancelledBy: null, cancelNote: null, reissuedFromId: null, reissuedAsId: null,
      replacementCaseId: c.id, originOrderId: origin.id, paidClabeHmac: null,
    };
    manualRefunds.push(m);
    createdManual.push(m);
  }
  let shipmentResult: { status: AdminShipmentDTO['status']; closed: boolean } | undefined;
  const s = shipOfCase(c);
  if (plan.closesShipment && s) {
    const row: MockRefundRow = {
      id: nextId('pr'), kind: 'shipment_fee', status: 'requested', amountCents: s.shipmentTotalCents, missingReason: null,
      requestedAt: now, requestedBy: { ...MOCK_SUPER, role: 'super_admin' }, submittedAt: null, succeededAt: null, failedAt: null, failureCode: null,
      orderId: null, shipmentRequestId: s.dto.shipmentId, shipmentItemId: null, orderItemInventoryId: null, replacementCaseId: null,
      customerUserId: c.customer.userId, orderNumber: null, item: null,
    };
    refunds.push(row);
    created.push(row);
    s.status = 'cancelado';
    shipmentResult = { status: 'cancelado', closed: true };
  } else if (s) {
    shipmentResult = { status: s.status, closed: false };
  }
  c.status = 'refunded';
  c.resolvedAt = now;
  c.resolvedBy = MOCK_SUPER;
  c.refundCapture = { amountCents: body.amountCents, reason, paidReferenceCents: Q, market: plan.market, aboveReferenceConfirmed: plan.confirmation === 'reinforced' };
  originalToPlatform(c);
  created.forEach(executeRefund);
  if (s) recomputeShip(s);
  return clone({
    outcome: 'refunded', case: projectCase(c), refunds: created.map(toRefundDTO), manualRefunds: createdManual.map(projectManualRefund),
    ...(shipmentResult ? { shipment: shipmentResult } : {}),
  });
}

/** MOCK de `POST /admin/replacement-cases/:id/void` (§M4-SHIP.15.10, SOLO super_admin). */
export function mockVoidCase(caseId: string, note: string): VoidCaseResponse {
  requireSuperAdmin();
  const trimmed = note?.trim() ?? '';
  if (trimmed.length < 1 || trimmed.length > 500) throw new ApiFixtureError(400, 'VALIDATION_ERROR', 'note 1-500', { field: 'note' });
  const c = findCase(caseId);
  if (c.status === 'voided') return clone({ outcome: 'already_resolved', case: projectCase(c) });
  if (c.status !== 'open') throw new ApiFixtureError(409, 'CASE_NOT_OPEN', 'Case is not open', { status: c.status, resolvedAt: c.resolvedAt });
  const origin = c.origin ? origins[c.origin.orderId] : null;
  if (origin && origin.status === 'settled') {
    throw new ApiFixtureError(409, 'CASE_NOT_VOIDABLE', 'Origin order is still settled', { originStatus: 'settled' });
  }
  c.status = 'voided';
  c.voidNote = trimmed;
  c.resolvedAt = nowIso();
  c.resolvedBy = MOCK_SUPER;
  originalToPlatform(c);
  const s = shipOfCase(c);
  let shipmentResult: { status: AdminShipmentDTO['status']; closed: boolean } | undefined;
  if (s) {
    if (caseClosesShipment(c)) { s.status = 'cancelado'; shipmentResult = { status: 'cancelado', closed: true }; }
    else shipmentResult = { status: s.status, closed: false };
    recomputeShip(s);
  }
  return clone({ outcome: 'voided', case: projectCase(c), ...(shipmentResult ? { shipment: shipmentResult } : {}) });
}

// ────────────────────────────────────────────────────────────────────────────────────────────
// Cubeta SPEI (§M4-SHIP.15.13 / .17.3 / .17.4 / .17.8) — todo SOLO super_admin
// ────────────────────────────────────────────────────────────────────────────────────────────

export function mockManualRefunds(filters: ManualRefundsFilters): ManualRefundsResponse {
  requireSuperAdmin();
  const status = filters.status ?? 'pending';
  let rows = manualRefunds.filter((m) => m.status === status);
  const q = filters.q?.trim().toLowerCase();
  if (q) rows = rows.filter((m) => [m.customer.fullName, m.customer.email, m.case.folio, m.speiReference, origins[m.originOrderId ?? '']?.orderNumber].some((v) => v?.toLowerCase().includes(q)));
  rows.sort((a, b) => (status === 'pending' ? a.createdAt.localeCompare(b.createdAt) : ((b.paidAt ?? b.cancelledAt) ?? '').localeCompare((a.paidAt ?? a.cancelledAt) ?? '')));
  const data = rows.map(projectManualRefund);
  return { data, page: filters.page ?? 1, pageSize: 25, total: data.length, pendingCents: manualRefunds.filter((m) => m.status === 'pending').reduce((s, m) => s + m.amountCents, 0) };
}

function findManualRefund(id: string): MockManualRefund {
  requireSuperAdmin();
  const m = manualRefunds.find((x) => x.id === id);
  if (!m) throw new ApiFixtureNotFound(`ManualRefund ${id} not found`);
  return m;
}

export function mockManualRefund(id: string): ManualRefundDTO {
  return projectManualRefund(findManualRefund(id));
}

export function mockRevealManualRefundClabe(id: string): RevealManualRefundClabeResponse {
  const m = findManualRefund(id);
  if (m.status !== 'pending') throw new ApiFixtureError(409, 'MANUAL_REFUND_NOT_PENDING', 'Not pending', { status: m.status });
  const k = kyc[m.customer.userId];
  if (!k?.clabe) throw new ApiFixtureError(422, 'CLABE_NOT_ON_FILE', 'Customer has no CLABE on file');
  const dto = projectManualRefund(m);
  return { clabe: k.clabe, beneficiaryName: dto.beneficiaryName, clabeUpdatedAt: k.clabeUpdatedAt, clabeChangedRecently: dto.clabeChangedRecently, revealToken: revealTokenFor(m.id, k.clabeHmac!) };
}

export function mockMarkManualRefundPaid(id: string, body: MarkManualRefundPaidRequest): ManualRefundDTO {
  if (!body.revealToken || body.revealToken.length > 128) throw new ApiFixtureError(400, 'VALIDATION_ERROR', 'revealToken required', { field: 'revealToken' });
  if (body.speiReference !== undefined && !/^[A-Za-z0-9]{1,30}$/.test(body.speiReference)) {
    throw new ApiFixtureError(400, 'VALIDATION_ERROR', 'speiReference must be 1-30 alphanumeric', { field: 'speiReference' });
  }
  if (body.note !== undefined && body.note.length > 500) throw new ApiFixtureError(400, 'VALIDATION_ERROR', 'note <= 500', { field: 'note' });
  const m = findManualRefund(id);
  if (m.status === 'paid') {
    if (body.speiReference === undefined || body.speiReference === m.speiReference) return projectManualRefund(m);
    throw new ApiFixtureError(409, 'MANUAL_REFUND_NOT_PENDING', 'Already paid', { status: m.status });
  }
  if (m.status !== 'pending') throw new ApiFixtureError(409, 'MANUAL_REFUND_NOT_PENDING', 'Not pending', { status: m.status });
  const k = kyc[m.customer.userId];
  if (!k?.clabe) throw new ApiFixtureError(422, 'CLABE_NOT_ON_FILE', 'Customer has no CLABE on file');
  if (body.revealToken !== revealTokenFor(m.id, k.clabeHmac!)) {
    throw new ApiFixtureError(409, 'CLABE_CHANGED_SINCE_REVEAL', 'CLABE changed since reveal', { clabeUpdatedAt: k.clabeUpdatedAt });
  }
  const dto = projectManualRefund(m);
  const required: ('recent_clabe_change' | 'origin_not_settled')[] = [];
  if (dto.clabeChangedRecently && body.confirmRecentClabeChange !== true) required.push('recent_clabe_change');
  if (dto.origin && dto.origin.orderStatus !== 'settled' && body.confirmOriginNotSettled !== true) required.push('origin_not_settled');
  if (required.length > 0) {
    throw new ApiFixtureError(422, 'MANUAL_REFUND_CONFIRMATION_REQUIRED', 'Confirmation required', {
      required, clabeUpdatedAt: k.clabeUpdatedAt, ...(dto.origin ? { originStatus: dto.origin.orderStatus } : {}),
    });
  }
  m.status = 'paid';
  m.paidAt = nowIso();
  m.paidBy = MOCK_SUPER;
  m.speiReference = body.speiReference ?? null;
  m.paidNote = body.note?.trim() || null;
  m.paidClabeHmac = k.clabeHmac;
  return projectManualRefund(m);
}

export function mockCancelManualRefund(id: string, note: string): ManualRefundDTO {
  const trimmed = note?.trim() ?? '';
  if (trimmed.length < 3 || trimmed.length > 500) throw new ApiFixtureError(400, 'VALIDATION_ERROR', 'note 3-500', { field: 'note' });
  const m = findManualRefund(id);
  if (m.status === 'cancelled') return projectManualRefund(m);
  if (m.status !== 'pending') throw new ApiFixtureError(409, 'MANUAL_REFUND_NOT_PENDING', 'Not pending', { status: m.status });
  m.status = 'cancelled';
  m.cancelledAt = nowIso();
  m.cancelledBy = MOCK_SUPER;
  m.cancelNote = trimmed;
  return projectManualRefund(m);
}

export function mockReissueManualRefund(id: string, note: string): ManualRefundDTO {
  const trimmed = note?.trim() ?? '';
  if (trimmed.length < 3 || trimmed.length > 500) throw new ApiFixtureError(400, 'VALIDATION_ERROR', 'note 3-500', { field: 'note' });
  const m = findManualRefund(id);
  if (m.status !== 'cancelled') throw new ApiFixtureError(409, 'MANUAL_REFUND_NOT_CANCELLED', 'Not cancelled', { status: m.status });
  if (m.reissuedAsId) return projectManualRefund(findManualRefund(m.reissuedAsId));
  const alive = manualRefunds.find((x) => x.replacementCaseId === m.replacementCaseId && x.source === m.source && x.status !== 'cancelled');
  if (alive) throw new ApiFixtureError(409, 'MANUAL_REFUND_NOT_CANCELLED', 'Another live row exists', { status: 'cancelled', activeManualRefundId: alive.id });
  const n: MockManualRefund = {
    ...clone(m), id: nextId('mr'), status: 'pending', createdAt: nowIso(), createdBy: MOCK_SUPER,
    paidAt: null, paidBy: null, speiReference: null, paidNote: null, cancelledAt: null, cancelledBy: null, cancelNote: null,
    reissuedFromId: m.id, reissuedAsId: null, paidClabeHmac: null,
  };
  manualRefunds.push(n);
  m.reissuedAsId = n.id;
  return projectManualRefund(n);
}

/** MOCK de `POST /admin/refunds/:refundId/to-manual` (§M4-SHIP.17.4). */
export function mockRefundToManual(refundId: string): ManualRefundDTO {
  requireSuperAdmin();
  const r = refunds.find((x) => x.id === refundId);
  if (!r) throw new ApiFixtureNotFound(`PaymentRefund ${refundId} not found`);
  if (r.kind !== 'case_refund') throw new ApiFixtureError(409, 'REFUND_NOT_CONVERTIBLE', 'Only case_refund rows', { kind: r.kind });
  if (r.status !== 'failed') throw new ApiFixtureError(409, 'REFUND_NOT_CONVERTIBLE', 'Only failed rows', { status: r.status });
  const existing = manualRefunds.find((m) => m.paymentRefundId === r.id);
  if (existing) return projectManualRefund(existing);
  const origin = r.orderId ? origins[r.orderId] : null;
  if (origin && origin.status !== 'settled') throw new ApiFixtureError(409, 'CASE_ORIGIN_NOT_SETTLED', 'Origin not settled', { originStatus: origin.status });
  if (r.failureCode === 'charge_disputed') throw new ApiFixtureError(409, 'CASE_ORIGIN_NOT_SETTLED', 'Charge disputed', { originStatus: 'settled', reason: 'charge_disputed' });
  const c = cases.find((x) => x.id === r.replacementCaseId)!;
  // `manual-refund.service.toManual`: la transferencia COPIA los componentes congelados de la fila fallida. Una fila
  // sembrada sin ellos se desglosa con el mismo cuerpo (`caseRefundComponents` sobre su orden de origen).
  const rowComponents = r.components ?? (origin ? caseRefundComponents(r.amountCents, caseRefundContextOf(origin, c.unitPriceCents)) : null);
  const m: MockManualRefund = {
    id: nextId('mr'), source: 'stripe_failed', status: 'pending', amountCents: r.amountCents,
    components: rowComponents
      ? manualRefundComponentsOf(rowComponents)
      : { merchandiseCents: r.amountCents, merchandiseIvaCents: 0, processingFeeCents: 0, compensationCents: 0 },
    customer: c.customer, case: { id: c.id, source: c.source, card: c.original.card, folio: c.original.folio, reason: c.refundCapture?.reason ?? '' },
    paymentRefundId: r.id, createdAt: nowIso(), createdBy: MOCK_SUPER, paidAt: null, paidBy: null, speiReference: null, paidNote: null,
    cancelledAt: null, cancelledBy: null, cancelNote: null, reissuedFromId: null, reissuedAsId: null,
    replacementCaseId: c.id, originOrderId: r.orderId, paidClabeHmac: null,
  };
  manualRefunds.push(m);
  return projectManualRefund(m);
}

// ────────────────────────────────────────────────────────────────────────────────────────────
// La vista del súper-admin sobre los reembolsos (§M4-SHIP.17.5)
// ────────────────────────────────────────────────────────────────────────────────────────────

export function mockAdminRefunds(filters: AdminRefundsFilters): AdminRefundsResponse {
  requireSuperAdmin();
  let rows = [...refunds];
  if (filters.requestedByRole) rows = rows.filter((r) => r.requestedBy.role === filters.requestedByRole);
  if (filters.actorUserId) rows = rows.filter((r) => r.requestedBy.userId === filters.actorUserId);
  if (filters.kind) rows = rows.filter((r) => r.kind === filters.kind);
  if (filters.status) rows = rows.filter((r) => r.status === filters.status);
  rows.sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
  const data: AdminRefundRowDTO[] = rows.map((r) => ({
    ...toRefundDTO(r),
    order: r.orderId ? { id: r.orderId, orderNumber: r.orderNumber } : null,
    shipmentId: r.shipmentRequestId,
    customer: r.customerUserId ? { userId: r.customerUserId, fullName: ships.find((s) => s.dto.customer.userId === r.customerUserId)?.dto.customer.fullName ?? cases.find((c) => c.customer.userId === r.customerUserId)?.customer.fullName ?? null, email: '' } : null,
    item: r.item,
  }));
  return clone({ data, page: filters.page ?? 1, pageSize: filters.pageSize ?? 25, total: data.length, sumCents: rows.filter((r) => r.status !== 'failed').reduce((s, r) => s + r.amountCents, 0) });
}

export function mockOperatorRefundSummary(): OperatorRefundSummaryResponse {
  requireSuperAdmin();
  const now = Date.now();
  const window = (h: number) => refunds.filter((r) => r.requestedBy.role === 'vault_operator' && r.status !== 'failed' && now - new Date(r.requestedAt).getTime() < h * 3600 * 1000);
  const agg = (rows: MockRefundRow[]) => ({ count: rows.length, cents: rows.reduce((s, r) => s + r.amountCents, 0) });
  const prepared = ships.filter((s) => s.dto.preparation.status === 'prepared' && s.dto.preparation.preparedBy.userId === MOCK_SHIP_OPERATOR.userId);
  const lines = prepared.reduce((n, s) => n + s.dto.items.length, 0);
  const missingLines = prepared.reduce((n, s) => n + s.dto.items.filter((i) => i.prepStatus === 'missing').length, 0);
  return clone({
    generatedAt: nowIso(),
    capCents: MOCK_OPERATOR_REFUND_CAP_CENTS,
    operators: [
      {
        user: { userId: MOCK_SHIP_OPERATOR.userId, name: MOCK_SHIP_OPERATOR.name, email: 'operador@tcghunt.mx', active: true },
        refunds: { last24h: agg(window(24)), last7d: agg(window(24 * 7)), last30d: agg(window(24 * 30)) },
        capUsedCents: operatorUsedCents(MOCK_SHIP_OPERATOR.userId),
        prepared30d: { shipments: prepared.length, lines, missingLines, missingRatePct: lines === 0 ? null : Math.round((missingLines / lines) * 1000) / 10 },
        shrinkage30d: { pieces: missingLines + 1, costCents: 41_000, unknownCostPieces: 0 },
        selfReplaced30d: cases.filter((c) => c.status === 'replaced' && c.openedBy.userId === MOCK_SHIP_OPERATOR.userId && c.resolvedBy?.userId === MOCK_SHIP_OPERATOR.userId).length,
      },
    ],
  });
}

// ────────────────────────────────────────────────────────────────────────────────────────────
// M3: detalle, reembolso total, `chargeback-inventory` y `reclaim-vault` (§M3, §M4-SHIP.18)
// ────────────────────────────────────────────────────────────────────────────────────────────

/** Lo que §M4-SHIP.10/.15.13/.18.6 añaden al detalle M3 de una orden (el resto sale de `fixtures`). */
export function mockAdminOrderDetailAdditions(orderId: string): Partial<AdminOrderDetailDTO> {
  const origin = origins[orderId];
  const isSuper = mockCallerRole() === 'super_admin';
  const rows = refunds.filter((r) => r.orderId === orderId);
  const manual = manualRefunds.filter((m) => m.originOrderId === orderId);
  const shipRows = ships.filter((s) => s.dto.orderId === orderId);
  const base: Partial<AdminOrderDetailDTO> = {
    // MOCK §M4-SHIP.18.12 (7): `shipmentShipped` vivo y `fullRefundReview` (null si no hay reembolso total cerrado).
    shipmentShipped: shipRows.some((s) => s.status === 'enviado' || s.status === 'entregado'),
    fullRefundReview: origin ? fullRefundReviewOf(origin) : null,
    orderNumber: origin?.orderNumber ?? null,
    fulfillmentMode: origin?.fulfillmentMode,
    status: origin?.status,
    chargebackNeedsManual: origin?.chargebackNeedsManual ?? false,
    customer: origin?.userId ? { userId: origin.userId, fullName: ships.find((s) => s.dto.customer.userId === origin.userId)?.dto.customer.fullName ?? cases.find((c) => c.customer.userId === origin.userId)?.customer.fullName ?? null, email: cases.find((c) => c.customer.userId === origin.userId)?.customer.email ?? '' } : null,
    refundedCents: rows.filter((r) => r.status === 'submitted' || r.status === 'succeeded').reduce((s, r) => s + r.amountCents, 0),
    refunds: rows.map(toRefundDTO),
    shipments: shipRows.map((s) => ({ id: s.dto.shipmentId, status: s.status, kind: s.dto.kind, requestedAt: s.dto.requestedAt, preparedAt: s.dto.preparation.status === 'prepared' ? s.dto.preparation.preparedAt : null, carrier: null, trackingNumber: null })),
    vaultPlacement: origin?.fulfillmentMode === 'vault' ? { id: `vp-${orderId}`, status: origin.status === 'refunded' ? 'cancelled' : 'placed' } : null,
  };
  if (origin?.fulfillmentMode === 'vault') base.vaultPieces = vaultPiecesOf(orderId);
  if (isSuper) {
    base.manualRefundedCents = manual.filter((m) => m.status === 'paid').reduce((s, m) => s + m.amountCents, 0);
    base.manualRefunds = manual.map(projectManualRefund);
  }
  return clone(base);
}

/** MOCK §M4-SHIP.18.12 (7): proyección de lectura del motivo. Un solo cuerpo (detalle, registro y fila). */
function fullRefundReviewOf(origin: MockOriginOrder): FullRefundReviewDTO | null {
  if (!origin.fullRefundClosedAt) return null;
  const after = origin.fullRefundAfterShipment === true;
  const r = origin.shippedRefund ?? null;
  return {
    afterShipment: after,
    pending: after && r === null,
    reason: r?.reason ?? null,
    note: r?.note ?? null,
    recordedAt: r?.at ?? null,
    recordedBy: r ? r.by : null,
  };
}

/** MOCK de `POST /admin/orders/:id/shipped-refund-reason` (§M4-SHIP.18.12 (6)): `@MoneyOut`, registro final. */
export function mockRecordShippedRefundReason(orderId: string, body: RecordShippedRefundReasonRequest): RecordShippedRefundReasonResponse {
  requireSuperAdmin();
  const origin = origins[orderId];
  if (!origin) throw new ApiFixtureNotFound(`Order ${orderId} not found`);
  if (!(SHIPPED_REFUND_REASONS as readonly string[]).includes(body.reason)) {
    throw new ApiFixtureError(400, 'VALIDATION_ERROR', 'reason', { field: 'reason', allowed: [...SHIPPED_REFUND_REASONS] });
  }
  if (origin.fullRefundAfterShipment !== true) {
    throw new ApiFixtureError(409, 'SHIPPED_REFUND_REASON_NOT_APPLICABLE', 'Not after shipment', { afterShipment: false });
  }
  const existing = origin.shippedRefund ?? null;
  if (existing) {
    if (existing.reason !== body.reason) throw new ApiFixtureError(409, 'SHIPPED_REFUND_REASON_ALREADY_SET', 'Already set', { reason: existing.reason });
    return clone({ orderId, outcome: 'already_recorded' as const, fullRefundReview: fullRefundReviewOf(origin)! });
  }
  const note = body.note?.trim() ? body.note.trim().slice(0, 500) : null;
  origin.shippedRefund = { reason: body.reason, note, at: nowIso(), by: { id: MOCK_SUPER.userId, name: MOCK_SUPER.name } };
  return clone({ orderId, outcome: 'recorded' as const, fullRefundReview: fullRefundReviewOf(origin)! });
}

/** MOCK de `POST /admin/orders/:id/refund` (§M3 v1.80 / v1.80.4 / v1.80.5). Devuelve el nuevo estado. */
export function mockRefundOrderTotal(orderId: string, body: RefundOrderRequest): RefundOrderResponse {
  requireSuperAdmin();
  const origin = origins[orderId];
  if (!origin) throw new ApiFixtureNotFound(`Order ${orderId} not found`);
  if (origin.status !== 'settled') throw new ApiFixtureError(422, 'VALIDATION_ERROR', 'Only a settled order can be refunded');
  const remaining = origin.totalCents - refundedOnOrder(orderId);
  if (remaining <= 0) throw new ApiFixtureError(409, 'CONFLICT', 'Nothing left to refund');
  const pieces = vaultPieces.filter((p) => p.orderId === orderId);
  // MOCK §M4-SHIP.18.12 (4): «enviado» se decide en la tx1 (aquí: el estado vivo de los envíos de la orden).
  const shippedRow = origin.fulfillmentMode === 'direct_ship'
    ? ships.find((s) => s.dto.orderId === orderId && (s.status === 'enviado' || s.status === 'entregado'))
    : undefined;
  if (shippedRow && !body.shippedReason) {
    throw new ApiFixtureError(422, 'REFUND_CONFIRMATION_REQUIRED', 'Shipped order needs a reason', {
      required: ['shipped_reason'], shipmentStatus: shippedRow.status,
    });
  }
  if (!shippedRow && body.shippedReason) {
    throw new ApiFixtureError(409, 'SHIPPED_REFUND_REASON_NOT_APPLICABLE', 'Order not shipped', { afterShipment: false });
  }
  if (origin.fulfillmentMode === 'vault') {
    // Precondición 1 (tx1): una carta en un retiro preparado o con guía ⇒ deshacer el preparado primero.
    const packed = pieces.filter((p) => p.state === 'in_packed_withdrawal' || (p.state === 'in_custody' && p.shipmentId && (ships.find((s) => s.dto.shipmentId === p.shipmentId)?.dto.preparation.status === 'prepared' || ships.find((s) => s.dto.shipmentId === p.shipmentId)?.status === 'guia')));
    if (packed.length > 0) {
      throw new ApiFixtureError(409, 'VAULT_PIECE_IN_PACKED_WITHDRAWAL', 'A piece is in a packed withdrawal', {
        items: packed.map((p) => ({ inventoryItemId: p.inventoryItemId, folio: p.folio, shipmentId: p.shipmentId!, shipmentStatus: ships.find((s) => s.dto.shipmentId === p.shipmentId)?.status ?? 'picking' })),
      });
    }
    // Precondición 2 (SEC-SHIP-B10): cartas ya con el cliente.
    const withCustomer = pieces.filter((p) => p.state === 'already_withdrawn');
    if (withCustomer.length > 0 && body.confirmPiecesWithCustomer !== true) {
      throw new ApiFixtureError(422, 'REFUND_CONFIRMATION_REQUIRED', 'Pieces already with the customer', {
        required: ['pieces_with_customer'], items: withCustomer.map((p) => ({ inventoryItemId: p.inventoryItemId, folio: p.folio, state: 'already_withdrawn' })),
      });
    }
  }
  const row: MockRefundRow = {
    id: nextId('pr'), kind: 'order_full', status: 'requested', amountCents: remaining, missingReason: null,
    requestedAt: nowIso(), requestedBy: { ...MOCK_SUPER, role: 'super_admin' }, submittedAt: null, succeededAt: null, failedAt: null, failureCode: null,
    orderId, shipmentRequestId: null, shipmentItemId: null, orderItemInventoryId: null, replacementCaseId: null,
    customerUserId: origin.userId, orderNumber: origin.orderNumber, item: null,
  };
  refunds.push(row);
  // Directo: cierra el envío vivo en la misma tx (SEC-SHIP-A2).
  for (const s of ships) {
    if (s.dto.orderId === orderId && (s.status === 'picking' || s.status === 'guia')) { s.status = 'cancelado'; origin.chargebackNeedsManual = true; }
  }
  // Confirmación (Stripe acepta en el doble): la orden pasa a `refunded` y en bóveda corre el reclamo.
  executeRefund(row);
  origin.status = 'refunded';
  origin.fullRefundClosedAt = nowIso();
  origin.fullRefundAfterShipment = !!shippedRow;
  if (shippedRow && body.shippedReason) {
    origin.shippedRefund = { reason: body.shippedReason, note: body.reason.trim().slice(0, 500) || null, at: nowIso(), by: { id: MOCK_SUPER.userId, name: MOCK_SUPER.name } };
  }
  if (origin.fulfillmentMode === 'vault') {
    for (const p of pieces) {
      if (p.state === 'in_custody') {
        const inLive = p.shipmentId ? ships.find((s) => s.dto.shipmentId === p.shipmentId) : null;
        if (inLive && (inLive.dto.preparation.status === 'prepared' || inLive.status === 'guia')) p.state = 'in_packed_withdrawal';
        else { p.state = 'returned'; p.pendingConfirmation = true; if (inLive) { const line = inLive.dto.items.find((i) => i.inventoryItemId === p.inventoryItemId); if (line) line.availability = { kind: 'blocked', reason: 'piece_not_available', pieceStatus: 'picking' }; } }
      }
    }
    if (pieces.length > 0) origin.chargebackNeedsManual = true;
  }
  ships.forEach(recomputeShip);
  return { orderId, status: 'refunded', refundId: row.id };
}

/** MOCK de `POST /admin/orders/:id/chargeback-inventory` (§M3, v1.80.4/.5). */
export function mockChargebackInventory(orderId: string, body: ChargebackInventoryRequest): ChargebackInventoryResponse {
  const note = body.note?.trim() ?? '';
  if (note.length < 3 || note.length > 500) throw new ApiFixtureError(400, 'VALIDATION_ERROR', 'note 3-500', { field: 'note' });
  if (!['recuperada', 'no_recuperada', 'reexpedir'].includes(body.outcome)) throw new ApiFixtureError(400, 'VALIDATION_ERROR', 'outcome invalid', { field: 'outcome' });
  const origin = origins[orderId];
  if (!origin) throw new ApiFixtureNotFound(`Order ${orderId} not found`);
  if (origin.fulfillmentMode === 'vault' && origin.status !== 'refunded') throw new ApiFixtureError(400, 'VALIDATION_ERROR', 'vault order must be refunded', { field: 'order' });
  if (!origin.chargebackNeedsManual) throw new ApiFixtureError(409, 'CONFLICT', 'Order already resolved');
  if (body.outcome === 'reexpedir' && origin.fulfillmentMode === 'vault') throw new ApiFixtureError(409, 'CONFLICT', 'A vault purchase has no shipment to reship');
  const targets = vaultPieces.filter((p) => p.orderId === orderId && p.pendingConfirmation);
  for (const p of targets) {
    p.pendingConfirmation = false;
    p.state = 'returned';
  }
  origin.chargebackNeedsManual = false;
  return { orderId, outcome: body.outcome, inventoryItemIds: targets.map((p) => p.inventoryItemId), chargebackNeedsManual: false };
}

/** MOCK de `POST /admin/orders/:id/reclaim-vault` (§M4-SHIP.18.10, v1.80.6 con `inventoryItemIds`). */
export function mockReclaimVault(orderId: string, body: ReclaimVaultRequest): ReclaimVaultResponse {
  if (mockCallerRole() !== 'super_admin') throw new ApiFixtureError(403, 'FORBIDDEN', 'super_admin only');
  const note = body.note?.trim() ?? '';
  if (note.length < 3 || note.length > 500) throw new ApiFixtureError(400, 'VALIDATION_ERROR', 'note 3-500', { field: 'note' });
  if (body.inventoryItemIds !== undefined) {
    if (body.confirmUnpacked !== true) throw new ApiFixtureError(400, 'VALIDATION_ERROR', 'inventoryItemIds only with confirmUnpacked', { field: 'inventoryItemIds' });
    if (body.inventoryItemIds.length < 1 || body.inventoryItemIds.length > 50) throw new ApiFixtureError(400, 'VALIDATION_ERROR', 'inventoryItemIds 1-50', { field: 'inventoryItemIds' });
  }
  const origin = origins[orderId];
  if (!origin) throw new ApiFixtureNotFound(`Order ${orderId} not found`);
  if (origin.fulfillmentMode !== 'vault') throw new ApiFixtureError(409, 'CONFLICT', 'Not a vault order', { reason: 'not_vault' });
  if (!origin.fullRefundClosedAt) throw new ApiFixtureError(409, 'CONFLICT', 'Full refund not confirmed yet', { reason: 'not_closed' });
  const reclaimed: string[] = [];
  const untouched: { inventoryItemId: string; state: VaultPieceDTO['state'] }[] = [];
  for (const p of vaultPieces.filter((x) => x.orderId === orderId)) {
    const allowed = body.confirmUnpacked === true && (!body.inventoryItemIds || body.inventoryItemIds.includes(p.inventoryItemId));
    if (p.state === 'in_packed_withdrawal' && allowed) {
      p.state = 'returned';
      p.pendingConfirmation = true;
      const s = p.shipmentId ? ships.find((x) => x.dto.shipmentId === p.shipmentId) : null;
      if (s) {
        const line = s.dto.items.find((i) => i.inventoryItemId === p.inventoryItemId);
        if (line) line.availability = { kind: 'blocked', reason: 'piece_not_available', pieceStatus: 'picking' };
        recomputeShip(s);
      }
      p.shipmentId = null;
      reclaimed.push(p.inventoryItemId);
    } else if (p.state !== 'returned') {
      untouched.push({ inventoryItemId: p.inventoryItemId, state: p.state });
    }
  }
  if (reclaimed.length > 0) origin.chargebackNeedsManual = true;
  return clone({ orderId, reclaimed, untouched, chargebackNeedsManual: origin.chargebackNeedsManual, vaultPieces: vaultPiecesOf(orderId) });
}

/** Piezas de bóveda por cliente para «Mi bóveda»: la marca del caso abierto / reembolsado (§3). */
export function mockHoldingReplacementOf(inventoryItemId: string): import('@/types/contract').CustomerReplacementInfo | null {
  const c = cases.find((x) => x.original.inventoryItemId === inventoryItemId && x.status !== 'voided');
  if (!c) return null;
  const manual = manualRefunds.filter((m) => m.replacementCaseId === c.id);
  const live = manual.filter((m) => m.status !== 'cancelled');
  const refund =
    c.status === 'refunded' && c.refundCapture
      ? {
          amountCents: c.refundCapture.amountCents,
          byTransferCents: manual.reduce((s, m) => (m.status !== 'cancelled' ? s + m.amountCents : s), 0),
          transferStatus: manual.length === 0 ? null : live.length === 0 ? ('cancelled' as const) : live.some((m) => m.status === 'pending') ? ('pending' as const) : ('paid' as const),
        }
      : null;
  return { status: c.status, reason: c.missingReason, refund };
}

/**
 * ⭐ v1.80.7 (§3): `withdrawable` + `withdrawableReason` + `replacement` de un holding, derivados del estado vivo
 * del servidor falso (caso abierto ⇒ la pieza está `lost|damaged`; fila `order_full` viva sobre la compra de
 * origen ⇒ `origin_refunded`). UN cuerpo (`withdrawabilityOf`), como `vault.service`.
 */
export function mockHoldingWithdrawabilityOf(h: HoldingDTO): Pick<HoldingDTO, 'withdrawable' | 'withdrawableReason' | 'replacement'> {
  const replacement = mockHoldingReplacementOf(h.inventoryItemId);
  const replacementOpen = replacement?.status === 'open';
  const piece = vaultPieces.find((p) => p.inventoryItemId === h.inventoryItemId);
  const origin = piece ? origins[piece.orderId] : undefined;
  const originRefunded = !!origin && origin.status === 'settled' && origin.pendingFullRefund;
  return {
    ...withdrawabilityOf({
      ownershipStatus: h.ownershipStatus,
      // Con caso abierto la pieza ya no está `in_custody` (está `lost|damaged` del cliente).
      status: replacementOpen ? 'lost' : h.status,
      shipmentState: h.shipmentState,
      replacementOpen,
      originRefunded,
    }),
    ...(replacement ? { replacement } : {}),
  };
}

/** Lo que §M4-SHIP.10 añade a cada FILA de la lista M3 (`customer`, `refundedCents`) + el estado vivo. */
export function mockAdminOrderRowAdditions(orderId: string): Partial<AdminOrderDetailDTO> {
  const a = mockAdminOrderDetailAdditions(orderId);
  return { orderNumber: a.orderNumber, fulfillmentMode: a.fulfillmentMode, status: a.status, customer: a.customer, refundedCents: a.refundedCents, chargebackNeedsManual: a.chargebackNeedsManual, refundReviewPending: a.fullRefundReview?.pending === true };
}
