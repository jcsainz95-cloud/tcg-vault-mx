/**
 * MOCK: pendiente de backend real (Stream B, tarea B-1b). Simula **§4-R «la reserva tiene DUEÑO»**
 * (contrato v1.68) para que el front pueda ejercer los cuatro desenlaces de un reintento de
 * `POST /checkout/session` / `POST /checkout/guest/session` sin servidor:
 *
 *  · **REUSO** (`200 reused: true`): exactamente una reserva propia viva y su conjunto de piezas ==
 *    el carrito ⇒ misma orden, mismo PaymentIntent, `reservedUntil` renovado. **No se re-precia.**
 *  · **SUSTITUCIÓN** (`201` + `supersededOrderIds`): hay reservas propias vivas pero el carrito
 *    difiere ⇒ se cancela el PI viejo, se libera y se crea la orden nueva.
 *  · **PI viejo no cancelable** (`409 PAYMENT_IN_PROGRESS`, `details: { orderId, orderNumber }`):
 *    el dial `MOCK_PI_STATE_KEY = 'processing'` lo simula. **Cero escritura.**
 *  · **Reserva AJENA** (`409 ITEM_UNAVAILABLE`, como hoy): una pieza reservada por otra orden que
 *    el llamador no puede reclamar. Para el invitado eso incluye «perdí el `checkoutToken`»
 *    (§4-R.3 / R-7): sin token no hay reclamo de propiedad.
 *
 * El estado vive en **`sessionStorage`** (ámbito pestaña) y no en memoria del módulo: la rama mock
 * corre en el navegador y una navegación (`page.goto` de Playwright, «Reanudar pago» → `/checkout`)
 * recarga el módulo. ⛔ Nunca `localStorage`: una reserva de otra pestaña no es «propia».
 *
 * ⚠️ Es un simulador de CONDUCTA, no de cifras: no calcula dinero (el `breakdown` lo sigue
 * componiendo `api.ts` con la réplica local) y no decide TTLs distintos de la constante del contrato.
 */

/** `ORDER_RESERVATION_TTL_MIN` del contrato (§4-R.1): 60 minutos, para las DOS rutas. */
export const MOCK_RESERVATION_TTL_MIN = 60;

/** Clave del estado (sessionStorage). */
export const MOCK_RESERVATIONS_KEY = 'tcg.mock.reservations';
/**
 * Dial de E2E/demo (localStorage, para que `addInitScript` lo fije antes de cargar la app):
 * `'processing'` ⇒ el PI del intento anterior «ya no se puede cancelar» y una SUSTITUCIÓN responde
 * `409 PAYMENT_IN_PROGRESS`. Cualquier otro valor (o ausente) ⇒ cancelable.
 */
export const MOCK_PI_STATE_KEY = 'tcg.mock.checkoutPiState';

/** Pedido `pending` de las fixtures (`mockOrders`) que nace ya reservado a nombre de la cuenta. */
export const MOCK_FIXTURE_PENDING_ORDER_ID = 'ord-9002';
export const MOCK_FIXTURE_PENDING_ORDER_NUMBER = 'TCG-009002';
export const MOCK_FIXTURE_PENDING_ORDER_ITEM_IDS = ['inv-1002'] as const;

export interface MockReservation {
  orderId: string;
  orderNumber: string;
  inventoryItemIds: string[];
  paymentIntentId: string;
  /** ISO — vencimiento; una reserva vencida no es «viva» y no se reclama. */
  reservedUntil: string;
  /** Con cuenta: el `userId` de quien reservó. Invitado: `null`. */
  userId: string | null;
  /** Invitado: el `checkoutToken` vigente de la orden (la llave de §4-G.7a) y su correo. */
  checkoutToken: string | null;
  guestEmail: string | null;
  /**
   * MOCK: la reserva SEMBRADA del pedido `pending` de fixtures. Solo su dueño la ve (reuso y
   * «Reanudar pago»); **no bloquea a terceros**, para no volver invendible `inv-1002` en el resto
   * de fixtures y specs (catálogo, invitado). Una reserva creada de verdad en la pestaña sí bloquea.
   */
  fixture?: boolean;
}

interface MockReservationState {
  /** El pedido `pending` de fixtures ya se sembró como reserva propia (una vez por pestaña). */
  seededFixture: boolean;
  reservations: MockReservation[];
  /** Órdenes sustituidas: `GET /orders` las proyecta como `failed`. */
  superseded: string[];
}

/** Quién llama: cuenta (`userId`) o invitado (`retryOfCheckoutToken` + correo normalizado). */
export type MockCaller =
  | { kind: 'customer'; userId: string }
  | { kind: 'guest'; email: string; retryOfCheckoutToken?: string };

