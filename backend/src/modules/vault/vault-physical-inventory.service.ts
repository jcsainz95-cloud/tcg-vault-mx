import { Injectable } from '@nestjs/common';
import { MissingReason, PreparationItemStatus, ReplacementCaseSource, VaultZone } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/business.exception';
import {
  LocationView,
  PreparationCardDTO,
  locationViewOf,
  nullIfBlank,
  preparationCardOf,
} from '../shipments/preparation-view';
import { customerDisplayName } from './customer-display-name';
import {
  CustomerDrawerRef,
  activeWithdrawalsOf,
  codeUnits,
  customerCustodyWhere,
  customerDrawersOf,
} from './vault-placement.rules';
import { operatorNamesOf } from './vault-preparation.view';

export type PhysicalState =
  | { state: 'in_drawer'; drawer: { id: string; label: string; zone: 'customer_custody' } }
  | { state: 'pending_placement'; placementId: string; prepStatus: PreparationItemStatus; prepared: boolean }
  | { state: 'missing'; placementId: string; markedAt: string; markedBy: { userId: string; name: string | null } }
  | { state: 'in_withdrawal'; shipmentId: string; shipmentStatus: 'picking' | 'guia' | 'enviado' }
  | { state: 'unlocated'; reason: 'no_location' | 'not_in_customer_drawer' }
  // ⭐ v1.80.1 (§M4-SHIP.15.8): pieza del cliente con caso «Por reponer» ABIERTO (está `lost|damaged`, NO en el cajón).
  | { state: 'to_replace'; caseId: string; reason: MissingReason; source: ReplacementCaseSource; openedAt: string };

export interface PhysicalInventoryItemDTO {
  inventoryItemId: string;
  folio: string;
  card: PreparationCardDTO;
  currentLocation: LocationView;
  currentZone: VaultZone | null;
  origin: { placementId: string; orderId: string; orderNumber: string | null } | null;
  physical: PhysicalState;
}

export interface CustomerPhysicalInventoryDTO {
  owner: { userId: string; name: string | null; email: string };
  drawer:
    | { kind: 'none' }
    | { kind: 'single'; location: CustomerDrawerRef }
    | { kind: 'multiple'; locations: CustomerDrawerRef[] };
  counts: {
    total: number;
    inDrawer: number;
    pendingPlacement: number;
    missing: number;
    inWithdrawal: number;
    unlocated: number;
    /** ⭐ v1.80.1: casos «Por reponer» abiertos del cliente. ⛔ NO entra en `total` (esa carta es justo la que NO está). */
    toReplace: number;
  };
  items: PhysicalInventoryItemDTO[];
}

/** Rango de orden de §M4-VAULT.11: anomalías primero (missing, unlocated), luego in_drawer, pending, withdrawal. */
const STATE_RANK: Record<PhysicalState['state'], number> = {
  // ⭐ v1.80.1: «por reponer» va PRIMERO (antes que `missing`): la anomalía con dueño y trabajo pendiente.
  to_replace: -1,
  missing: 0,
  unlocated: 1,
  in_drawer: 2,
  pending_placement: 3,
  in_withdrawal: 4,
};

/**
 * ⭐ `GET /admin/vaults/:userId/physical-inventory` — API_CONTRACT §M4-VAULT.11 (v1.79.1).
 *
 * *«El cliente X, su cajón Y, y estas cartas deben estar ahí»*: el conjunto es el de
 * `customerCustodyWhere` (el MISMO que alimenta la propuesta de cajón) y cada carta sale con su estado
 * físico por `physicalStateOf` (gana la PRIMERA regla que aplica). ⛔ Sin precios. ⛔ Lectura pura.
 * Carga sin N+1: piezas (con carta y ubicación) · marcas por pieza · retiros activos · `customerDrawers`
 * · nombres de quien marcó faltante.
 */
@Injectable()
export class VaultPhysicalInventoryService {
  constructor(private readonly prisma: PrismaService) {}

