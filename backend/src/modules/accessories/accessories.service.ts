/**
 * accessories.service.ts — tienda pública de accesorios (API_CONTRACT §AC.3). `@Public()`, sin sesión, solo lectura.
 *
 *  - Lista: solo `active`; orden «disponibles primero» → categoría (orden del enum: Postgres ordena un enum por su orden de
 *    declaración, que es el de la tienda) → `lower(name)` → `id`.
 *  - Ficha: activo ⇒ `AccessoryDetailDTO`; inexistente o inactivo ⇒ `404 ACCESSORY_NOT_FOUND` (sin distinguir).
 *  - Sugerencias: candidatos de la BD + regla pura `rankSuggestions` + dial `accessory_suggestion_count`.
 *  - Foto: bytes de `AccessoryPhoto` por versión y variante; se sirve aunque el accesorio esté inactivo.
 * ⛔ Toda respuesta pasa por `accessory-dto.ts` (lista blanca campo por campo).
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/business.exception';
import { SettingsService } from '../settings/settings.service';
import { SettingKey } from '../settings/settings.constants';
import { AccessoryCardDTO, AccessoryDetailDTO, AccessoryRow, ACCESSORY_ROW_SELECT, availableOf, toCardDTO, toDetailDTO } from './accessory-dto';
import { ilikeContains, isUuid, parseExclude, parsePublicQuery } from './accessory-input';
import { rankSuggestions } from './suggestion-rule';

export const SUGGESTION_WINDOW_DAYS = 30;

/** Columnas de `AccessoryRow` para SQL crudo (mismo conjunto que `ACCESSORY_ROW_SELECT`). */
const ROW_COLUMNS = Prisma.raw(
  Object.keys(ACCESSORY_ROW_SELECT)
    .map((c) => `a."${c}"`)
    .join(', '),
);

@Injectable()
export class AccessoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async list(rawQuery: unknown): Promise<{ items: AccessoryCardDTO[]; page: number; pageSize: number; total: number }> {
    const q = parsePublicQuery(rawQuery);
    const conds: Prisma.Sql[] = [Prisma.sql`a."active" = true`];
    if (q.category) conds.push(Prisma.sql`a."category" = ${q.category}::"AccessoryCategory"`);
    if (q.q) conds.push(Prisma.sql`a."name" ILIKE ${ilikeContains(q.q)} ESCAPE '\\'`);
    const where = Prisma.join(conds, ' AND ');
    const [rows, count] = await Promise.all([
      this.prisma.$queryRaw<AccessoryRow[]>`
        SELECT ${ROW_COLUMNS} FROM "Accessory" a
        WHERE ${where}
        ORDER BY (a."stockQty" - a."reservedQty" <= 0) ASC, a."category" ASC, lower(a."name") ASC, a."id" ASC
        LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`,
      this.prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM "Accessory" a WHERE ${where}`,
    ]);
    return { items: rows.map(toCardDTO), page: q.page, pageSize: q.pageSize, total: count[0]?.n ?? 0 };
  }

  async detail(id: string): Promise<AccessoryDetailDTO> {
    const row = isUuid(id) ? await this.prisma.accessory.findFirst({ where: { id, active: true }, select: ACCESSORY_ROW_SELECT }) : null;
    if (!row) throw BusinessException.notFound('ACCESSORY_NOT_FOUND', 'accessory not found');
    return toDetailDTO(row);
  }

  async suggestions(rawExclude: unknown, now: Date = new Date()): Promise<{ items: AccessoryCardDTO[] }> {
    const exclude = parseExclude(rawExclude);
    const n = await this.settings.getNumber(SettingKey.ACCESSORY_SUGGESTION_COUNT);
    if (!Number.isInteger(n) || n <= 0) return { items: [] };
    const rows: AccessoryRow[] = await this.prisma.accessory.findMany({
      where: {
        active: true,
        category: { not: 'energy' },
        stockQty: { gt: this.prisma.accessory.fields.reservedQty },
        ...(exclude.length > 0 ? { id: { notIn: exclude } } : {}),
      },
      select: ACCESSORY_ROW_SELECT,
    });
    if (rows.length === 0) return { items: [] };
    const since = new Date(now.getTime() - SUGGESTION_WINDOW_DAYS * 86_400_000);
    const sold = await this.prisma.orderAccessoryLine.groupBy({
      by: ['accessoryId'],
      where: {
        kind: 'accessory',
        accessoryId: { in: rows.map((r) => r.id) },
        order: { status: 'settled', settledAt: { gte: since } },
      },
      _sum: { quantity: true },
    });
    const soldBy = new Map(sold.map((s) => [s.accessoryId as string, s._sum.quantity ?? 0]));
    const ranked = rankSuggestions(
      rows.map((r) => ({ ...r, availableQty: availableOf(r), soldLast30d: soldBy.get(r.id) ?? 0 })),
      n,
    );
    return { items: ranked.map((r) => toCardDTO(r)) };
  }

  /** Bytes WebP de la variante, o `404` si la versión no es la vigente (o no hay foto). */
  async photo(id: string, version: string, variant: string): Promise<Buffer> {
    const notFound = () => BusinessException.notFound('NOT_FOUND', 'photo not found');
    if (variant !== 'full' && variant !== 'thumb') throw notFound();
    if (!isUuid(id) || !/^[0-9a-f]{16}$/.test(version)) throw notFound();
    const p = await this.prisma.accessoryPhoto.findUnique({
      where: { accessoryId: id },
      select: { version: true, fullWebp: variant === 'full', thumbWebp: variant === 'thumb' },
    });
    // `Accessory.photoVersion` y `AccessoryPhoto.version` se escriben en la misma tx: comparar con la fila de la foto basta.
    if (!p || p.version !== version) throw notFound();
    const bytes = variant === 'full' ? p.fullWebp : p.thumbWebp;
    if (!bytes) throw notFound();
    return Buffer.from(bytes);
  }
}
