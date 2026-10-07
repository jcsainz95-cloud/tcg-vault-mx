/**
 * admin-accessories.service.ts — panel `/admin/accessories` (API_CONTRACT §AC.11; operador+ salvo ★ = súper-admin).
 *
 * Reglas que viven aquí (las de forma, en `accessory-input.ts`):
 *  - ★ `priceCents`, `unitCostCents`, `suggested` (y `active` en el alta) mandados por un operador ⇒ `403 FORBIDDEN_FIELD
 *    {fields}` ANTES de tocar la BD. El alta nace **inactiva** siempre (un `active` del súper-admin se ignora: activar
 *    es su propio verbo, con su `422`).
 *  - Toda escritura: fila bloqueada (`FOR UPDATE`) + cambio + bitácora en la MISMA transacción.
 *  - `PATCH` de un ACTIVO: cruzar energía ↔ otra categoría ⇒ `409 ACCESSORY_ACTIVE`; dejarlo sin algo que la activación
 *    exige ⇒ `422 ACCESSORY_NOT_ACTIVATABLE {missing}` (red antes del CHECK `accessory_active_ready`; BACKEND_NOTES §83.A);
 *    otro activo del mismo tipo ⇒ `409 ENERGY_TYPE_TAKEN`.
 *  - Existencias: `receive` suma; `adjust` es CAS `WHERE stockQty = expected AND reservedQty <= new` (⛔ leer y luego
 *    escribir); cada acto escribe `AccessoryStockMovement` con actor, antes y después, y bitácora (criterio 721).
 *  - Borrar: con renglón o componente de paquete que lo nombre ⇒ `409 ACCESSORY_HAS_SALES`. Si no, se borran sus
 *    movimientos (FK Restrict) y la foto (cascada) con el accesorio; la bitácora `accessory.deleted` guarda la fila.
 *  - Foto: se procesa FUERA de la transacción (CPU); la fila de foto, la versión y la bitácora, DENTRO.
 *  - Bitácora `accessory.updated {before, after}` solo de campos que cambian; ⛔ `unitCostCents` nunca en `before` y en
 *    `after` solo si el actor es ★ (§AC.11).
 */
import { Injectable, Logger } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BusinessException } from '../../common/business.exception';
import { AccessoryRow, ACCESSORY_ROW_SELECT, AdminAccessoryDTO, toAdminDTO } from './accessory-dto';
import {
  AccessoryFields,
  assertCoherent,
  FIELD_ORDER,
  isUuid,
  parseAccessoryFields,
  parseAdminQuery,
  parseStockBody,
  STAR_FIELDS_CREATE,
  STAR_FIELDS_PATCH,
  starFieldsIn,
} from './accessory-input';
import { activationMissing } from './activation';
import { processAccessoryPhoto } from './accessory-photo';

export interface Actor {
  id: string;
  role: Role | string;
}

const isSuper = (a: Actor) => a.role === Role.super_admin;
const notFound = () => BusinessException.notFound('NOT_FOUND', 'accessory not found');
const P2002 = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
const P2003 = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003';

type Tx = Prisma.TransactionClient;