export type MockSessionDecision =
  | { kind: 'new' }
  | { kind: 'reuse'; reservation: MockReservation }
  | { kind: 'supersede'; superseded: MockReservation[] }
  | { kind: 'payment_in_progress'; order: MockReservation }
  | { kind: 'unavailable'; inventoryItemIds: string[] };

const EMPTY: MockReservationState = { seededFixture: false, reservations: [], superseded: [] };

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

function readState(): MockReservationState {
  const raw = storage()?.getItem(MOCK_RESERVATIONS_KEY);
  if (!raw) return { ...EMPTY, reservations: [], superseded: [] };
  try {
    const parsed = JSON.parse(raw) as Partial<MockReservationState>;
    return {
      seededFixture: parsed.seededFixture === true,
      reservations: Array.isArray(parsed.reservations) ? parsed.reservations : [],
      superseded: Array.isArray(parsed.superseded) ? parsed.superseded : [],
    };
  } catch {
    return { ...EMPTY, reservations: [], superseded: [] };
  }
}

function writeState(state: MockReservationState): void {
  storage()?.setItem(MOCK_RESERVATIONS_KEY, JSON.stringify(state));
}

/** Borra el estado del simulador (tests). */
export function resetMockReservations(): void {
  storage()?.removeItem(MOCK_RESERVATIONS_KEY);
}

export function mockReservedUntil(now = Date.now()): string {
  return new Date(now + MOCK_RESERVATION_TTL_MIN * 60_000).toISOString();
}

function isLive(r: MockReservation, now: number): boolean {
  const until = new Date(r.reservedUntil).getTime();
  return Number.isFinite(until) && until > now;
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

function ownedBy(r: MockReservation, caller: MockCaller): boolean {
  if (caller.kind === 'customer') return r.userId === caller.userId;
  // §4-R.3: el invitado SOLO reclama con el token vivo de esa orden Y el mismo correo. Un correo
  // solo no es identidad (cualquiera puede teclearlo). `email: ''` = reclamo solo por token: lo usa
  // el QUOTE de invitado, que no lleva correo (ver `readMockGuestRetryToken`).
  return (
    r.userId === null &&
    !!caller.retryOfCheckoutToken &&
    r.checkoutToken === caller.retryOfCheckoutToken &&
    (caller.email === '' || r.guestEmail === caller.email)
  );
}

/**
 * MOCK — espejo de `checkout/guest-retry-token.ts` (misma clave y mismo sobre; la paridad la
 * vigila `guest-retry-token.test.ts`). El quote de invitado (§4-G.1) **no lleva
 * `retryOfCheckoutToken`**, así que un backend literal listaría la reserva PROPIA del invitado en
 * `unavailableItems` y la vista la podaría antes de poder reintentar. El simulador lee el token de
 * la pestaña para que el quote reconozca lo propio — que es lo que §4-R necesita del quote y lo que
 * se pide al arquitecto (FRONTEND_NOTES §69).
 */
export function readMockGuestRetryToken(): string | undefined {
  try {
    const raw = storage()?.getItem('tcg.guestCheckoutRetry');
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as { token?: unknown; expiresAt?: unknown };
    const exp = typeof parsed.expiresAt === 'string' ? new Date(parsed.expiresAt).getTime() : NaN;
    if (typeof parsed.token !== 'string' || !Number.isFinite(exp) || exp <= Date.now()) return undefined;
    return parsed.token;
  } catch {
    return undefined;
  }
}

/**
 * Siembra, una vez por pestaña, el pedido `pending` de fixtures como reserva viva de la cuenta que
 * lo mira. Así «Reanudar pago» desde `/orders` termina en un `200 reused` real del simulador y no
 * en una orden nueva. Solo aplica a llamadores con cuenta.
 */
function ensureFixtureSeeded(state: MockReservationState, userId: string, now: number): void {
  if (state.seededFixture) return;
  state.seededFixture = true;
  state.reservations.push({
    orderId: MOCK_FIXTURE_PENDING_ORDER_ID,
    orderNumber: MOCK_FIXTURE_PENDING_ORDER_NUMBER,
    inventoryItemIds: [...MOCK_FIXTURE_PENDING_ORDER_ITEM_IDS],
    paymentIntentId: `pi_mock_${MOCK_FIXTURE_PENDING_ORDER_ID}`,
    // 45 min: dentro del TTL, pero visiblemente distinto de una reserva recién renovada.
    reservedUntil: new Date(now + 45 * 60_000).toISOString(),
    userId,
    checkoutToken: null,
    guestEmail: null,
    fixture: true,
  });
}

/** Reservas que un llamador NO puede reclamar y que sí le cierran el paso. */
function foreignTo(reservations: MockReservation[], caller: MockCaller, now: number): MockReservation[] {
  return reservations.filter((r) => isLive(r, now) && !r.fixture && !ownedBy(r, caller));
}

/** Reservas vivas del simulador (todas, propias y ajenas). */
export function liveMockReservations(now = Date.now()): MockReservation[] {
  return readState().reservations.filter((r) => isLive(r, now));
}

/** La reserva viva de un pedido concreto, si existe (para `GET /orders[/:id]`). */
export function mockReservationFor(orderId: string, userId: string | null, now = Date.now()) {
  const state = readState();
  if (userId) ensureFixtureSeeded(state, userId, now);
  writeState(state);
  return state.reservations.find((r) => r.orderId === orderId && isLive(r, now)) ?? null;
}

export function mockOrderSuperseded(orderId: string): boolean {
  return readState().superseded.includes(orderId);
}

/**
 * Piezas del carrito que están reservadas por una orden que el llamador NO puede reclamar
 * (contrato: una pieza `reserved` de otro no es vendible ⇒ el quote la lista en
 * `unavailableItems` y la session responde `409 ITEM_UNAVAILABLE`).
 */
export function mockReservedByOthers(ids: readonly string[], caller: MockCaller, now = Date.now()): string[] {
  const state = readState();
  if (caller.kind === 'customer') ensureFixtureSeeded(state, caller.userId, now);
  writeState(state);
  const foreign = foreignTo(state.reservations, caller, now);
  return ids.filter((id) => foreign.some((r) => r.inventoryItemIds.includes(id)));
}

function piUncancelable(): boolean {
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem(MOCK_PI_STATE_KEY) === 'processing';
  } catch {
    return false;
  }
}

