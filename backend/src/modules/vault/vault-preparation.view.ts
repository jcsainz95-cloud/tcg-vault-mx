import {
  FulfillmentMode,
  MissingReason,
  NameSource,
  PreparationItemStatus,
  Prisma,
  VaultPlacementCancelReason,
  VaultPlacementStatus,
  VaultZone,
} from '@prisma/client';
import { customerEmailOrBlank } from '../../common/customer-email';
import {
  LocationView,
  PreparationCardDTO,
  lastNameOf,
  locationViewOf,
  nullIfBlank,
  preparationCardOf,
} from '../shipments/preparation-view';
import { customerDisplayName } from './customer-display-name';
import {
  VaultDb,
  VaultLocationSuggestion,
  VaultPlacementBlockReason,
  activeWithdrawalsOf,
  blockReasonOf,
  customerDrawersOf,
  suggestionOf,
} from './vault-placement.rules';

/**
 * vault-preparation.view.ts — la PROYECCIÓN de una colocación (API_CONTRACT §M4-VAULT.3/.5/.10):
 * la fila `vault` de «Pedidos a preparar», su estado de preparación y `VaultPlacementDTO`. Un cuerpo
 * para la cola (que vive en `shipments` y **lee**) y para las respuestas de los verbos.
 */

// ---------------------------------------------------------------- tipos del contrato

export interface VaultPreparationItemDTO {
  placementItemId: string;
  orderItemId: string;
  inventoryItemId: string;
  folio: string;
  quantity: number;
  card: PreparationCardDTO;
  currentLocation: LocationView;
  currentZone: VaultZone | null;
  prepStatus: PreparationItemStatus;
  /** ⭐ v1.80.1 (§M4-VAULT.10): ⇔ `prepStatus==='missing'` (CHECK). El MISMO enum que el palomeo de envío. */
  missingReason: MissingReason | null;
  placeability: { kind: 'placeable' } | { kind: 'blocked'; reason: VaultPlacementBlockReason };
}

export interface VaultPreparationCounts {
  total: number;
  pending: number;
  picked: number;
  missing: number;
  blocked: number;
}

export type VaultPreparationStateDTO =
  | ({ status: 'in_progress' } & VaultPreparationCounts)
  | ({
      status: 'prepared';
      preparedAt: string;
      preparedBy: { userId: string; name: string | null };
    } & VaultPreparationCounts);

export interface VaultPreparationOrderDTO {
  destination: 'vault';
  placementId: string;
  orderId: string;
  orderNumber: string | null;
  requestedAt: string;
  customer: { userId: string; email: string; lastName: string | null; fullName: string | null };
  suggestedLocation: VaultLocationSuggestion;
  preparation: VaultPreparationStateDTO;
  items: VaultPreparationItemDTO[];
}

export interface VaultPlacementDTO {
  id: string;
  orderId: string;
  orderNumber: string | null;
  status: VaultPlacementStatus;
  createdAt: string;
  preparedAt: string | null;
  preparedBy: { userId: string; name: string | null } | null;
  placedAt: string | null;
  placedBy: { userId: string; name: string | null } | null;
  location: { id: string; label: string; zone: 'customer_custody' } | null;
  cancelledAt: string | null;
  cancelReason: VaultPlacementCancelReason | null;
}

// ---------------------------------------------------------------- la carga

/** El `include` de una colocación con todo lo que su fila y sus verbos proyectan. */
export const PLACEMENT_VIEW_INCLUDE = {
  order: {
    select: {
      id: true,
      orderNumber: true,
      userId: true,
      fulfillmentMode: true,
      user: { select: { id: true, name: true, nameSource: true, email: true } },
    },
  },
  location: { select: { id: true, label: true, zone: true } },
  items: {
    include: {
      inventoryItem: { include: { card: { include: { set: true } }, location: true } },
    },
  },
} satisfies Prisma.VaultPlacementInclude;

export type PlacementViewRow = Prisma.VaultPlacementGetPayload<{
  include: typeof PLACEMENT_VIEW_INCLUDE;
}>;
export type PlacementViewItem = PlacementViewRow['items'][number];

/** Nombres de OPERADORES (preparó/colocó/marcó): `nullIfBlank(User.name)`, ⛔ no la regla de cliente. */
export async function operatorNamesOf(
  db: Pick<VaultDb, 'user'>,
  ids: (string | null | undefined)[],
): Promise<Map<string, string | null>> {
  const uniq = [...new Set(ids.filter((x): x is string => !!x))];
  const out = new Map<string, string | null>();
  if (uniq.length === 0) return out;
  const users = await db.user.findMany({ where: { id: { in: uniq } }, select: { id: true, name: true } });
  for (const u of users) out.set(u.id, nullIfBlank(u.name));
  return out;
}

// ---------------------------------------------------------------- proyección

