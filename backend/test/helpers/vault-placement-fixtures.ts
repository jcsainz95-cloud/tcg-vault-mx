/**
 * vault-placement-fixtures.ts — filas de `VaultPlacement` con la forma de `PLACEMENT_VIEW_INCLUDE`
 * (`modules/vault/vault-preparation.view.ts`) para las pruebas UNITARIAS de la cubeta `vault`
 * (API_CONTRACT §M4-VAULT.3/.10). Propiedad: backend.
 */

export type PieceOverrides = Partial<{
  id: string;
  folio: string;
  ownerType: string;
  ownerUserId: string | null;
  ownershipStatus: string | null;
  status: string;
  location: { id: string; label: string; zone: string } | null;
  cardName: string;
}>;

export function vpItem(
  o: PieceOverrides & { placementItemId?: string; prepStatus?: string; userId?: string } = {},
) {
  const inventoryItemId = o.id ?? 'inv-1';
  return {
    id: o.placementItemId ?? `vpi-${inventoryItemId}`,
    placementId: 'vp-1',
    orderItemId: `oi-${inventoryItemId}`,
    inventoryItemId,
    prepStatus: o.prepStatus ?? 'pending',
    prepMarkedAt: o.prepStatus && o.prepStatus !== 'pending' ? new Date('2026-09-25T10:00:00Z') : null,
    prepMarkedByUserId: o.prepStatus && o.prepStatus !== 'pending' ? 'op-1' : null,
    inventoryItem: {
      id: inventoryItemId,
      folio: o.folio ?? `F-${inventoryItemId}`,
      finish: 'normal',
      rawCondition: 'NM',
      sealedCondition: null,
      gradingCompany: null,
      gradeValue: null,
      ownerType: o.ownerType ?? 'customer',
      ownerUserId: o.ownerUserId === undefined ? (o.userId ?? 'u-1') : o.ownerUserId,
      ownershipStatus: o.ownershipStatus === undefined ? 'settled' : o.ownershipStatus,
      status: o.status ?? 'in_custody',
      locationId: o.location === null ? null : (o.location?.id ?? 'loc-shop'),
      location:
        o.location === undefined
          ? { id: 'loc-shop', label: 'C01-F01-S01', zone: 'platform_stock' }
          : o.location,
      card: { name: o.cardName ?? 'Pikachu', imageSmallUrl: null, set: { name: 'Base' } },
    },
  };
}

export type PlacementOverrides = Partial<{
  id: string;
  orderId: string;
  orderNumber: string | null;
  userId: string | null;
  fulfillmentMode: string;
  name: string;
  nameSource: string;
  email: string;
  status: string;
  createdAt: Date;
  preparedAt: Date | null;
  preparedByUserId: string | null;
  placedAt: Date | null;
  placedByUserId: string | null;
  location: { id: string; label: string; zone: string } | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  items: ReturnType<typeof vpItem>[];
}>;

export function vpRow(o: PlacementOverrides = {}) {
  const userId = o.userId === undefined ? 'u-1' : o.userId;
  return {
    id: o.id ?? 'vp-1',
    orderId: o.orderId ?? 'ord-v1',
    status: o.status ?? 'pending',
    createdAt: o.createdAt ?? new Date('2026-09-20T10:00:00.000Z'),
    preparedAt: o.preparedAt ?? null,
    preparedByUserId: o.preparedByUserId ?? (o.preparedAt ? 'op-1' : null),
    placedAt: o.placedAt ?? null,
    placedByUserId: o.placedByUserId ?? null,
    locationId: o.location ? o.location.id : null,
    location: o.location ?? null,
    cancelledAt: o.cancelledAt ?? null,
    cancelledByUserId: null,
    cancelReason: o.cancelReason ?? null,
    order: {
      id: o.orderId ?? 'ord-v1',
      orderNumber: o.orderNumber === undefined ? 'TCG-000900' : o.orderNumber,
      userId,
      fulfillmentMode: o.fulfillmentMode ?? 'vault',
      user:
        userId === null
          ? null
          : {
              id: userId,
              name: o.name ?? 'María de la Luz Pérez Gómez',
              nameSource: o.nameSource ?? 'user',
              email: o.email ?? 'maria@example.com',
            },
    },
    items: o.items ?? [vpItem({ userId: userId ?? undefined })],
  };
}

/** Prisma de solo lectura para la cola `vault` (las cuatro consultas de `loadVaultQueue`). */
export function vaultReadMocks(
  placements: ReturnType<typeof vpRow>[],
  opts: {
    withdrawals?: { inventoryItemId: string; shipmentRequest: { id: string; status: string } }[];
    drawerGroups?: { ownerUserId: string; locationId: string; _count: { _all: number } }[];
    locations?: { id: string; label: string; zone: string }[];
    operators?: { id: string; name: string }[];
  } = {},
) {
  return {
    vaultPlacement: { findMany: jest.fn().mockResolvedValue(placements) },
    shipmentItem: { findMany: jest.fn().mockResolvedValue(opts.withdrawals ?? []) },
    inventoryItem: { groupBy: jest.fn().mockResolvedValue(opts.drawerGroups ?? []) },
    vaultLocation: { findMany: jest.fn().mockResolvedValue(opts.locations ?? []) },
    user: { findMany: jest.fn().mockResolvedValue(opts.operators ?? []) },
  };
}
