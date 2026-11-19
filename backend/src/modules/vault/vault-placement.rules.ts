import { Prisma, ShipmentStatus, VaultZone } from '@prisma/client';
import { nullIfBlank } from '../shipments/preparation-view';

/**
 * vault-placement.rules.ts — las reglas de la COLOCACIÓN en bóveda que comparten la cola, los cuatro
 * verbos y la vista física (API_CONTRACT §M4-VAULT.4/.5/.10/.11). **Un cuerpo por regla**: el
 * predicado `P` de «pieza colocable», la razón de bloqueo, `customerDrawers` y la puerta del cliente.
 * Sin estado y sin Nest: lo importan `shipments` (la cola **lee**) y los servicios de `vault`.
 */

// ---------------------------------------------------------------- la puerta del cliente

/**
 * Espacio de claves del advisory lock de la PUERTA DEL CLIENTE de bóveda (§M4-VAULT.5 paso 4).
 * ⚠️ **Distinto** de `RESERVATION_GATE_NAMESPACE` (63_120_959): con el mismo, una reserva y una
 * colocación del mismo cliente se serializarían sin motivo. Dos enteros: namespace + `hashtext(userId)`.
 */
export const VAULT_GATE_NAMESPACE = 79_125_059;

export interface VaultGateLocker {
  $executeRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
}

/**
 * ⭐⭐ Toma la puerta del cliente **dentro de la transacción** (se suelta al commit/rollback). Misma
 * ceremonia que `orders/reservation.ts` · `lockReservationGate`. La toman los CUATRO verbos que
 * escriben (`PATCH …/prep-items`, `POST …/prepared`, `DELETE …/prepared`, `confirm`) **antes** de leer
 * lo que deciden. *Por qué por cliente:* «un cliente = un cajón» es del cliente, no de un pedido; y
 * «preparar» decide sobre N cartas que «palomear» escribe de una en una (write skew sin puerta común).
 */
