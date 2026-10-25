/**
 * admin-discounts.service.ts — 💰 las rutas del DUEÑO sobre códigos de descuento (API_CONTRACT §DSC.7, criterios 890, 910–913).
 * Solo `super_admin` (lo decide el controlador; el operador recibe `403` sin escribir nada).
 *
 * Reglas que viven aquí:
 *  - Toda escritura deja `AuditLog` con antes → después (`entityType` `DiscountCode` / `DiscountCodeBatch`) en la MISMA tx.
 *  - Bloqueo tras el primer uso (912): con `firstReservedAt ≠ null` solo `status`, `endsAt` y `maxTotalUses ≥ inUse`. El
 *    cambio se escribe bajo `SELECT … FOR UPDATE` de la fila del código — el MISMO candado que toma la reserva del uso
 *    (`DiscountsService.evaluate`), así un PATCH y el primer uso no pueden cruzarse.
 *  - Lote de un solo uso: códigos `PREFIJO-` + 10 símbolos de `crypto.randomInt`; la config se COPIA a cada código.
 *  - `preview`: ⛔ cero escrituras (solo `discountOf`/`allocateDiscount`).
 *  - Las vistas (`DiscountCodeDTO`, `DiscountCodeBatchDTO`, `DiscountReportDTO`) se proyectan CAMPO POR CAMPO.
 */
import { Injectable } from '@nestjs/common';
import { DiscountCode, DiscountCodeStatus, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BusinessException } from '../../common/business.exception';
import { DiscountCartLine, allocateDiscount, discountOf } from '../../common/money';
import { parseEnumFilter } from '../../common/enum-filter';
import { DISCOUNT_CODE_STATUS_VALUES } from '../../common/enum-values';
import { parseMxDayFilter } from '../spend-alerts/mx-day';
import {
  BATCH_FIXED_FIELDS,
  CONFIG_FIELDS,
  DiscountConfig,
  EDITABLE_WHEN_LOCKED,
  changedFields,
  configSnapshot,
  diffSnapshots,
  mergeConfig,
  parseBatchCreate,
  parseCodeCreate,
  parseConfigPatch,
  parsePreview,
  validateConfig,
} from './discount-admin-input';
import {
  DISCOUNT_CODE_STATE_FILTER_VALUES,
  DiscountCodeState,
  DiscountReportDTO,
  ReportRedemption,
  batchCodesCsv,
  batchStateOf,
  batchStatusOf,
  buildDiscountReport,
  codeStateOf,
  generateBatchCodes,
  redemptionAt,
  reportCsv,
} from './discount-admin-view';
import { termsOf } from './discounts.service';

export interface Actor {
  id: string;
  role: Role;
}

type Tx = Prisma.TransactionClient;

const LIST_DEFAULT_PAGE_SIZE = 50;
const LIST_MAX_PAGE_SIZE = 100;
const AUDIT_PAGE_SIZE = 50;
const LIVE_USE: Prisma.DiscountRedemptionWhereInput['status'] = { in: ['reserved', 'consumed'] };

export interface DiscountCodeDTO {
  id: string;
  code: string;
  batchId: string | null;
  kind: DiscountCode['kind'];
  percentPct: number | null;
  amountCents: number | null;
  maxDiscountCents: number | null;
  minSubtotalCents: number | null;
  productScopes: DiscountCode['productScopes'];
  destinations: DiscountCode['destinations'];
  startsAt: string;
  endsAt: string | null;
  maxTotalUses: number | null;
  maxUsesPerCustomer: number | null;
  status: DiscountCodeStatus;
  state: DiscountCodeState;
  locked: boolean;
  usage: { consumed: number; reservedNow: number; limit: number | null; discountGivenCents: number };
  createdAt: string;
  createdBy: { id: string; name: string };
}

export interface DiscountCodeBatchDTO {
  id: string;
  prefix: string;
  quantity: number;
  createdAt: string;
  createdBy: { id: string; name: string };
  kind: DiscountCode['kind'];
  percentPct: number | null;
  amountCents: number | null;
  maxDiscountCents: number | null;
  minSubtotalCents: number | null;
  productScopes: DiscountCode['productScopes'];
  destinations: DiscountCode['destinations'];
  startsAt: string;
  endsAt: string | null;
  status: DiscountCodeStatus;
  state: DiscountCodeState;
  usedCodes: number;
  reservedNow: number;
  locked: boolean;
}