@Injectable()
export class AdminAccessoriesService {
  private readonly logger = new Logger(AdminAccessoriesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------------ lectura

  private async hasSalesMap(db: Tx | PrismaService, ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const [lines, comps] = await Promise.all([
      db.orderAccessoryLine.groupBy({ by: ['accessoryId'], where: { accessoryId: { in: ids } } }),
      db.orderEnergyBundleComponent.groupBy({ by: ['accessoryId'], where: { accessoryId: { in: ids } } }),
    ]);
    return new Set([...lines.map((l) => l.accessoryId as string), ...comps.map((c) => c.accessoryId)]);
  }

  private async dto(db: Tx | PrismaService, row: AccessoryRow, actor: Actor): Promise<AdminAccessoryDTO> {
    const sales = await this.hasSalesMap(db, [row.id]);
    return toAdminDTO(row, { superAdmin: isSuper(actor), hasSales: sales.has(row.id) });
  }

  private async lockRow(tx: Tx, id: string): Promise<AccessoryRow> {
    if (!isUuid(id)) throw notFound();
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Accessory" WHERE "id" = ${id} FOR UPDATE`;
    if (locked.length === 0) throw notFound();
    return tx.accessory.findUniqueOrThrow({ where: { id }, select: ACCESSORY_ROW_SELECT });
  }

  async list(rawQuery: unknown, actor: Actor) {
    const q = parseAdminQuery(rawQuery);
    const where: Prisma.AccessoryWhereInput = {};
    if (q.category) where.category = q.category;
    if (q.active !== undefined) where.active = q.active;
    if (q.q) where.name = { contains: q.q, mode: 'insensitive' };
    if (q.soldOut === true) where.stockQty = { lte: this.prisma.accessory.fields.reservedQty };
    if (q.soldOut === false) where.stockQty = { gt: this.prisma.accessory.fields.reservedQty };
    const [rows, total] = await Promise.all([
      this.prisma.accessory.findMany({
        where,
        select: ACCESSORY_ROW_SELECT,
        orderBy: [{ category: 'asc' }, { name: 'asc' }, { id: 'asc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.accessory.count({ where }),
    ]);
    const sales = await this.hasSalesMap(this.prisma, rows.map((r) => r.id));
    return {
      items: rows.map((r) => toAdminDTO(r, { superAdmin: isSuper(actor), hasSales: sales.has(r.id) })),
      page: q.page,
      pageSize: q.pageSize,
      total,
    };
  }

  async get(id: string, actor: Actor): Promise<AdminAccessoryDTO> {
    const row = isUuid(id) ? await this.prisma.accessory.findUnique({ where: { id }, select: ACCESSORY_ROW_SELECT }) : null;
    if (!row) throw notFound();
    return this.dto(this.prisma, row, actor);
  }

  async movements(id: string, rawQuery: unknown) {
    if (!isUuid(id) || (await this.prisma.accessory.count({ where: { id } })) === 0) throw notFound();
    const { page, pageSize } = parseAdminQuery(rawQuery);
    const [rows, total] = await Promise.all([
      this.prisma.accessoryStockMovement.findMany({
        where: { accessoryId: id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.accessoryStockMovement.count({ where: { accessoryId: id } }),
    ]);
    const userIds = [...new Set(rows.map((r) => r.actorUserId).filter((x): x is string => x !== null))];
    const orderIds = [...new Set(rows.map((r) => r.orderId).filter((x): x is string => x !== null))];
    const [users, orders] = await Promise.all([
      userIds.length ? this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [],
      orderIds.length ? this.prisma.order.findMany({ where: { id: { in: orderIds } }, select: { id: true, orderNumber: true } }) : [],
    ]);
    const nameOf = new Map(users.map((u) => [u.id, u.name]));
    const numberOf = new Map(orders.map((o) => [o.id, o.orderNumber]));
    return {
      items: rows.map((m) => ({
        kind: m.kind,
        delta: m.delta,
        stockBefore: m.stockBefore,
        stockAfter: m.stockAfter,
        reason: m.reason,
        actor: m.actorUserId === null ? null : { userId: m.actorUserId, name: nameOf.get(m.actorUserId) ?? null },
        orderNumber: m.orderId === null ? null : (numberOf.get(m.orderId) ?? null),
        createdAt: m.createdAt.toISOString(),
      })),
      page,
      pageSize,
      total,
    };
  }

  // ------------------------------------------------------------------ alta y edición

  private forbidStar(body: unknown, which: readonly string[], actor: Actor): void {
    if (isSuper(actor)) return;
    const fields = starFieldsIn(body, which);
    if (fields.length > 0) throw BusinessException.forbidden('FORBIDDEN_FIELD', 'field requires super_admin', { fields });
  }

  /** Lo auditable de un conjunto de campos (⛔ `unitCostCents` fuera salvo `withCost`). */
  private auditView(src: Partial<AccessoryRow>, keys: (keyof AccessoryFields)[], withCost: boolean): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const k of keys) if (k !== 'unitCostCents' || withCost) out[k] = src[k] ?? null;
    return out;
  }

  async create(body: unknown, actor: Actor): Promise<AdminAccessoryDTO> {
    this.forbidStar(body, STAR_FIELDS_CREATE, actor);
    const f = parseAccessoryFields(body, 'create');
    const data = {
      name: f.name!,
      description: f.description ?? null,
      category: f.category!,
      energyType: f.energyType ?? null,
      lengthMm: f.lengthMm ?? null,
      widthMm: f.widthMm ?? null,
      heightMm: f.heightMm ?? null,
      weightG: f.weightG ?? null,
      priceCents: f.priceCents ?? null,
      unitCostCents: f.unitCostCents ?? null,
      suggested: f.suggested ?? false,
      active: false,
    };
    assertCoherent(data);
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.accessory.create({ data, select: ACCESSORY_ROW_SELECT });
      await this.audit.log(
        {
          actorUserId: actor.id,
          actorRole: actor.role as Role,
          action: 'accessory.created',
          entityType: 'Accessory',
          entityId: row.id,
          after: this.auditView(row, FIELD_ORDER, isSuper(actor)),
        },
        tx,
      );
      return toAdminDTO(row, { superAdmin: isSuper(actor), hasSales: false });
    });
  }

  async update(id: string, body: unknown, actor: Actor): Promise<AdminAccessoryDTO> {
    this.forbidStar(body, STAR_FIELDS_PATCH, actor);
    const f = parseAccessoryFields(body, 'patch');
    try {
      return await this.prisma.$transaction(async (tx) => {
        const cur = await this.lockRow(tx, id);
        const next: AccessoryRow = { ...cur };
        for (const k of FIELD_ORDER) if (f[k] !== undefined) (next as unknown as Record<string, unknown>)[k] = f[k];
        // Pasar a una categoría que no es energía sin decir el tipo ⇒ el tipo se limpia (no hay otro valor coherente).
        if (f.category !== undefined && f.category !== 'energy' && f.energyType === undefined) next.energyType = null;
        assertCoherent(next);
        if (cur.active) {
          if ((cur.category === 'energy') !== (next.category === 'energy')) {
            throw BusinessException.conflict('ACCESSORY_ACTIVE', 'deactivate before moving between energy and other categories');
          }
          const missing = activationMissing(next);
          if (missing.length > 0) throw BusinessException.validation('ACCESSORY_NOT_ACTIVATABLE', 'an active accessory needs these fields', { missing });
        }
        const changed = FIELD_ORDER.filter((k) => cur[k] !== next[k]);
        if (changed.length === 0) return this.dto(tx, cur, actor);
        const data: Prisma.AccessoryUpdateInput = {};
        for (const k of changed) (data as Record<string, unknown>)[k] = next[k];
        const row = await tx.accessory.update({ where: { id }, data, select: ACCESSORY_ROW_SELECT });
        const base = { actorUserId: actor.id, actorRole: actor.role as Role, entityType: 'Accessory', entityId: id };
        const before = this.auditView(cur, changed, false);
        const after = this.auditView(row, changed, isSuper(actor));
        await this.audit.log({ ...base, action: 'accessory.updated', before, after }, tx);
        if (changed.includes('priceCents')) {
          await this.audit.log({ ...base, action: 'accessory.price_changed', before: { priceCents: cur.priceCents }, after: { priceCents: row.priceCents } }, tx);
        }
        return this.dto(tx, row, actor);
      });
    } catch (e) {
      if (P2002(e)) throw await this.energyTaken(id);
      throw e;
    }
  }

  // ------------------------------------------------------------------ activar / desactivar / borrar (★)

  private async energyTaken(id: string): Promise<BusinessException> {
    const me = await this.prisma.accessory.findUnique({ where: { id }, select: { energyType: true } });
    const other = me?.energyType
      ? await this.prisma.accessory.findFirst({ where: { energyType: me.energyType, active: true, id: { not: id } }, select: { id: true } })
      : null;
    return BusinessException.conflict('ENERGY_TYPE_TAKEN', 'another active product already has this energy type', { accessoryId: other?.id ?? null });
  }

  async activate(id: string, actor: Actor): Promise<AdminAccessoryDTO> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const cur = await this.lockRow(tx, id);
        const missing = activationMissing(cur);
        if (missing.length > 0) throw BusinessException.validation('ACCESSORY_NOT_ACTIVATABLE', 'accessory cannot be activated yet', { missing });
        if (cur.active) return this.dto(tx, cur, actor);
        if (cur.energyType !== null) {
          const other = await tx.accessory.findFirst({ where: { energyType: cur.energyType, active: true, id: { not: id } }, select: { id: true } });
          if (other) throw BusinessException.conflict('ENERGY_TYPE_TAKEN', 'another active product already has this energy type', { accessoryId: other.id });
        }
        const row = await tx.accessory.update({ where: { id }, data: { active: true }, select: ACCESSORY_ROW_SELECT });
        await this.audit.log({ actorUserId: actor.id, actorRole: actor.role as Role, action: 'accessory.activated', entityType: 'Accessory', entityId: id }, tx);
        return this.dto(tx, row, actor);
      });
    } catch (e) {
      // Dos activaciones simultáneas del mismo tipo: el índice parcial decide (criterio 732).
      if (P2002(e)) throw await this.energyTaken(id);
      throw e;
    }
  }