  async forCustomer(userId: string): Promise<CustomerPhysicalInventoryDTO> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, nameSource: true, email: true },
    });
    if (!user) throw BusinessException.notFound('NOT_FOUND', 'User not found');

    const pieces = await this.prisma.inventoryItem.findMany({
      where: customerCustodyWhere(userId),
      include: { card: { include: { set: true } }, location: true },
    });
    const ids = pieces.map((p) => p.id);
    // ⭐ v1.80.1 (§M4-VAULT.11): las piezas `lost|damaged` del cliente con caso ABIERTO — una consulta más.
    const openCases = await this.prisma.replacementCase.findMany({
      where: { customerUserId: userId, status: 'open', originalInventoryItem: { ownerType: 'customer', ownerUserId: userId, status: { in: ['lost', 'damaged'] } } },
      include: { originalInventoryItem: { include: { card: { include: { set: true } }, location: true } } },
    });
    const marks = ids.length
      ? await this.prisma.vaultPlacementItem.findMany({
          where: { inventoryItemId: { in: ids } },
          include: {
            placement: {
              select: {
                id: true,
                status: true,
                createdAt: true,
                preparedAt: true,
                orderId: true,
                order: { select: { orderNumber: true } },
              },
            },
          },
        })
      : [];
    // La marca MÁS RECIENTE de cada pieza: por `VaultPlacement.createdAt` desc, desempate `id` desc.
    const latest = new Map<string, (typeof marks)[number]>();
    for (const m of marks) {
      const cur = latest.get(m.inventoryItemId);
      if (
        !cur ||
        m.placement.createdAt > cur.placement.createdAt ||
        (m.placement.createdAt.getTime() === cur.placement.createdAt.getTime() &&
          codeUnits(m.placement.id, cur.placement.id) > 0)
      ) {
        latest.set(m.inventoryItemId, m);
      }
    }
    const withdrawals = await activeWithdrawalsOf(this.prisma, ids);
    const drawers = (await customerDrawersOf(this.prisma, [userId])).get(userId) ?? [];
    const markers = await operatorNamesOf(
      this.prisma,
      [...latest.values()].filter((m) => m.prepStatus === 'missing').map((m) => m.prepMarkedByUserId),
    );

    const toReplaceItems: (PhysicalInventoryItemDTO & { _placementCreatedAt: number | null })[] = openCases.map((c) => {
      const p = c.originalInventoryItem;
      const mark = latest.get(p.id);
      const currentLocation = locationViewOf(p.location);
      return {
        inventoryItemId: p.id,
        folio: p.folio,
        card: preparationCardOf(p),
        currentLocation,
        currentZone: currentLocation.kind === 'unassigned' ? null : p.location!.zone,
        origin: mark
          ? { placementId: mark.placement.id, orderId: mark.placement.orderId, orderNumber: nullIfBlank(mark.placement.order.orderNumber) }
          : null,
        physical: { state: 'to_replace', caseId: c.id, reason: c.missingReason, source: c.source, openedAt: c.openedAt.toISOString() },
        _placementCreatedAt: null,
      };
    });
    const items: (PhysicalInventoryItemDTO & { _placementCreatedAt: number | null })[] = pieces.map((p) => {
      const mark = latest.get(p.id);
      const currentLocation = locationViewOf(p.location);
      return {
        inventoryItemId: p.id,
        folio: p.folio,
        card: preparationCardOf(p),
        currentLocation,
        currentZone: currentLocation.kind === 'unassigned' ? null : p.location!.zone,
        origin: mark
          ? {
              placementId: mark.placement.id,
              orderId: mark.placement.orderId,
              orderNumber: nullIfBlank(mark.placement.order.orderNumber),
            }
          : null,
        physical: physicalStateOf(p, mark, withdrawals.get(p.id), markers),
        _placementCreatedAt: mark ? mark.placement.createdAt.getTime() : null,
      };
    });

    items.push(...toReplaceItems);
    items.sort((a, b) => {
      const r = STATE_RANK[a.physical.state] - STATE_RANK[b.physical.state];
      if (r !== 0) return r;
      if (a.physical.state === 'in_drawer' && b.physical.state === 'in_drawer') {
        const d = codeUnits(a.physical.drawer.label, b.physical.drawer.label);
        if (d !== 0) return d;
      }
      if (a.physical.state === 'pending_placement' && b.physical.state === 'pending_placement') {
        const t = (a._placementCreatedAt ?? 0) - (b._placementCreatedAt ?? 0);
        if (t !== 0) return t;
      }
      return codeUnits(a.card.name, b.card.name) || codeUnits(a.folio, b.folio);
    });

    const counts = { total: pieces.length, inDrawer: 0, pendingPlacement: 0, missing: 0, inWithdrawal: 0, unlocated: 0, toReplace: 0 };
    for (const it of items) {
      if (it.physical.state === 'to_replace') counts.toReplace += 1;
      else if (it.physical.state === 'in_drawer') counts.inDrawer += 1;
      else if (it.physical.state === 'pending_placement') counts.pendingPlacement += 1;
      else if (it.physical.state === 'missing') counts.missing += 1;
      else if (it.physical.state === 'in_withdrawal') counts.inWithdrawal += 1;
      else counts.unlocated += 1;
    }

    return {
      owner: { userId: user.id, name: customerDisplayName(user), email: user.email },
      drawer:
        drawers.length === 0
          ? { kind: 'none' }
          : drawers.length === 1
            ? { kind: 'single', location: drawers[0] }
            : { kind: 'multiple', locations: drawers },
      counts,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      items: items.map(({ _placementCreatedAt, ...rest }) => rest),
    };
  }
}