function pageOf(raw: unknown, field: string, def: number, max: number): number {
  if (raw === undefined || raw === null || raw === '') return def;
  const n = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isInteger(n) || n < 1 || n > max) throw BusinessException.badRequest('VALIDATION_ERROR', `${field} must be an integer in 1..${max}`, { field });
  return n;
}

const configOf = (r: DiscountCode): DiscountConfig => ({
  kind: r.kind,
  percentPct: r.percentPct,
  amountCents: r.amountCents,
  maxDiscountCents: r.maxDiscountCents,
  minSubtotalCents: r.minSubtotalCents,
  productScopes: r.productScopes,
  destinations: r.destinations,
  startsAt: r.startsAt,
  endsAt: r.endsAt,
  maxTotalUses: r.maxTotalUses,
  maxUsesPerCustomer: r.maxUsesPerCustomer,
});

const configData = (c: DiscountConfig) => ({
  kind: c.kind,
  percentPct: c.percentPct,
  amountCents: c.amountCents,
  maxDiscountCents: c.maxDiscountCents,
  minSubtotalCents: c.minSubtotalCents,
  productScopes: c.productScopes,
  destinations: c.destinations,
  startsAt: c.startsAt,
  endsAt: c.endsAt,
  maxTotalUses: c.maxTotalUses,
  maxUsesPerCustomer: c.maxUsesPerCustomer,
});