  async deactivate(id: string, actor: Actor): Promise<AdminAccessoryDTO> {
    return this.prisma.$transaction(async (tx) => {
      const cur = await this.lockRow(tx, id);
      if (!cur.active) return this.dto(tx, cur, actor);
      const row = await tx.accessory.update({ where: { id }, data: { active: false }, select: ACCESSORY_ROW_SELECT });
      await this.audit.log({ actorUserId: actor.id, actorRole: actor.role as Role, action: 'accessory.deactivated', entityType: 'Accessory', entityId: id }, tx);
      return this.dto(tx, row, actor);
    });
  }

  async remove(id: string, actor: Actor): Promise<void> {
    const hasSales = () => BusinessException.conflict('ACCESSORY_HAS_SALES', 'accessory has order lines; deactivate it instead');
    try {
      await this.prisma.$transaction(async (tx) => {
        const cur = await this.lockRow(tx, id);
        if ((await this.hasSalesMap(tx, [id])).size > 0) throw hasSales();
        const movements = await tx.accessoryStockMovement.deleteMany({ where: { accessoryId: id } });
        await tx.accessory.delete({ where: { id } });
        await this.audit.log(
          {
            actorUserId: actor.id,
            actorRole: actor.role as Role,
            action: 'accessory.deleted',
            entityType: 'Accessory',
            entityId: id,
            before: { ...this.auditView(cur, FIELD_ORDER, isSuper(actor)), stockQty: cur.stockQty, active: cur.active, photoVersion: cur.photoVersion, movementsDeleted: movements.count },
          },
          tx,
        );
      });
    } catch (e) {
      // Un renglón creado en paralelo (FK Restrict) gana: el borrado se rechaza igual que si ya existiera.
      if (P2003(e)) throw hasSales();
      throw e;
    }
  }