export async function lockCustomerVaultGate(tx: VaultGateLocker, userId: string): Promise<void> {
  // `::int` explícito: Prisma vincula un `number` como `bigint`, y la firma de dos claves es (int4, int4).
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${VAULT_GATE_NAMESPACE}::int, hashtext(${userId}))`;
}

/** Opciones de la transacción de los verbos (la puerta puede hacer esperar a otro verbo del cliente). */
export const VAULT_VERB_TX_OPTIONS = { maxWait: 10_000, timeout: 30_000 } as const;

// ---------------------------------------------------------------- el predicado P

/** Envíos que BLOQUEAN una carta: un retiro ya COBRADO (`solicitado` no bloquea, §M4-VAULT.5). */
export const ACTIVE_WITHDRAWAL_STATUSES: readonly ShipmentStatus[] = ['picking', 'guia', 'enviado'];

/** Tipo de DTO (clase L, computado): por qué una carta no se puede colocar. */
export type VaultPlacementBlockReason = 'in_withdrawal' | 'not_in_custody';

/**
 * «Del cliente, en custodia»: la mitad de `P` que vive en la pieza — y **el mismo conjunto** que
 * alimenta `customerDrawers` y la vista física («qué cartas deben estar en bóveda»).
 */
export function customerCustodyWhere(userId: string): Prisma.InventoryItemWhereInput {
  return {
    ownerType: 'customer',
    ownerUserId: userId,
    ownershipStatus: 'settled',
    status: 'in_custody',
  };
}

/**
 * ⭐ El predicado `P` de §M4-VAULT.5 como `where` de Prisma — el que usa la ESCRITURA del `confirm`
 * (`updateMany`). La pertenencia a la colocación la da el bucle sobre `VaultPlacementItem`.
 */
export function placeableWhere(userId: string): Prisma.InventoryItemWhereInput {
  return {
    ...customerCustodyWhere(userId),
    shipmentItems: {
      none: { shipmentRequest: { status: { in: [...ACTIVE_WITHDRAWAL_STATUSES] } } },
    },
  };
}

/** Lo que `blockReasonOf` lee de la pieza. */
export type CustodyFields = {
  ownerType: string;
  ownerUserId: string | null;
  ownershipStatus: string | null;
  status: string;
};

/**
 * ⭐ El predicado `P` en LECTURA — **el mismo cuerpo** que `placeableWhere`, sobre la fila ya leída.
 * `null` ⇔ colocable. Si no: `in_withdrawal` si la pieza está en un retiro cobrado; `not_in_custody`
 * en cualquier otro caso (contracargo, entregada, perdida, dañada, anomalía de settle).
 */
export function blockReasonOf(
  piece: CustodyFields,
  orderUserId: string,
  inActiveWithdrawal: boolean,
): VaultPlacementBlockReason | null {
  const custody =
    piece.ownerType === 'customer' &&
    piece.ownerUserId === orderUserId &&
    piece.ownershipStatus === 'settled' &&
    piece.status === 'in_custody';
  if (custody && !inActiveWithdrawal) return null;
  return inActiveWithdrawal ? 'in_withdrawal' : 'not_in_custody';
}

/** Lo mínimo que las lecturas de abajo necesitan: el cliente Prisma o el de una transacción. */
export type VaultDb = Pick<
  Prisma.TransactionClient,
  'inventoryItem' | 'vaultLocation' | 'shipmentItem' | 'user'
>;

/**
 * Los retiros ACTIVOS (`picking|guia|enviado`) de un lote de piezas — UNA consulta (sin N+1).
 * `Map<inventoryItemId, {shipmentId, status}>`; con varios, gana el primero por `shipmentId` (orden
 * total, sin depender del motor). Una pieza no puede estar en dos retiros activos (anti-doble-retiro).
 */
export async function activeWithdrawalsOf(
  db: Pick<VaultDb, 'shipmentItem'>,
  inventoryItemIds: string[],
): Promise<Map<string, { shipmentId: string; status: 'picking' | 'guia' | 'enviado' }>> {
  const out = new Map<string, { shipmentId: string; status: 'picking' | 'guia' | 'enviado' }>();
  if (inventoryItemIds.length === 0) return out;
  const rows = await db.shipmentItem.findMany({
    where: {
      inventoryItemId: { in: inventoryItemIds },
      shipmentRequest: { status: { in: [...ACTIVE_WITHDRAWAL_STATUSES] } },
    },
    select: { inventoryItemId: true, shipmentRequest: { select: { id: true, status: true } } },
  });
  rows.sort((a, b) => codeUnits(a.shipmentRequest.id, b.shipmentRequest.id));
  for (const r of rows) {
    if (out.has(r.inventoryItemId)) continue;
    out.set(r.inventoryItemId, {
      shipmentId: r.shipmentRequest.id,
      status: r.shipmentRequest.status as 'picking' | 'guia' | 'enviado',
    });
  }
  return out;
}

// ---------------------------------------------------------------- customerDrawers (§M4-VAULT.4)

export interface CustomerDrawerRef {
  id: string;
  label: string;
  zone: 'customer_custody';
  /** Cuántas piezas de ESTE cliente hay HOY en ese cajón. */
  customerPieceCount: number;
}

export type VaultLocationSuggestion =
  | { source: 'existing_customer_vault'; location: CustomerDrawerRef }
  | { source: 'multiple_drawers'; locations: CustomerDrawerRef[] }
  | { source: 'none' };

/** §M4P-ORDER: comparación por unidades de código UTF-16 (⛔ `localeCompare`). */
export function codeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Orden de los cajones: `label` en unidades de código, desempate `id`. ⛔ Nunca por nº de piezas. */
export function compareDrawers(a: CustomerDrawerRef, b: CustomerDrawerRef): number {
  return codeUnits(a.label, b.label) || codeUnits(a.id, b.id);
}

/**
 * ⭐⭐ `customerDrawers` — LA función (cola, `confirm` y vista física), en lote por cliente.
 *
 * Cajones del cliente = `VaultLocation` con ≥1 pieza suya en custodia (`customerCustodyWhere`) **y**
 * `zone='customer_custody'`. ⚠️ El filtro de zona es PORTANTE: las piezas pendientes de colocar
 * también son `in_custody` y siguen en el estante de tienda — sin él, se propondría el estante de
 * donde hay que sacarlas. ⭐ v1.79.1: `isActive` **no** filtra (un cajón es del cliente porque ahí
 * están sus cartas). Una `label` en blanco no cuenta (regla 5). Dos consultas, sin N+1.
 */
export async function customerDrawersOf(
  db: Pick<VaultDb, 'inventoryItem' | 'vaultLocation'>,
  userIds: string[],
): Promise<Map<string, CustomerDrawerRef[]>> {
  const out = new Map<string, CustomerDrawerRef[]>();
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return out;
  const groups = await db.inventoryItem.groupBy({
    by: ['ownerUserId', 'locationId'],
    where: {
      ownerType: 'customer',
      ownerUserId: { in: ids },
      ownershipStatus: 'settled',
      status: 'in_custody',
      location: { zone: VaultZone.customer_custody },
    },
    _count: { _all: true },
  });
  const locIds = [...new Set(groups.map((g) => g.locationId).filter((x): x is string => !!x))];
  const locs = locIds.length
    ? await db.vaultLocation.findMany({
        where: { id: { in: locIds } },
        select: { id: true, label: true, zone: true },
      })
    : [];
  const locById = new Map(locs.map((l) => [l.id, l]));
  for (const g of groups) {
    if (!g.ownerUserId || !g.locationId) continue;
    const loc = locById.get(g.locationId);
    // Defensa: la zona ya la filtró el `where`; una etiqueta en blanco no cuenta (regla 5).
    if (!loc || loc.zone !== VaultZone.customer_custody || nullIfBlank(loc.label) === null) continue;
    const list = out.get(g.ownerUserId) ?? [];
    list.push({
      id: loc.id,
      label: loc.label,
      zone: 'customer_custody',
      customerPieceCount: g._count._all,
    });
    out.set(g.ownerUserId, list);
  }
  for (const list of out.values()) list.sort(compareDrawers);
  return out;
}

/** La sugerencia de la fila (§M4-VAULT.4): 0 ⇒ `none`, 1 ⇒ su cajón, ≥2 ⇒ anomalía SIN propuesta. */
export function suggestionOf(drawers: CustomerDrawerRef[]): VaultLocationSuggestion {
  if (drawers.length === 0) return { source: 'none' };
  if (drawers.length === 1) return { source: 'existing_customer_vault', location: drawers[0] };
  return { source: 'multiple_drawers', locations: drawers };
}

/** Ids de cajón que la sugerencia nombra (para la bitácora del `confirm`, paso 11). */
export function suggestionLocationIds(s: VaultLocationSuggestion): string[] {
  if (s.source === 'none') return [];
  if (s.source === 'existing_customer_vault') return [s.location.id];
  return s.locations.map((l) => l.id);
}
