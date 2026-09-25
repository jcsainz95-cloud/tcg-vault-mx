import { Injectable, Logger } from '@nestjs/common';
import { PreparationItemStatus, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/business.exception';
import { nullIfBlank } from '../shipments/preparation-view';
import {
  VAULT_VERB_TX_OPTIONS,
  VaultPlacementBlockReason,
  activeWithdrawalsOf,
  blockReasonOf,
  customerDrawersOf,
  lockCustomerVaultGate,
  placeableWhere,
  suggestionLocationIds,
  suggestionOf,
} from './vault-placement.rules';
import {
  PLACEMENT_VIEW_INCLUDE,
  PlacementViewRow,
  VaultPlacementDTO,
  VaultPreparationItemDTO,
  VaultPreparationStateDTO,
  byFolio,
  locationRefOf,
  marksSnapshotOf,
  operatorNamesOf,
  placementCorruptionOf,
  preparationStateOf,
  toVaultPlacementDTO,
  toVaultPreparationItem,
} from './vault-preparation.view';

/** La sesión: `placedBy/preparedBy/markedBy` salen de aquí, ⛔ nunca del cuerpo. */
export interface VaultActor {
  id: string;
  role: Role | string;
}

type Tx = Prisma.TransactionClient;

export type VaultPlacementSkipReason = VaultPlacementBlockReason | 'not_picked';
export type VaultPlacementItemResultDTO =
  | { inventoryItemId: string; folio: string; result: 'moved' | 'already_there' | 'missing' }
  | { inventoryItemId: string; folio: string; result: 'skipped'; reason: VaultPlacementSkipReason };

export type ConfirmVaultPlacementResponse =
  | {
      outcome: 'placed' | 'nothing_to_place';
      placement: VaultPlacementDTO;
      items: VaultPlacementItemResultDTO[];
    }
  | { outcome: 'already_placed'; placement: VaultPlacementDTO };

export interface PrepItemResponse {
  changed: boolean;
  item: VaultPreparationItemDTO;
  preparation: VaultPreparationStateDTO;
}

export interface PreparedResponse {
  outcome: 'prepared' | 'already_prepared';
  placement: VaultPlacementDTO;
  preparation: VaultPreparationStateDTO;
}

export interface UnprepareVaultPlacementResponse {
  outcome: 'unprepared' | 'not_prepared';
  placement: VaultPlacementDTO;
  preparation: VaultPreparationStateDTO;
}

/** Dominio del cuerpo de `PATCH …/prep-items` (clase E: DERIVADO del enum de Prisma, ⛔ lista a mano). */
const PREP_STATUS_VALUES: readonly PreparationItemStatus[] = Object.values(PreparationItemStatus);

/** Una colocación ya cargada con su vista (bajo la puerta, por el mismo `tx`). */
interface LoadedView {
  row: PlacementViewRow;
  items: VaultPreparationItemDTO[];
  names: Map<string, string | null>;
  preparation: VaultPreparationStateDTO;
}

/**
 * ⭐⭐ VaultPlacementService — los CUATRO verbos que escriben una colocación en bóveda
 * (API_CONTRACT §M4-VAULT.5 y .10): palomear (`PATCH …/prep-items/:id`), dar por preparado
 * (`POST …/prepared`), deshacerlo (`DELETE …/prepared`) y colocar (`POST …/confirm`).
 *
 * Las tres reglas que comparten, dichas una vez:
 * 1. **Puerta del cliente** (`lockCustomerVaultGate`) dentro de la transacción, ANTES de leer lo que
 *    deciden, y relectura por el mismo `tx`.
 * 2. **CAS con el estado en el `WHERE`** (`REL-B`): la garantía la da el `updateMany … count === 1`,
 *    ⛔ nunca una lectura previa — el contracargo NO toma la puerta y puede colarse.
 * 3. **Bitácora DENTRO de la transacción** (`tx.auditLog.create`), ⛔ nunca post-commit.
 * ⛔ Ninguno toca dinero, `status/ownerType/ownerUserId/ownershipStatus` de una pieza, ni llama a
 * `tryAutoPublish`; el `confirm` solo escribe `locationId` de las piezas.
 */
@Injectable()
export class VaultPlacementService {
  private readonly logger = new Logger(VaultPlacementService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ================================================================ lecturas comunes

  /** Colocación con su orden (lo mínimo para 404 / invariantes / puerta). */
  private async loadHead(db: Tx | PrismaService, placementId: string) {
    return db.vaultPlacement.findUnique({
      where: { id: placementId },
      include: {
        order: { select: { orderNumber: true, userId: true, fulfillmentMode: true } },
        location: { select: { id: true, label: true, zone: true } },
      },
    });
  }

  /** Invariantes de la orden (§M4-VAULT.5 paso 3) ⇒ `409 CONFLICT` + log `error`. Devuelve el userId. */
  private assertSane(p: {
    id: string;
    order: { userId: string | null; fulfillmentMode: 'vault' | 'direct_ship' } | null;
  }): string {
    const bad = placementCorruptionOf(p);
    if (bad) {
      this.logger.error(`Colocación corrupta: ${bad}`);
      throw BusinessException.conflict('CONFLICT', `Corrupt vault placement: ${bad}`);
    }
    return p.order!.userId as string;
  }

  /** La vista completa de una colocación (cartas, bloqueo, conteos, nombres) por el `tx` dado. */
  private async loadView(tx: Tx, placementId: string, userId: string): Promise<LoadedView> {
    const row = await tx.vaultPlacement.findUniqueOrThrow({
      where: { id: placementId },
      include: PLACEMENT_VIEW_INCLUDE,
    });
    row.items.sort(byFolio);
    const withdrawals = await activeWithdrawalsOf(
      tx,
      row.items.map((i) => i.inventoryItemId),
    );
    const items = row.items.map((pi) =>
      toVaultPreparationItem(pi, userId, withdrawals.has(pi.inventoryItemId)),
    );
    const names = await operatorNamesOf(tx, [row.preparedByUserId, row.placedByUserId]);
    return { row, items, names, preparation: preparationStateOf(row, items, names) };
  }

  /**
   * ⭐ H-2 (v1.79.3) — EL helper del `409 PLACEMENT_NOT_PENDING` de los cuatro verbos.
   * `placed` ⇒ `{status:'placed', location:{id,label,zone}}` (el cajón donde quedó, nombrable;
   * ⛔ sin `locationId`); `cancelled` ⇒ `{status:'cancelled', cancelReason}`.
   */
  private notPending(p: {
    status: string;
    cancelReason: string | null;
    location: { id: string; label: string; zone: import('@prisma/client').VaultZone } | null;
  }): BusinessException {
    const details =
      p.status === 'placed'
        ? { status: 'placed', location: p.location ? locationRefOf(p.location) : null }
        : { status: 'cancelled', cancelReason: p.cancelReason };
    return BusinessException.conflict(
      'PLACEMENT_NOT_PENDING',
      `Vault placement is ${p.status}`,
      details,
    );
  }

  private async placementDto(tx: Tx, placementId: string): Promise<VaultPlacementDTO> {
    const p = await tx.vaultPlacement.findUniqueOrThrow({
      where: { id: placementId },
      include: {
        order: { select: { orderNumber: true } },
        location: { select: { id: true, label: true, zone: true } },
      },
    });
    const names = await operatorNamesOf(tx, [p.preparedByUserId, p.placedByUserId]);
    return toVaultPlacementDTO(p, names);
  }

  private async audit(
    tx: Tx,
    actor: VaultActor,
    action: string,
    placementId: string,
    after: Record<string, unknown>,
    before?: Record<string, unknown>,
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        actorUserId: actor.id,
        actorRole: (actor.role as Role) ?? null,
        action,
        entityType: 'VaultPlacement',
        entityId: placementId,
        ...(before === undefined ? {} : { before: before as Prisma.InputJsonValue }),
        after: after as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
  }

  // ================================================================ PATCH …/prep-items/:id

  /** §M4-VAULT.10 — palomear / marcar faltante / deshacer UNA carta. */
  async markItem(
    placementId: string,
    placementItemId: string,
    body: unknown,
    actor: VaultActor,
  ): Promise<PrepItemResponse> {
    // 1. cuerpo: dominio del enum (clase E) ⇒ 400 con `allowed`.
    const status = (body as { status?: unknown } | null)?.status;
    if (typeof status !== 'string' || !(PREP_STATUS_VALUES as readonly string[]).includes(status)) {
      throw BusinessException.badRequest('VALIDATION_ERROR', 'invalid preparation status', {
        field: 'status',
        allowed: [...PREP_STATUS_VALUES],
      });
    }
    const target = status as PreparationItemStatus;
    // 2. colocación y carta DE ESTA colocación (⛔ no revelar que la carta existe en otra).
    const head = await this.loadHead(this.prisma, placementId);
    const pi = head
      ? await this.prisma.vaultPlacementItem.findUnique({ where: { id: placementItemId } })
      : null;
    if (!head || !pi || pi.placementId !== placementId) {
      throw BusinessException.notFound('NOT_FOUND', 'Vault placement item not found');
    }
    // 3. invariantes.
    const userId = this.assertSane(head);
    // 4. transacción + puerta.
    return this.prisma.$transaction(async (tx) => {
      await lockCustomerVaultGate(tx, userId);
      // 5. bajo la puerta.
      const now = await this.loadHead(tx, placementId);
      if (!now) throw BusinessException.notFound('NOT_FOUND', 'Vault placement not found');
      if (now.status !== 'pending') throw this.notPending(now);
      if (now.preparedAt !== null) {
        throw BusinessException.conflict('PREPARATION_CLOSED', 'Preparation is closed', {
          preparedAt: now.preparedAt.toISOString(),
        });
      }
      const view = await this.loadView(tx, placementId, userId);
      const current = view.items.find((i) => i.placementItemId === placementItemId)!;
      // 6. una carta bloqueada no se palomea ni se marca faltante (volver a `pending` sí).
      if (target !== 'pending' && current.placeability.kind === 'blocked') {
        throw BusinessException.conflict('PREP_ITEM_BLOCKED', 'Item cannot be placed', {
          reason: current.placeability.reason,
        });
      }
      // 7. doble toque ⇒ 200 sin escribir.
      if (current.prepStatus === target) {
        return { changed: false, item: current, preparation: view.preparation };
      }
      // 8. escribir con el valor LEÍDO en el WHERE (los CHECK exigen el sello entero o nada).
      const stamp = new Date();
      const data =
        target === 'pending'
          ? { prepStatus: target, prepMarkedAt: null, prepMarkedByUserId: null }
          : { prepStatus: target, prepMarkedAt: stamp, prepMarkedByUserId: actor.id };
      const res = await tx.vaultPlacementItem.updateMany({
        where: { id: placementItemId, prepStatus: current.prepStatus },
        data,
      });
      if (res.count !== 1) {
        // Bajo la puerta solo puede ocurrir si alguien escribió sin tomarla: se dice, no se adivina.
        throw BusinessException.conflict('CONFLICT', 'Preparation mark changed concurrently');
      }
      // 9. bitácora SOLO cuando entra o sale `missing` (el dato que un día moverá dinero).
      if (target === 'missing' || current.prepStatus === 'missing') {
        await this.audit(
          tx,
          actor,
          target === 'missing' ? 'vault_placement.item_missing' : 'vault_placement.item_missing_cleared',
          placementId,
          {
            placementItemId,
            inventoryItemId: current.inventoryItemId,
            folio: current.folio,
            orderId: view.row.orderId,
          },
        );
      }
      const after = await this.loadView(tx, placementId, userId);
      return {
        changed: true,
        item: after.items.find((i) => i.placementItemId === placementItemId)!,
        preparation: after.preparation,
      };
    }, VAULT_VERB_TX_OPTIONS);
  }

  // ================================================================ POST …/prepared

  /** §M4-VAULT.10 — dar por preparado. */
  async prepare(placementId: string, actor: VaultActor): Promise<PreparedResponse> {
    const head = await this.loadHead(this.prisma, placementId);
    if (!head) throw BusinessException.notFound('NOT_FOUND', 'Vault placement not found');
    const userId = this.assertSane(head);
    return this.prisma.$transaction(async (tx) => {
      await lockCustomerVaultGate(tx, userId);
      const answer = async (): Promise<PreparedResponse> => {
        const now = await this.loadHead(tx, placementId);
        if (!now) throw BusinessException.notFound('NOT_FOUND', 'Vault placement not found');
        if (now.status !== 'pending') throw this.notPending(now);
        if (now.preparedAt === null) {
          // No hay escritor que lo produzca tras perder el CAS: se dice, no se adivina.
          throw BusinessException.conflict('CONFLICT', 'Vault placement changed concurrently');
        }
        const view = await this.loadView(tx, placementId, userId);
        return {
          outcome: 'already_prepared',
          placement: await this.placementDto(tx, placementId),
          preparation: view.preparation,
        };
      };
      const now = await this.loadHead(tx, placementId);
      if (!now) throw BusinessException.notFound('NOT_FOUND', 'Vault placement not found');
      if (now.status !== 'pending') throw this.notPending(now);
      if (now.preparedAt !== null) return answer(); // 200 idempotente, ⛔ sin escribir ni bitácora
      // 4. conteo bajo la puerta: colocables sin marcar.
      const view = await this.loadView(tx, placementId, userId);
      if (view.preparation.pending > 0) {
        throw BusinessException.conflict('PREPARATION_INCOMPLETE', 'Preparation is incomplete', {
          pendingCount: view.preparation.pending,
        });
      }
      // 5. CAS.
      const stamp = new Date();
      const res = await tx.vaultPlacement.updateMany({
        where: { id: placementId, status: 'pending', preparedAt: null },
        data: { preparedAt: stamp, preparedByUserId: actor.id },
      });
      if (res.count !== 1) return answer(); // lo coló el contracargo ⇒ contesta por estado
      // 6. bitácora (CA #4) en la tx.
      await this.audit(tx, actor, 'vault_placement.prepared', placementId, {
        orderId: view.row.orderId,
        ...marksSnapshotOf(view.items),
      });
      const after = await this.loadView(tx, placementId, userId);
      return {
        outcome: 'prepared',
        placement: await this.placementDto(tx, placementId),
        preparation: after.preparation,
      };
    }, VAULT_VERB_TX_OPTIONS);
  }

  // ================================================================ DELETE …/prepared

  /** §M4-VAULT.10 (v1.79.2) — deshacer «preparado». Conserva las marcas por carta. */
  async unprepare(placementId: string, actor: VaultActor): Promise<UnprepareVaultPlacementResponse> {
    const head = await this.loadHead(this.prisma, placementId);
    if (!head) throw BusinessException.notFound('NOT_FOUND', 'Vault placement not found');
    const userId = this.assertSane(head);
    return this.prisma.$transaction(async (tx) => {
      await lockCustomerVaultGate(tx, userId);
      // 3. bajo la puerta, se relee (y lo mismo si el CAS pierde: contesta por estado).
      const byState = async (): Promise<UnprepareVaultPlacementResponse | null> => {
        const now = await this.loadHead(tx, placementId);
        if (!now) throw BusinessException.notFound('NOT_FOUND', 'Vault placement not found');
        if (now.status !== 'pending') throw this.notPending(now);
        if (now.preparedAt === null) {
          const view = await this.loadView(tx, placementId, userId);
          return {
            outcome: 'not_prepared',
            placement: await this.placementDto(tx, placementId),
            preparation: view.preparation,
          };
        }
        return null;
      };
      const early = await byState();
      if (early) return early;
      const before = await tx.vaultPlacement.findUniqueOrThrow({
        where: { id: placementId },
        select: { preparedAt: true, preparedByUserId: true },
      });
      // 4. CAS con el estado en el WHERE — ⛔ jamás sobre la lectura del paso 3.
      const res = await tx.vaultPlacement.updateMany({
        where: { id: placementId, status: 'pending', preparedAt: { not: null } },
        data: { preparedAt: null, preparedByUserId: null },
      });
      if (res.count !== 1) {
        const again = await byState();
        if (again) return again;
        throw BusinessException.conflict('CONFLICT', 'Vault placement changed concurrently');
      }
      // 5. las marcas se conservan (no se toca VaultPlacementItem). 6. bitácora en la tx.
      const view = await this.loadView(tx, placementId, userId);
      await this.audit(
        tx,
        actor,
        'vault_placement.unprepared',
        placementId,
        { orderId: view.row.orderId, ...marksSnapshotOf(view.items) },
        {
          preparedAt: before.preparedAt ? before.preparedAt.toISOString() : null,
          preparedByUserId: before.preparedByUserId,
        },
      );
      return {
        outcome: 'unprepared',
        placement: await this.placementDto(tx, placementId),
        preparation: view.preparation,
      };
    }, VAULT_VERB_TX_OPTIONS);
  }

  // ================================================================ POST …/confirm

  /** §M4-VAULT.5 — colocar (los 12 pasos + 6-bis de v1.79.3). */
  async confirm(
    placementId: string,
    body: unknown,
    actor: VaultActor,
  ): Promise<ConfirmVaultPlacementResponse> {
    // 1. cuerpo: `locationId` PRESENTE y no-string o en blanco ⇒ 400. Ausente o null ⇒ se decide en 6-bis.
    const raw = (body as { locationId?: unknown } | null)?.locationId;
    if (raw !== undefined && raw !== null && (typeof raw !== 'string' || raw.trim() === '')) {
      throw BusinessException.badRequest('VALIDATION_ERROR', 'invalid locationId', {
        field: 'locationId',
      });
    }
    const locationId = typeof raw === 'string' ? raw : null;

    // 2. colocación (atajo de lectura: se repite bajo la puerta).
    const head = await this.loadHead(this.prisma, placementId);
    if (!head) throw BusinessException.notFound('NOT_FOUND', 'Vault placement not found');
    if (head.status !== 'pending') {
      return this.answerConfirmByState(this.prisma, placementId, locationId);
    }
    // 3. invariantes (antes de la puerta: la puerta necesita el userId).
    const userId = this.assertSane(head);

    return this.prisma.$transaction(async (tx) => {
      // 4. puerta del cliente.
      await lockCustomerVaultGate(tx, userId);
      // 5. estado bajo la puerta.
      const now = await this.loadHead(tx, placementId);
      if (!now) throw BusinessException.notFound('NOT_FOUND', 'Vault placement not found');
      if (now.status !== 'pending') return this.answerConfirmByState(tx, placementId, locationId, userId);
      const view = await this.loadView(tx, placementId, userId);
      // 6. preparado precede a colocado (CA #21).
      if (now.preparedAt === null) {
        throw BusinessException.conflict('PLACEMENT_NOT_PREPARED', 'Vault placement is not prepared', {
          preparation: view.preparation,
        });
      }
      const stamp = new Date();
      const drawers = (await customerDrawersOf(tx, [userId])).get(userId) ?? [];
      const suggestion = suggestionOf(drawers);
      const suggestionAudit = {
        source: suggestion.source,
        locationIds: suggestionLocationIds(suggestion),
      };

      // 6-bis. ¿hay algo que guardar? (estable bajo la puerta: las marcas solo cambian sin preparar).
      const pickedCount = await tx.vaultPlacementItem.count({
        where: { placementId, prepStatus: 'picked' },
      });
      if (pickedCount === 0) {
        const res = await tx.vaultPlacement.updateMany({
          where: { id: placementId, status: 'pending', preparedAt: { not: null } },
          data: {
            status: 'cancelled',
            cancelledAt: stamp,
            cancelledByUserId: actor.id,
            cancelReason: 'nothing_to_place',
          },
        });
        if (res.count !== 1) return this.answerConfirmByState(tx, placementId, locationId, userId);
        const results = view.items.map((it) => this.unmovedResult(it));
        await this.audit(tx, actor, 'vault_placement.nothing_to_place', placementId, {
          orderId: view.row.orderId,
          locationId: null,
          requestedLocationId: locationId,
          suggestion: suggestionAudit,
          ...this.resultsAudit(results),
        });
        return {
          outcome: 'nothing_to_place',
          placement: await this.placementDto(tx, placementId),
          items: results,
        };
      }
      if (locationId === null) {
        throw BusinessException.validation('LOCATION_NOT_AVAILABLE', 'A drawer is required', {
          reason: 'location_required',
          pickedCount,
        });
      }

      // 7. el cajón (bajo la puerta, ANTES de reclamar ⇒ un 422 no escribió nada).
      const loc = await tx.vaultLocation.findUnique({ where: { id: locationId } });
      const reject = (reason: string, extra: Record<string, unknown> = {}) =>
        BusinessException.validation('LOCATION_NOT_AVAILABLE', `Drawer not available: ${reason}`, {
          reason,
          ...extra,
        });
      if (!loc) throw reject('not_found');
      if (!loc.isActive) throw reject('inactive');
      if (loc.zone !== 'customer_custody') throw reject('not_customer_custody');
      if (drawers.length > 0 && !drawers.some((d) => d.id === locationId)) {
        // H-5: el MISMO valor que customerDrawers acaba de devolver bajo la puerta (⛔ 2ª consulta).
        throw reject('not_customer_drawer', { customerDrawers: drawers });
      }

      // 8. RECLAMAR la transición (REL-B) — ⛔ jamás sobre una lectura previa.
      const claim = await tx.vaultPlacement.updateMany({
        where: { id: placementId, status: 'pending', preparedAt: { not: null } },
        data: { status: 'placed', placedAt: stamp, placedByUserId: actor.id, locationId },
      });
      if (claim.count !== 1) return this.answerConfirmByState(tx, placementId, locationId, userId);

      // 9. mover, carta por carta.
      const orderNumber = nullIfBlank(view.row.order.orderNumber) ?? view.row.orderId;
      const results: VaultPlacementItemResultDTO[] = [];
      for (const it of view.items) {
        if (it.prepStatus !== 'picked') {
          results.push(this.unmovedResult(it));
          continue;
        }
        const piece = await tx.inventoryItem.findUniqueOrThrow({
          where: { id: it.inventoryItemId },
          select: { locationId: true },
        });
        const moved = await tx.inventoryItem.updateMany({
          where: {
            id: it.inventoryItemId,
            ...placeableWhere(userId),
            // ⚠️ La trampa del NULL: `NOT: { locationId: target }` excluye `locationId = NULL`
            // (en SQL `NULL <> x` no es verdadero) ⇒ una carta sin ubicar nunca se colocaría.
            OR: [{ locationId: null }, { locationId: { not: locationId } }],
          },
          data: { locationId },
        });
        if (moved.count === 1) {
          await tx.inventoryMovement.create({
            data: {
              itemId: it.inventoryItemId,
              fromLocationId: piece.locationId,
              toLocationId: locationId,
              fromStatus: 'in_custody',
              toStatus: 'in_custody',
              reason: 'move',
              actorUserId: actor.id,
              note: `colocación en bóveda · ${orderNumber}`,
            },
          });
          results.push({ inventoryItemId: it.inventoryItemId, folio: it.folio, result: 'moved' });
          continue;
        }
        // count 0 ⇒ se relee: ¿ya estaba ahí, o ya no es colocable?
        const again = await tx.inventoryItem.findUniqueOrThrow({
          where: { id: it.inventoryItemId },
          select: { ownerType: true, ownerUserId: true, ownershipStatus: true, status: true, locationId: true },
        });
        const w = await activeWithdrawalsOf(tx, [it.inventoryItemId]);
        const reason = blockReasonOf(again, userId, w.has(it.inventoryItemId));
        if (reason === null && again.locationId === locationId) {
          results.push({ inventoryItemId: it.inventoryItemId, folio: it.folio, result: 'already_there' });
        } else {
          if (reason === null) {
            // Inalcanzable: colocable, fuera del cajón y el UPDATE no la tomó. Se dice, no se adivina.
            this.logger.error(`confirm ${placementId}: pieza ${it.inventoryItemId} colocable y no movida`);
          }
          results.push({
            inventoryItemId: it.inventoryItemId,
            folio: it.folio,
            result: 'skipped',
            reason: reason ?? 'not_in_custody',
          });
        }
      }

      // 10. nada colocado ⇒ placed → cancelled en la misma tx (se conserva el sello de preparación).
      const placedSomething = results.some((r) => r.result === 'moved' || r.result === 'already_there');
      if (!placedSomething) {
        await tx.vaultPlacement.updateMany({
          where: { id: placementId, status: 'placed' },
          data: {
            status: 'cancelled',
            placedAt: null,
            placedByUserId: null,
            locationId: null,
            cancelledAt: stamp,
            cancelledByUserId: actor.id,
            cancelReason: 'nothing_to_place',
          },
        });
      }
      // 11. bitácora (CA #22) DENTRO de la transacción.
      await this.audit(
        tx,
        actor,
        placedSomething ? 'vault_placement.placed' : 'vault_placement.nothing_to_place',
        placementId,
        {
          orderId: view.row.orderId,
          locationId,
          suggestion: suggestionAudit,
          ...this.resultsAudit(results),
        },
      );
      // 12. ⛔ sin correo ni aviso al cliente (P-B: «No»).
      return {
        outcome: placedSomething ? 'placed' : 'nothing_to_place',
        placement: await this.placementDto(tx, placementId),
        items: results,
      };
    }, VAULT_VERB_TX_OPTIONS);
  }

  /** Resultado de una carta que NO se mueve (paso 9): `missing` o `skipped` con su razón. */
  private unmovedResult(it: VaultPreparationItemDTO): VaultPlacementItemResultDTO {
    if (it.prepStatus === 'missing') {
      return { inventoryItemId: it.inventoryItemId, folio: it.folio, result: 'missing' };
    }
    return {
      inventoryItemId: it.inventoryItemId,
      folio: it.folio,
      result: 'skipped',
      reason: it.placeability.kind === 'blocked' ? it.placeability.reason : 'not_picked',
    };
  }

  private resultsAudit(results: VaultPlacementItemResultDTO[]) {
    return {
      moved: results.filter((r) => r.result === 'moved').map((r) => r.inventoryItemId),
      alreadyThere: results.filter((r) => r.result === 'already_there').map((r) => r.inventoryItemId),
      missing: results.filter((r) => r.result === 'missing').map((r) => r.inventoryItemId),
      skipped: results
        .filter((r): r is Extract<VaultPlacementItemResultDTO, { result: 'skipped' }> => r.result === 'skipped')
        .map((r) => ({ id: r.inventoryItemId, reason: r.reason })),
    };
  }

  /**
   * La tabla de respuestas del `confirm` para una colocación que NO está `pending` (pasos 2, 5 y la
   * pérdida del CAS): ya `placed` en el MISMO cajón ⇒ `200 already_placed` (⛔ sin escribir); en otro
   * cajón, o sin cajón en el cuerpo ⇒ `409 {placed, location}`; `cancelled` ⇒ `409 {cancelled, …}`.
   */
  private async answerConfirmByState(
    db: Tx | PrismaService,
    placementId: string,
    locationId: string | null,
    userId?: string,
  ): Promise<ConfirmVaultPlacementResponse> {
    const p = await this.loadHead(db, placementId);
    if (!p) throw BusinessException.notFound('NOT_FOUND', 'Vault placement not found');
    if (p.status === 'placed' && locationId !== null && p.locationId === locationId) {
      const names = await operatorNamesOf(db as Tx, [p.preparedByUserId, p.placedByUserId]);
      return { outcome: 'already_placed', placement: toVaultPlacementDTO(p, names) };
    }
    if (p.status === 'pending') {
      // Perdió el CAS contra un «deshacer preparado» (solo alcanzable sin la puerta — defensa en
      // profundidad, §M4-VAULT.10): la tabla dice `409 PLACEMENT_NOT_PREPARED`.
      if (p.preparedAt === null && userId !== undefined) {
        const view = await this.loadView(db as Tx, placementId, userId);
        throw BusinessException.conflict('PLACEMENT_NOT_PREPARED', 'Vault placement is not prepared', {
          preparation: view.preparation,
        });
      }
      // `pending` y preparada tras perder el CAS: no hay escritor que lo produzca. Se dice, no se adivina.
      throw BusinessException.conflict('CONFLICT', 'Vault placement changed concurrently');
    }
    throw this.notPending(p);
  }
}