  // ------------------------------------------------------------------ foto

  async replacePhoto(id: string, file: Buffer, actor: Actor): Promise<AdminAccessoryDTO> {
    if (!isUuid(id) || (await this.prisma.accessory.count({ where: { id } })) === 0) throw notFound();
    const p = await processAccessoryPhoto(file);
    return this.prisma.$transaction(async (tx) => {
      const cur = await this.lockRow(tx, id);
      const photo = {
        version: p.version,
        fullWebp: p.fullWebp,
        thumbWebp: p.thumbWebp,
        sourceMime: p.sourceMime,
        sourceBytes: p.sourceBytes,
        uploadedByUserId: actor.id,
        uploadedAt: new Date(),
      };
      await tx.accessoryPhoto.upsert({ where: { accessoryId: id }, create: { accessoryId: id, ...photo }, update: photo });
      const row = await tx.accessory.update({ where: { id }, data: { photoVersion: p.version }, select: ACCESSORY_ROW_SELECT });
      await this.audit.log(
        {
          actorUserId: actor.id,
          actorRole: actor.role as Role,
          action: 'accessory.photo_replaced',
          entityType: 'Accessory',
          entityId: id,
          before: { version: cur.photoVersion },
          after: { version: p.version },
        },
        tx,
      );
      return this.dto(tx, row, actor);
    });
  }