/** Una carta de la fila `vault`. `orderUserId` es el dueño esperado (`P`). */
export function toVaultPreparationItem(
  pi: PlacementViewItem,
  orderUserId: string,
  inActiveWithdrawal: boolean,
): VaultPreparationItemDTO {
  const piece = pi.inventoryItem;
  const reason = blockReasonOf(piece, orderUserId, inActiveWithdrawal);
  const currentLocation = locationViewOf(piece.location);
  return {
    placementItemId: pi.id,
    orderItemId: pi.orderItemId,
    inventoryItemId: pi.inventoryItemId,
    folio: piece.folio,
    quantity: 1,
    card: preparationCardOf(piece),
    currentLocation,
    // `null` ⇔ `currentLocation` 'unassigned' (mismo colapso de etiqueta en blanco).
    currentZone: currentLocation.kind === 'unassigned' ? null : piece.location!.zone,
    prepStatus: pi.prepStatus,
    missingReason: pi.missingReason,
    placeability: reason === null ? { kind: 'placeable' } : { kind: 'blocked', reason },
  };
}

/**
 * ⭐ Los conteos de preparación (§M4-VAULT.3/.10) — una partición de `items[]` (suman `total`):
 * `picked`/`missing` por su marca; `pending` = colocable sin marcar; `blocked` = bloqueada sin marcar.
 * ⇒ «se puede dar por preparado» ⇔ `pending === 0` (la MISMA regla que el verbo).
 */
export function preparationCountsOf(items: VaultPreparationItemDTO[]): VaultPreparationCounts {
  const c: VaultPreparationCounts = { total: items.length, pending: 0, picked: 0, missing: 0, blocked: 0 };
  for (const it of items) {
    if (it.prepStatus === 'picked') c.picked += 1;
    else if (it.prepStatus === 'missing') c.missing += 1;
    else if (it.placeability.kind === 'blocked') c.blocked += 1;
    else c.pending += 1;
  }
  return c;
}

export function preparationStateOf(
  placement: { preparedAt: Date | null; preparedByUserId: string | null },
  items: VaultPreparationItemDTO[],
  names: Map<string, string | null>,
): VaultPreparationStateDTO {
  const counts = preparationCountsOf(items);
  if (placement.preparedAt === null || placement.preparedByUserId === null) {
    return { status: 'in_progress', ...counts };
  }
  return {
    status: 'prepared',
    preparedAt: placement.preparedAt.toISOString(),
    preparedBy: {
      userId: placement.preparedByUserId,
      name: names.get(placement.preparedByUserId) ?? null,
    },
    ...counts,
  };
}

/** Lo que el bitácora de `prepared`/`unprepared` guarda: las marcas que quedan (ids de pieza). */
export function marksSnapshotOf(items: VaultPreparationItemDTO[]) {
  return {
    picked: items.filter((i) => i.prepStatus === 'picked').map((i) => i.inventoryItemId),
    missing: items.filter((i) => i.prepStatus === 'missing').map((i) => i.inventoryItemId),
    blocked: items
      .filter((i) => i.prepStatus === 'pending' && i.placeability.kind === 'blocked')
      .map((i) => ({
        id: i.inventoryItemId,
        reason: (i.placeability as { kind: 'blocked'; reason: VaultPlacementBlockReason }).reason,
      })),
  };
}

export function toVaultPlacementDTO(
  p: {
    id: string;
    orderId: string;
    status: VaultPlacementStatus;
    createdAt: Date;
    preparedAt: Date | null;
    preparedByUserId: string | null;
    placedAt: Date | null;
    placedByUserId: string | null;
    cancelledAt: Date | null;
    cancelReason: VaultPlacementCancelReason | null;
    order: { orderNumber: string | null };
    location: { id: string; label: string; zone: VaultZone } | null;
  },
  names: Map<string, string | null>,
): VaultPlacementDTO {
  return {
    id: p.id,
    orderId: p.orderId,
    orderNumber: nullIfBlank(p.order.orderNumber),
    status: p.status,
    createdAt: p.createdAt.toISOString(),
    preparedAt: p.preparedAt ? p.preparedAt.toISOString() : null,
    preparedBy: p.preparedByUserId
      ? { userId: p.preparedByUserId, name: names.get(p.preparedByUserId) ?? null }
      : null,
    placedAt: p.placedAt ? p.placedAt.toISOString() : null,
    placedBy: p.placedByUserId
      ? { userId: p.placedByUserId, name: names.get(p.placedByUserId) ?? null }
      : null,
    location: p.location ? locationRefOf(p.location) : null,
    cancelledAt: p.cancelledAt ? p.cancelledAt.toISOString() : null,
    cancelReason: p.cancelReason,
  };
}