@Injectable()
export class AdminDiscountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ================================================================ lectura de códigos

  async list(q: { status?: unknown; state?: unknown; batchId?: unknown; q?: unknown; page?: unknown; pageSize?: unknown }, now = new Date()) {
    const status = parseEnumFilter('status', q.status, DISCOUNT_CODE_STATUS_VALUES);
    const state = parseEnumFilter('state', q.state, DISCOUNT_CODE_STATE_FILTER_VALUES);
    const page = pageOf(q.page, 'page', 1, Number.MAX_SAFE_INTEGER);
    const pageSize = pageOf(q.pageSize, 'pageSize', LIST_DEFAULT_PAGE_SIZE, LIST_MAX_PAGE_SIZE);
    if (q.batchId !== undefined && (typeof q.batchId !== 'string' || q.batchId.trim() === '')) {
      throw BusinessException.badRequest('VALIDATION_ERROR', 'batchId must be a string', { field: 'batchId' });
    }
    if (q.q !== undefined && typeof q.q !== 'string') throw BusinessException.badRequest('VALIDATION_ERROR', 'q must be a string', { field: 'q' });
    const prefix = typeof q.q === 'string' ? q.q.trim().toUpperCase().slice(0, 40) : '';
    const where: Prisma.DiscountCodeWhereInput = {
      archivedAt: null,
      batchId: typeof q.batchId === 'string' ? q.batchId.trim() : null,
      ...(status ? { status } : {}),
      ...(prefix ? { code: { startsWith: prefix } } : {}),
    };
    // La partición `state` es computada (⛔ sin columna): se filtra sobre todos los que casan y se pagina después.
    const rows = await this.prisma.discountCode.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] });
    const uses = await this.usesByCode(this.prisma, rows.map((r) => r.id));
    const withState = rows.map((r) => ({ r, s: codeStateOf(r, (uses.get(r.id)?.reserved ?? 0) + (uses.get(r.id)?.consumed ?? 0), now) }));
    const matching = state ? withState.filter((x) => x.s === state) : withState;
    const slice = matching.slice((page - 1) * pageSize, page * pageSize);
    return { data: await this.codeDtos(slice.map((x) => x.r), now, uses), page, pageSize, total: matching.length };
  }

  async get(id: string, now = new Date()): Promise<DiscountCodeDTO> {
    const row = await this.prisma.discountCode.findUnique({ where: { id } });
    if (!row || row.archivedAt) throw BusinessException.notFound();
    return (await this.codeDtos([row], now))[0];
  }

  // ================================================================ escritura de códigos

  async create(body: unknown, actor: Actor, now = new Date()): Promise<DiscountCodeDTO> {
    const { code, config } = parseCodeCreate(body, now);
    const created = await this.prisma.$transaction(async (tx) => {
      if (await tx.discountCode.findUnique({ where: { code }, select: { id: true } })) throw taken();
      // PROJECTION-EXEMPT: la fila no sale; el DTO se proyecta abajo (`codeDtos`).
      const row = await tx.discountCode.create({ data: { code, ...configData(config), createdByUserId: actor.id } });
      await this.log(tx, actor, 'discount.code.created', 'DiscountCode', row.id, null, configSnapshot({ ...config, status: row.status }));
      return row;
    }).catch(rethrowTaken);
    return (await this.codeDtos([created], now))[0];
  }

  async patch(id: string, body: unknown, actor: Actor, now = new Date()): Promise<DiscountCodeDTO> {
    const parsed = parseConfigPatch(body, { allowStatus: true });
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await this.lockCode(tx, id);
      const patchObj: Record<string, unknown> = { ...parsed.config, ...(parsed.status ? { status: parsed.status } : {}) };
      const changed = changedFields(row as unknown as Record<string, unknown>, patchObj);
      const fixed = row.batchId ? changed.filter((f) => (BATCH_FIXED_FIELDS as readonly string[]).includes(f)) : [];
      const locked = row.firstReservedAt ? changed.filter((f) => !EDITABLE_WHEN_LOCKED.includes(f)) : [];
      const lockedFields = [...new Set([...fixed, ...locked])].sort();
      if (lockedFields.length > 0) {
        throw BusinessException.conflict('DISCOUNT_CODE_LOCKED', 'Some fields cannot change after the first use', { lockedFields });
      }
      const next = mergeConfig(configOf(row), parsed.config);
      validateConfig(next);
      if (changed.includes('maxTotalUses') && next.maxTotalUses !== null) {
        const inUse = await tx.discountRedemption.count({ where: { codeId: row.id, status: LIVE_USE } });
        if (next.maxTotalUses < inUse) {
          throw BusinessException.conflict('DISCOUNT_CODE_LIMIT_BELOW_USES', 'maxTotalUses is below the uses already taken', { inUse });
        }
      }
      const status = parsed.status ?? row.status;
      // PROJECTION-EXEMPT: la fila no sale; el DTO se proyecta abajo (`codeDtos`).
      const after = await tx.discountCode.update({ where: { id: row.id }, data: { ...configData(next), status } });
      await this.log(tx, actor, 'discount.code.updated', 'DiscountCode', row.id, configSnapshot({ ...configOf(row), status: row.status }), configSnapshot({ ...next, status }));
      return after;
    });
    return (await this.codeDtos([updated], now))[0];
  }

  /** `pause` / `resume` — idempotentes; efecto inmediato en sesiones nuevas (910: la validez lee `status` bajo candado). */
  async setStatus(id: string, status: DiscountCodeStatus, actor: Actor, now = new Date()): Promise<DiscountCodeDTO> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await this.lockCode(tx, id);
      // PROJECTION-EXEMPT: la fila no sale; el DTO se proyecta abajo (`codeDtos`).
      const after = await tx.discountCode.update({ where: { id: row.id }, data: { status } });
      await this.log(tx, actor, status === 'paused' ? 'discount.code.paused' : 'discount.code.resumed', 'DiscountCode', row.id, { status: row.status }, { status });
      return after;
    });
    return (await this.codeDtos([updated], now))[0];
  }

  /** `DELETE` ⇒ `archivedAt` (se comporta como inexistente); con cualquier uso ⇒ `409 DISCOUNT_CODE_HAS_USES`. */
  async archive(id: string, actor: Actor, now = new Date()): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const row = await this.lockCode(tx, id);
      if ((await tx.discountRedemption.count({ where: { codeId: row.id } })) > 0) {
        throw BusinessException.conflict('DISCOUNT_CODE_HAS_USES', 'A code with uses cannot be archived');
      }
      await tx.discountCode.update({ where: { id: row.id }, data: { archivedAt: now }, select: { id: true } });
      await this.log(tx, actor, 'discount.code.archived', 'DiscountCode', row.id, { archivedAt: null }, { archivedAt: now.toISOString() });
    });
  }

  // ================================================================ vista previa (⛔ cero escrituras)

  preview(body: unknown, now = new Date()): { discountCents: number; nominalCents: number; capped: boolean } {
    const { config, lines } = parsePreview(body, now);
    const cart: DiscountCartLine[] = lines.map((l, i) => ({
      id: `sample:${i}`,
      group: l.scope === 'accessory' ? 'accessory' : 'piece',
      type: l.scope,
      unitPriceCents: l.priceCents,
      quantity: l.quantity,
    }));
    const terms = termsOf(config);
    const destination = config.destinations.length === 1 ? config.destinations[0] : 'direct_ship';
    const d = discountOf(cart, terms, { destination });
    if (!d.ok) return { discountCents: 0, nominalCents: 0, capped: false };
    const alloc = allocateDiscount(d.eligible, d.nominalCents);
    // «Recortado» ⇔ lo que el cliente ve es menos que el nominal SIN topes (tope en pesos, el monto mayor que lo elegible, o
    // el centavo por unidad de I-4 y el residuo que no cabe).
    const B = d.eligibleSubtotalCents;
    const raw = config.kind === 'percent' ? Math.floor((B * (config.percentPct ?? 0)) / 100) : config.kind === 'fixed_amount' ? (config.amountCents ?? 0) : 0;
    return { discountCents: alloc.discountCents, nominalCents: d.nominalCents, capped: alloc.discountCents < raw };
  }

  // ================================================================ lotes

  async createBatch(body: unknown, actor: Actor, now = new Date()): Promise<{ batch: DiscountCodeBatchDTO; codesCsvPath: string }> {
    const { prefix, quantity, config } = parseBatchCreate(body, now);
    const run = () =>
      this.prisma.$transaction(async (tx) => {
        let codes = generateBatchCodes(prefix, quantity);
        // Colisión con un texto que ya existe (también archivado: único para siempre) ⇒ se regenera ese.
        for (let i = 0; i < 5; i += 1) {
          const taken = new Set((await tx.discountCode.findMany({ where: { code: { in: codes } }, select: { code: true } })).map((c) => c.code));
          if (taken.size === 0) break;
          codes = [...codes.filter((c) => !taken.has(c)), ...generateBatchCodes(prefix, taken.size, new Set([...codes, ...taken]))];
        }
        const batch = await tx.discountCodeBatch.create({ data: { prefix, quantity, createdByUserId: actor.id }, select: { id: true } });
        await tx.discountCode.createMany({ data: codes.map((code) => ({ code, batchId: batch.id, ...configData(config), createdByUserId: actor.id })) });
        await this.log(tx, actor, 'discount.batch.created', 'DiscountCodeBatch', batch.id, null, { prefix, quantity, ...configSnapshot({ ...config, status: 'active' }) });
        return batch.id;
      });
    const id = await run().catch(rethrowTaken);
    return { batch: await this.batchDto(id, now), codesCsvPath: `/admin/discount-code-batches/${id}/codes.csv` };
  }

  async listBatches(q: { page?: unknown }, now = new Date()) {
    const page = pageOf(q.page, 'page', 1, Number.MAX_SAFE_INTEGER);
    const pageSize = LIST_DEFAULT_PAGE_SIZE;
    const total = await this.prisma.discountCodeBatch.count();
    const ids = await this.prisma.discountCodeBatch.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip: (page - 1) * pageSize, take: pageSize, select: { id: true } });
    const data: DiscountCodeBatchDTO[] = [];
    for (const b of ids) data.push(await this.batchDto(b.id, now));
    return { data, page, pageSize, total };
  }

  getBatch(id: string, now = new Date()): Promise<DiscountCodeBatchDTO> {
    return this.batchDto(id, now);
  }

  /**
   * `PATCH /admin/discount-code-batches/:id` — aplica los campos de config a TODOS sus códigos con las reglas de bloqueo del
   * código: si alguno tiene uso, solo `endsAt`. Los límites de uso de un lote están fijos en 1 ⇒ `409 LOCKED` siempre.
   */
  async patchBatch(id: string, body: unknown, actor: Actor, now = new Date()): Promise<DiscountCodeBatchDTO> {
    const fields = CONFIG_FIELDS.filter((f) => !BATCH_FIXED_FIELDS.includes(f));
    let parsed: ReturnType<typeof parseConfigPatch>;
    try {
      parsed = parseConfigPatch(body, { allowStatus: false, fields });
    } catch (e) {
      const field = e instanceof BusinessException ? (e.details?.field as string | undefined) : undefined;
      if (field && (BATCH_FIXED_FIELDS as readonly string[]).includes(field)) {
        throw BusinessException.conflict('DISCOUNT_CODE_LOCKED', 'Batch codes are single-use', { lockedFields: [field] });
      }
      throw e;
    }
    await this.prisma.$transaction(async (tx) => {
      const codes = await this.lockBatch(tx, id);
      const anyUsed = codes.some((c) => c.firstReservedAt !== null);
      const before = configSnapshot({ ...configOf(codes[0]), status: codes[0].status });
      const changedAny = new Set<string>();
      for (const c of codes) for (const f of changedFields(c as unknown as Record<string, unknown>, parsed.config as Record<string, unknown>)) changedAny.add(f);
      const lockedFields = anyUsed ? [...changedAny].filter((f) => f !== 'endsAt').sort() : [];
      if (lockedFields.length > 0) throw BusinessException.conflict('DISCOUNT_CODE_LOCKED', 'Some fields cannot change after the first use', { lockedFields });
      for (const c of codes) {
        const next = mergeConfig(configOf(c), parsed.config);
        validateConfig(next);
        await tx.discountCode.update({ where: { id: c.id }, data: configData(next), select: { id: true } });
      }
      const after = configSnapshot({ ...mergeConfig(configOf(codes[0]), parsed.config), status: codes[0].status });
      await this.log(tx, actor, 'discount.batch.updated', 'DiscountCodeBatch', id, before, after);
    });
    return this.batchDto(id, now);
  }

  /** Pausa/reanuda los N códigos del lote en UNA tx (911). Idempotente. */
  async setBatchStatus(id: string, status: DiscountCodeStatus, actor: Actor, now = new Date()): Promise<DiscountCodeBatchDTO> {
    await this.prisma.$transaction(async (tx) => {
      const codes = await this.lockBatch(tx, id);
      const before = batchStatusOf(codes.map((c) => ({ status: c.status, used: false })));
      await tx.discountCode.updateMany({ where: { batchId: id }, data: { status } });
      await this.log(tx, actor, status === 'paused' ? 'discount.batch.paused' : 'discount.batch.resumed', 'DiscountCodeBatch', id, { status: before }, { status, codes: codes.length });
    });
    return this.batchDto(id, now);
  }

  /** `codes.csv` — `code,status,usedAt`. Auditado: reparte códigos. */
  async batchCodesCsv(id: string, actor: Actor, now = new Date()): Promise<{ filename: string; body: string }> {
    const batch = await this.prisma.discountCodeBatch.findUnique({ where: { id }, select: { id: true, prefix: true } });
    if (!batch) throw BusinessException.notFound();
    const codes = await this.prisma.discountCode.findMany({ where: { batchId: id }, orderBy: { code: 'asc' } });
    const uses = await this.usesByCode(this.prisma, codes.map((c) => c.id));
    const consumedAt = new Map(
      (await this.prisma.discountRedemption.findMany({ where: { codeId: { in: codes.map((c) => c.id) }, status: 'consumed' }, select: { codeId: true, consumedAt: true } })).map((r) => [r.codeId, r.consumedAt]),
    );
    const body = batchCodesCsv(
      codes.map((c) => ({ code: c.code, state: codeStateOf(c, (uses.get(c.id)?.reserved ?? 0) + (uses.get(c.id)?.consumed ?? 0), now), usedAt: consumedAt.get(c.id) ?? null })),
    );
    await this.log(this.prisma, actor, 'discount.batch.codes_exported', 'DiscountCodeBatch', id, null, { codes: codes.length });
    return { filename: `codigos_${batch.prefix}_${id.slice(0, 8)}.csv`, body };
  }

  // ================================================================ reportes (913)

  async codeReport(id: string, q: { from?: unknown; to?: unknown }): Promise<DiscountReportDTO> {
    const row = await this.prisma.discountCode.findUnique({ where: { id }, select: { id: true, maxTotalUses: true } });
    if (!row) throw BusinessException.notFound();
    return this.report([row.id], row.maxTotalUses, q, false);
  }

  async batchReport(id: string, q: { from?: unknown; to?: unknown }): Promise<DiscountReportDTO> {
    const batch = await this.prisma.discountCodeBatch.findUnique({ where: { id }, select: { id: true, quantity: true } });
    if (!batch) throw BusinessException.notFound();
    const codes = await this.prisma.discountCode.findMany({ where: { batchId: id }, select: { id: true } });
    return this.report(codes.map((c) => c.id), batch.quantity, q, true);
  }

  async codeReportCsv(id: string, q: { from?: unknown; to?: unknown }, actor: Actor) {
    const r = await this.codeReport(id, q);
    await this.log(this.prisma, actor, 'discount.code.report_exported', 'DiscountCode', id, null, { rows: r.rows.length });
    return { filename: `reporte_codigo_${id.slice(0, 8)}.csv`, body: reportCsv(r) };
  }

  async batchReportCsv(id: string, q: { from?: unknown; to?: unknown }, actor: Actor) {
    const r = await this.batchReport(id, q);
    await this.log(this.prisma, actor, 'discount.batch.report_exported', 'DiscountCodeBatch', id, null, { rows: r.rows.length });
    return { filename: `reporte_lote_${id.slice(0, 8)}.csv`, body: reportCsv(r) };
  }

  // ================================================================ bitácora (antes → después)

  async auditOf(entityType: 'DiscountCode' | 'DiscountCodeBatch', id: string, q: { page?: unknown }) {
    const exists =
      entityType === 'DiscountCode'
        ? await this.prisma.discountCode.findUnique({ where: { id }, select: { id: true } })
        : await this.prisma.discountCodeBatch.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw BusinessException.notFound();
    const page = pageOf(q.page, 'page', 1, Number.MAX_SAFE_INTEGER);
    const where: Prisma.AuditLogWhereInput = { entityType, entityId: id };
    const total = await this.prisma.auditLog.count({ where });
    const rows = await this.prisma.auditLog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      skip: (page - 1) * AUDIT_PAGE_SIZE,
      take: AUDIT_PAGE_SIZE,
      select: { createdAt: true, actorUserId: true, action: true, before: true, after: true },
    });
    const names = await this.namesOf(rows.map((r) => r.actorUserId).filter((x): x is string => !!x));
    return {
      data: rows.map((r) => ({
        at: r.createdAt.toISOString(),
        actor: r.actorUserId ? { id: r.actorUserId, name: names.get(r.actorUserId) ?? '' } : null,
        action: r.action,
        changes: diffSnapshots(r.before, r.after),
      })),
      page,
      pageSize: AUDIT_PAGE_SIZE,
      total,
    };
  }

  // ================================================================ internos

  private async log(db: Tx | PrismaService, actor: Actor, action: string, entityType: string, entityId: string, before: unknown, after: unknown) {
    await this.audit.log({ actorUserId: actor.id, actorRole: actor.role, action, entityType, entityId, before: before ?? undefined, after }, db as Tx);
  }

  /** `SELECT … FOR UPDATE` de la fila del código (el candado de la reserva, §DSC.5) y su relectura. Archivado ⇒ `404`. */
  private async lockCode(tx: Tx, id: string): Promise<DiscountCode> {
    await tx.$queryRaw`SELECT "id" FROM "DiscountCode" WHERE "id" = ${id} FOR UPDATE`;
    const row = await tx.discountCode.findUnique({ where: { id } });
    if (!row || row.archivedAt) throw BusinessException.notFound();
    return row;
  }

  /** Los códigos del lote bajo candado, en orden de `id` (una reserva toma UNA fila por tx ⇒ sin ciclos). */
  private async lockBatch(tx: Tx, id: string): Promise<DiscountCode[]> {
    const batch = await tx.discountCodeBatch.findUnique({ where: { id }, select: { id: true } });
    if (!batch) throw BusinessException.notFound();
    await tx.$queryRaw`SELECT "id" FROM "DiscountCode" WHERE "batchId" = ${id} ORDER BY "id" FOR UPDATE`;
    const codes = await tx.discountCode.findMany({ where: { batchId: id }, orderBy: { id: 'asc' } });
    if (codes.length === 0) throw BusinessException.notFound();
    return codes;
  }

  /** `reserved` / `consumed` por código. */
  private async usesByCode(db: Tx | PrismaService, ids: readonly string[]): Promise<Map<string, { reserved: number; consumed: number }>> {
    const out = new Map<string, { reserved: number; consumed: number }>();
    if (ids.length === 0) return out;
    const g = await db.discountRedemption.groupBy({ by: ['codeId', 'status'], where: { codeId: { in: [...ids] }, status: LIVE_USE }, _count: { _all: true } });
    for (const x of g) {
      const cur = out.get(x.codeId) ?? { reserved: 0, consumed: 0 };
      if (x.status === 'reserved') cur.reserved += x._count._all;
      if (x.status === 'consumed') cur.consumed += x._count._all;
      out.set(x.codeId, cur);
    }
    return out;
  }

  private async namesOf(ids: readonly string[]): Promise<Map<string, string>> {
    const uniq = [...new Set(ids)];
    if (uniq.length === 0) return new Map();
    const users = await this.prisma.user.findMany({ where: { id: { in: uniq } }, select: { id: true, name: true } });
    return new Map(users.map((u) => [u.id, u.name ?? '']));
  }

  /** `DiscountCodeDTO` campo por campo; `usage.discountGivenCents` = el del reporte sin rango (v1.110.1). */
  private async codeDtos(rows: readonly DiscountCode[], now: Date, known?: Map<string, { reserved: number; consumed: number }>): Promise<DiscountCodeDTO[]> {
    const ids = rows.map((r) => r.id);
    const uses = known ?? (await this.usesByCode(this.prisma, ids));
    const given = new Map<string, number>();
    if (ids.length > 0) {
      const paid = await this.prisma.discountRedemption.findMany({
        where: { codeId: { in: ids }, status: 'consumed', orderId: { not: null } },
        select: { codeId: true, order: { select: { discountCents: true } } },
      });
      for (const p of paid) given.set(p.codeId, (given.get(p.codeId) ?? 0) + (p.order?.discountCents ?? 0));
    }
    const names = await this.namesOf(rows.map((r) => r.createdByUserId));
    return rows.map((r) => {
      const u = uses.get(r.id) ?? { reserved: 0, consumed: 0 };
      return {
        id: r.id,
        code: r.code,
        batchId: r.batchId,
        kind: r.kind,
        percentPct: r.percentPct,
        amountCents: r.amountCents,
        maxDiscountCents: r.maxDiscountCents,
        minSubtotalCents: r.minSubtotalCents,
        productScopes: [...r.productScopes],
        destinations: [...r.destinations],
        startsAt: r.startsAt.toISOString(),
        endsAt: r.endsAt ? r.endsAt.toISOString() : null,
        maxTotalUses: r.maxTotalUses,
        maxUsesPerCustomer: r.maxUsesPerCustomer,
        status: r.status,
        state: codeStateOf(r, u.reserved + u.consumed, now),
        locked: r.firstReservedAt !== null,
        usage: { consumed: u.consumed, reservedNow: u.reserved, limit: r.maxTotalUses, discountGivenCents: given.get(r.id) ?? 0 },
        createdAt: r.createdAt.toISOString(),
        createdBy: { id: r.createdByUserId, name: names.get(r.createdByUserId) ?? '' },
      };
    });
  }

  /** `DiscountCodeBatchDTO`: la config de su primer código (todos la comparten al nacer) + conteos de los N. */
  private async batchDto(id: string, now: Date): Promise<DiscountCodeBatchDTO> {
    const batch = await this.prisma.discountCodeBatch.findUnique({ where: { id } });
    if (!batch) throw BusinessException.notFound();
    const codes = await this.prisma.discountCode.findMany({ where: { batchId: id }, orderBy: { code: 'asc' } });
    if (codes.length === 0) throw BusinessException.notFound();
    const uses = await this.usesByCode(this.prisma, codes.map((c) => c.id));
    const used = (cid: string) => ((uses.get(cid)?.reserved ?? 0) + (uses.get(cid)?.consumed ?? 0)) > 0;
    const consumedCodes = codes.filter((c) => (uses.get(c.id)?.consumed ?? 0) > 0).length;
    const reservedNow = codes.reduce((s, c) => s + (uses.get(c.id)?.reserved ?? 0), 0);
    const status = batchStatusOf(codes.map((c) => ({ status: c.status, used: used(c.id) })));
    const first = codes[0];
    const names = await this.namesOf([batch.createdByUserId]);
    return {
      id: batch.id,
      prefix: batch.prefix,
      quantity: batch.quantity,
      createdAt: batch.createdAt.toISOString(),
      createdBy: { id: batch.createdByUserId, name: names.get(batch.createdByUserId) ?? '' },
      kind: first.kind,
      percentPct: first.percentPct,
      amountCents: first.amountCents,
      maxDiscountCents: first.maxDiscountCents,
      minSubtotalCents: first.minSubtotalCents,
      productScopes: [...first.productScopes],
      destinations: [...first.destinations],
      startsAt: first.startsAt.toISOString(),
      endsAt: first.endsAt ? first.endsAt.toISOString() : null,
      status,
      state: batchStateOf({ status, startsAt: first.startsAt, endsAt: first.endsAt }, consumedCodes, batch.quantity, now),
      usedCodes: consumedCodes,
      reservedNow,
      locked: codes.some((c) => c.firstReservedAt !== null),
    };
  }

  /** El reporte de un conjunto de códigos. `?from=&to=` (días México) filtra por el instante del uso. */
  private async report(codeIds: readonly string[], limit: number | null, q: { from?: unknown; to?: unknown }, batch: boolean): Promise<DiscountReportDTO> {
    const range = parseMxDayFilter(q).range;
    const rows = await this.prisma.discountRedemption.findMany({
      where: { codeId: { in: [...codeIds] } },
      select: {
        status: true,
        createdAt: true,
        consumedAt: true,
        lateConsumed: true,
        customerEmail: true,
        code: { select: { code: true } },
        order: {
          select: {
            id: true,
            orderNumber: true,
            discountCents: true,
            shippingWaivedCents: true,
            totalCents: true,
            refunds: { where: { status: 'succeeded' }, select: { amountCents: true } },
          },
        },
        shipmentRequest: { select: { folio: true, shippingWaivedCents: true, totalCents: true } },
      },
    });
    const all: ReportRedemption[] = rows.map((r) => ({
      code: r.code.code,
      status: r.status,
      createdAt: r.createdAt,
      consumedAt: r.consumedAt,
      lateConsumed: r.lateConsumed,
      customerEmail: r.customerEmail,
      order: r.order
        ? {
            id: r.order.id,
            orderNumber: r.order.orderNumber,
            discountCents: r.order.discountCents,
            shippingWaivedCents: r.order.shippingWaivedCents,
            totalCents: r.order.totalCents,
            refundedCents: r.order.refunds.reduce((s, x) => s + x.amountCents, 0),
          }
        : null,
      withdrawal: r.shipmentRequest ? { folio: r.shipmentRequest.folio, shippingWaivedCents: r.shipmentRequest.shippingWaivedCents, totalCents: r.shipmentRequest.totalCents } : null,
    }));
    const inRange = range
      ? all.filter((r) => {
          const t = redemptionAt(r).getTime();
          return (!range.gte || t >= range.gte.getTime()) && (!range.lt || t < range.lt.getTime());
        })
      : all;
    const reservedNow = all.filter((r) => r.status === 'reserved').length;
    return buildDiscountReport(inRange, reservedNow, limit, { batch });
  }
}

function taken(): BusinessException {
  return BusinessException.conflict('DISCOUNT_CODE_TAKEN', 'The code already exists');
}

/** Una carrera sobre el `@unique` del texto ⇒ el mismo `409 DISCOUNT_CODE_TAKEN` que la comprobación previa. */
function rethrowTaken(e: unknown): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw taken();
  throw e;
}