/**
 * ⭐ `physicalStateOf` — UNA función; gana la PRIMERA regla que aplica (§M4-VAULT.11):
 * 1. `missing` (su marca más reciente lo dice: si el operador dijo que no está, nada lo desmiente)
 * 2. `in_withdrawal` (retiro cobrado: `picking|guia|enviado`; `solicitado` no cuenta)
 * 3. `pending_placement` (su marca más reciente es de una colocación `pending`)
 * 4. `in_drawer` (`zone = customer_custody`)
 * 5. `unlocated` — sin ubicación ⇒ `no_location`; en `platform_stock` ⇒ `not_in_customer_drawer`.
 */
export function physicalStateOf(
  piece: { location: { id: string; label: string; zone: VaultZone } | null },
  mark:
    | {
        prepStatus: PreparationItemStatus;
        prepMarkedAt: Date | null;
        prepMarkedByUserId: string | null;
        placement: { id: string; status: string; preparedAt: Date | null };
      }
    | undefined,
  withdrawal: { shipmentId: string; status: 'picking' | 'guia' | 'enviado' } | undefined,
  markers: Map<string, string | null>,
): PhysicalState {
  if (mark && mark.prepStatus === 'missing') {
    const by = mark.prepMarkedByUserId as string;
    return {
      state: 'missing',
      placementId: mark.placement.id,
      markedAt: (mark.prepMarkedAt as Date).toISOString(),
      markedBy: { userId: by, name: markers.get(by) ?? null },
    };
  }
  if (withdrawal) {
    return { state: 'in_withdrawal', shipmentId: withdrawal.shipmentId, shipmentStatus: withdrawal.status };
  }
  if (mark && mark.placement.status === 'pending') {
    return {
      state: 'pending_placement',
      placementId: mark.placement.id,
      prepStatus: mark.prepStatus,
      prepared: mark.placement.preparedAt !== null,
    };
  }
  if (piece.location && piece.location.zone === 'customer_custody') {
    return {
      state: 'in_drawer',
      drawer: { id: piece.location.id, label: piece.location.label, zone: 'customer_custody' },
    };
  }
  return {
    state: 'unlocated',
    reason: piece.location === null ? 'no_location' : 'not_in_customer_drawer',
  };
}