  // ------------------------------------------------------------------ existencias

  async stock(id: string, body: unknown, actor: Actor): Promise<AdminAccessoryDTO> {
    const b = parseStockBody(body);
    if (!isUuid(id)) throw notFound();
    return this.prisma.$transaction(async (tx) => {
      const base = { actorUserId: actor.id, actorRole: actor.role as Role, entityType: 'Accessory', entityId: id };
      if (b.kind === 'receive') {
        const r = await tx.$queryRaw<{ stockQty: number }[]>`
          UPDATE "Accessory" SET "stockQty" = "stockQty" + ${b.quantity}, "updatedAt" = now()
          WHERE "id" = ${id} RETURNING "stockQty"`;
        if (r.length === 0) throw notFound();
        const stockAfter = r[0].stockQty;
        const stockBefore = stockAfter - b.quantity;
        await tx.accessoryStockMovement.create({
          data: { accessoryId: id, kind: 'receive', delta: b.quantity, stockBefore, stockAfter, reason: b.note, actorUserId: actor.id },
        });
        await this.audit.log({ ...base, action: 'accessory.stock_received', before: { stockQty: stockBefore }, after: { stockQty: stockAfter, quantity: b.quantity, note: b.note } }, tx);
      } else {
        const r = await tx.$queryRaw<{ stockQty: number }[]>`
          UPDATE "Accessory" SET "stockQty" = ${b.newStockQty}, "updatedAt" = now()
          WHERE "id" = ${id} AND "stockQty" = ${b.expectedStockQty} AND "reservedQty" <= ${b.newStockQty}
          RETURNING "stockQty"`;
        if (r.length === 0) {
          const cur = await tx.accessory.findUnique({ where: { id }, select: { stockQty: true, reservedQty: true } });
          if (!cur) throw notFound();
          if (cur.stockQty !== b.expectedStockQty) throw BusinessException.conflict('STOCK_CONFLICT', 'stock changed since it was read', { stockQty: cur.stockQty });
          throw BusinessException.conflict('STOCK_BELOW_RESERVED', 'new stock is below what is reserved', { reservedQty: cur.reservedQty });
        }
        await tx.accessoryStockMovement.create({
          data: {
            accessoryId: id,
            kind: 'adjust',
            delta: b.newStockQty - b.expectedStockQty,
            stockBefore: b.expectedStockQty,
            stockAfter: b.newStockQty,
            reason: b.reason,
            actorUserId: actor.id,
          },
        });
        await this.audit.log({ ...base, action: 'accessory.stock_adjusted', before: { stockQty: b.expectedStockQty }, after: { stockQty: b.newStockQty, reason: b.reason } }, tx);
      }
      const row = await tx.accessory.findUniqueOrThrow({ where: { id }, select: ACCESSORY_ROW_SELECT });
      return this.dto(tx, row, actor);
    });
  }
}