/** `{id,label,zone}` de un cajón — la forma de `VaultPlacementDTO.location` y del `409 {placed}`. */
export function locationRefOf(l: { id: string; label: string; zone: VaultZone }) {
  return { id: l.id, label: l.label, zone: l.zone as 'customer_custody' };
}

/**
 * ⭐ Invariantes de la fila `vault` (§M4-VAULT.3): `Order.fulfillmentMode === 'vault'` ∧ `userId`
 * presente. `null` ⇔ sana; si no, la descripción para el `409 CONFLICT` (⛔ nunca degradar por fila).
 */
export function placementCorruptionOf(p: {
  id: string;
  order: { userId: string | null; fulfillmentMode: FulfillmentMode } | null;
}): string | null {
  if (!p.order) return `VaultPlacement ${p.id} sin orden`;
  if (p.order.fulfillmentMode !== 'vault' || p.order.userId === null) {
    return (
      `VaultPlacement ${p.id}: su orden es fulfillmentMode='${p.order.fulfillmentMode}' con ` +
      `userId=${p.order.userId === null ? 'null' : 'presente'} — combinación imposible por invariante`
    );
  }
  return null;
}

/** Orden de las cartas de un pedido para los resultados (folio en unidades de código). */
export function byFolio<T extends { inventoryItem: { folio: string } }>(a: T, b: T): number {
  const x = a.inventoryItem.folio;
  const y = b.inventoryItem.folio;
  return x < y ? -1 : x > y ? 1 : 0;
}

// ---------------------------------------------------------------- la cubeta `vault` de la cola

/**
 * ⭐⭐ La fuente `vault` de «Pedidos a preparar» (§M4-VAULT.3): `VaultPlacement{status:'pending'}`.
 * Carga SIN N+1: una consulta de colocaciones (con orden/cliente/cartas/piezas/ubicación), una de
 * retiros activos para las piezas en juego, `customerDrawers` en lote por cliente y una de nombres de
 * operador. Una fila corrupta ⇒ **lanza** (lo traduce el llamador a `409 CONFLICT` de la cola entera).
 * Las cartas salen SIN ordenar: las ordena la cola con su comparador de §M4P-ORDER.
 */
export async function loadVaultQueue(
  db: Pick<VaultDb, 'inventoryItem' | 'vaultLocation' | 'shipmentItem' | 'user'> & {
    vaultPlacement: Pick<Prisma.TransactionClient['vaultPlacement'], 'findMany'>;
  },
  day: { gte: Date; lt: Date } | undefined,
): Promise<{ rows: VaultPreparationOrderDTO[]; corruption: string | null }> {
  const placements = await db.vaultPlacement.findMany({
    where: { status: 'pending', ...(day ? { createdAt: day } : {}) },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    include: PLACEMENT_VIEW_INCLUDE,
  });
  if (placements.length === 0) return { rows: [], corruption: null };
  for (const p of placements) {
    const bad = placementCorruptionOf(p);
    if (bad) return { rows: [], corruption: bad };
  }
  const pieceIds = placements.flatMap((p) => p.items.map((i) => i.inventoryItemId));
  const withdrawals = await activeWithdrawalsOf(db, pieceIds);
  const drawers = await customerDrawersOf(
    db,
    placements.map((p) => p.order.userId as string),
  );
  const names = await operatorNamesOf(
    db,
    placements.map((p) => p.preparedByUserId),
  );
  const rows = placements.map((p) =>
    toVaultPreparationOrder(p, drawers.get(p.order.userId as string) ?? [], withdrawals, names),
  );
  return { rows, corruption: null };
}

/** Proyecta UNA colocación sana a su fila `vault`. */
export function toVaultPreparationOrder(
  p: PlacementViewRow,
  drawers: Parameters<typeof suggestionOf>[0],
  withdrawals: Map<string, unknown>,
  names: Map<string, string | null>,
): VaultPreparationOrderDTO {
  const userId = p.order.userId as string;
  const user = p.order.user as { id: string; name: string; nameSource: NameSource; email: string | null };
  const items = p.items.map((pi) =>
    toVaultPreparationItem(pi, userId, withdrawals.has(pi.inventoryItemId)),
  );
  // v1.79.2 — titular = nombre ENTERO; un nombre fabricado del correo sale `null` (H-1: la función).
  const fullName = customerDisplayName(user);
  return {
    destination: 'vault',
    placementId: p.id,
    orderId: p.orderId,
    orderNumber: nullIfBlank(p.order.orderNumber),
    requestedAt: p.createdAt.toISOString(),
    // v1.80.9 (I-STF-1): el titular de una colocación es cliente ⇒ con correo; `null` ⇒ log + `""`.
    customer: { userId, email: customerEmailOrBlank(user.email, 'VaultPreparationOrder.customer', userId), lastName: lastNameOf(fullName), fullName },
    suggestedLocation: suggestionOf(drawers),
    preparation: preparationStateOf(p, items, names),
    items,
  };
}