/**
 * La tabla de §4-R.2, en el orden del contrato. **No escribe nada**: `commitMockSession` aplica la
 * decisión después de que `api.ts` haya compuesto la respuesta.
 */
export function decideMockSession(
  ids: readonly string[],
  caller: MockCaller,
  now = Date.now(),
): MockSessionDecision {
  const state = readState();
  if (caller.kind === 'customer') ensureFixtureSeeded(state, caller.userId, now);
  writeState(state);
  const live = state.reservations.filter((r) => isLive(r, now));
  const blocking = foreignTo(live, caller, now);
  const foreign = ids.filter((id) => blocking.some((r) => r.inventoryItemIds.includes(id)));
  if (foreign.length > 0) return { kind: 'unavailable', inventoryItemIds: foreign };
  const own = live.filter((r) => ownedBy(r, caller) && r.inventoryItemIds.some((id) => ids.includes(id)));
  if (own.length === 0) return { kind: 'new' };
  if (own.length === 1 && sameSet(own[0].inventoryItemIds, ids)) return { kind: 'reuse', reservation: own[0] };
  if (piUncancelable()) return { kind: 'payment_in_progress', order: own[0] };
  return { kind: 'supersede', superseded: own };
}

/**
 * Aplica la decisión: renueva el TTL (reuso), o libera las sustituidas y registra la nueva. Devuelve
 * la reserva vigente tras el commit. `next` es la orden nueva (para `new`/`supersede`).
 */
export function commitMockSession(
  decision: MockSessionDecision,
  next: Omit<MockReservation, 'reservedUntil'> | null,
  now = Date.now(),
): MockReservation | null {
  const state = readState();
  if (decision.kind === 'reuse') {
    const current = state.reservations.find((r) => r.orderId === decision.reservation.orderId);
    if (!current) return null;
    current.reservedUntil = mockReservedUntil(now);
    // Invitado: el reuso emite un `checkoutToken` nuevo (§4-R.3, `rotate: false`); el simulador
    // lo registra como llave vigente y el anterior deja de reclamar.
    if (next?.checkoutToken) current.checkoutToken = next.checkoutToken;
    writeState(state);
    return current;
  }
  if (decision.kind === 'supersede') {
    const gone = new Set(decision.superseded.map((r) => r.orderId));
    state.reservations = state.reservations.filter((r) => !gone.has(r.orderId));
    state.superseded.push(...gone);
  }
  if ((decision.kind === 'new' || decision.kind === 'supersede') && next) {
    const created: MockReservation = { ...next, reservedUntil: mockReservedUntil(now) };
    state.reservations.push(created);
    writeState(state);
    return created;
  }
  writeState(state);
  return null;
}

/** Tras un pago confirmado (mock), la reserva deja de ser «viva»: la orden ya no está `pending`. */
export function settleMockReservation(orderId: string): void {
  const state = readState();
  state.reservations = state.reservations.filter((r) => r.orderId !== orderId);
  writeState(state);
}
