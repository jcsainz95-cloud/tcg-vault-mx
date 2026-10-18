/**
 * marketing-annotations.service.ts — CRUD de las anotaciones de fecha del Panel (h1, API_CONTRACT
 * §MKT.E; ARCHITECTURE §13.4.6). ⛔ CERO dinero. Valida PII server-side ANTES de guardar (`422
 * VALIDATION_ERROR`), igual que c6 (`marketing-pii-filter`). Devuelve la fecha como `YYYY-MM-DD`.
 *
 * Reglas:
 *  - `label` y `destino` pasan por el filtro PII (`containsPii`) — rechazo `422` y NO se guarda.
 *  - `destino` SOLO tiene sentido en `kind='promocion'`: en otro `kind` se RECHAZA (`422`).
 *  - La fecha `@db.Date` se ancla a medianoche UTC (día CDMX nominal), coherente con d4/los contadores.
 */
import { Injectable } from '@nestjs/common';
import { MarketingAnnotationKind, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/business.exception';
import { containsPii } from './marketing-pii-filter';
import type { CreateAnnotationDto, UpdateAnnotationDto } from './dto/annotations.dto';

/** Forma pública de una anotación (lo que ve el admin en el CRUD). */
export interface AnnotationView {
  id: string;
  date: string; // YYYY-MM-DD
  kind: MarketingAnnotationKind;
  label: string;
  destino: string | null;
  createdAt: string;
}

/** Forma EMBEBIDA en agregados/export (sin `id`/`createdAt`): solo lo que pintan las gráficas. */
export interface EmbeddedAnnotation {
  date: string;
  kind: MarketingAnnotationKind;
  label: string;
  destino?: string;
}

/** `YYYY-MM-DD` → `Date` anclada a medianoche UTC (día CDMX nominal, para `@db.Date`). */
function toDbDate(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`);
}

/** `Date` (`@db.Date`) → `YYYY-MM-DD`. */
function fromDbDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

@Injectable()
export class MarketingAnnotationsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Valida PII (`label`/`destino`) y la coherencia `destino`⇄`kind`. Lanza `422 VALIDATION_ERROR` sin
   * tocar la BD. Es el CANDADO: cualquier `label`/`destino` con PII muere aquí ANTES del `create`/`update`.
   */
  private assertClean(label: string | undefined, destino: string | null | undefined, kind: MarketingAnnotationKind | undefined): void {
    if (label !== undefined && containsPii(label)) {
      throw BusinessException.validation('VALIDATION_ERROR', 'label no puede contener datos personales (correo, @usuario, teléfono, CURP/RFC)', { field: 'label' });
    }
    if (destino !== undefined && destino !== null && destino !== '' && containsPii(destino)) {
      throw BusinessException.validation('VALIDATION_ERROR', 'destino no puede contener datos personales (correo, @usuario, teléfono, CURP/RFC)', { field: 'destino' });
    }
    // `destino` SOLO en promoción (§13.4.6). En otro `kind`, un destino no vacío es un error de forma.
    if (kind !== undefined && kind !== MarketingAnnotationKind.promocion && destino !== undefined && destino !== null && destino !== '') {
      throw BusinessException.validation('VALIDATION_ERROR', 'destino solo aplica a kind=promocion', { field: 'destino' });
    }
  }

  private toView(row: { id: string; date: Date; kind: MarketingAnnotationKind; label: string; destino: string | null; createdAt: Date }): AnnotationView {
    return { id: row.id, date: fromDbDate(row.date), kind: row.kind, label: row.label, destino: row.destino, createdAt: row.createdAt.toISOString() };
  }

  /** Lista del rango `[from, to]` (inclusive por día), ordenada por fecha. Para el CRUD del admin. */
  async list(from: string | undefined, to: string | undefined): Promise<AnnotationView[]> {
    const where: Prisma.MarketingDateAnnotationWhereInput = {};
    if (from || to) {
      where.date = {};
      if (from) where.date.gte = toDbDate(from);
      if (to) where.date.lte = toDbDate(to);
    }
    const rows = await this.prisma.marketingDateAnnotation.findMany({
      where,
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, date: true, kind: true, label: true, destino: true, createdAt: true },
    });
    return rows.map((r) => this.toView(r));
  }

  /** Anotaciones del periodo, forma EMBEBIDA (para la respuesta de agregados y la hoja «Info»). */
  async forPeriod(from: string, to: string): Promise<EmbeddedAnnotation[]> {
    const rows = await this.prisma.marketingDateAnnotation.findMany({
      where: { date: { gte: toDbDate(from), lte: toDbDate(to) } },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      select: { date: true, kind: true, label: true, destino: true },
    });
    return rows.map((r) => ({
      date: fromDbDate(r.date),
      kind: r.kind,
      label: r.label,
      ...(r.destino ? { destino: r.destino } : {}),
    }));
  }

  async create(dto: CreateAnnotationDto, userId: string): Promise<AnnotationView> {
    const destino = dto.kind === MarketingAnnotationKind.promocion ? dto.destino ?? null : (dto.destino ?? null);
    this.assertClean(dto.label, destino, dto.kind);
    const row = await this.prisma.marketingDateAnnotation.create({
      data: {
        date: toDbDate(dto.date),
        kind: dto.kind,
        label: dto.label,
        destino: destino && destino !== '' ? destino : null,
        createdByUserId: userId,
      },
      select: { id: true, date: true, kind: true, label: true, destino: true, createdAt: true },
    });
    return this.toView(row);
  }

  async update(id: string, dto: UpdateAnnotationDto): Promise<AnnotationView> {
    const existing = await this.prisma.marketingDateAnnotation.findUnique({
      where: { id },
      select: { kind: true, destino: true },
    });
    if (!existing) throw BusinessException.notFound('NOT_FOUND', 'Anotación no encontrada');

    const nextKind = dto.kind ?? existing.kind;
    // `destino` efectivo tras el PATCH: si viene en el body manda (vacío ⇒ borrar), si no, el existente.
    const nextDestino = dto.destino !== undefined ? (dto.destino === '' ? null : dto.destino) : existing.destino;
    this.assertClean(dto.label, nextDestino, nextKind);
    // Si pasa a un kind != promocion y no se tocó destino, se limpia (deja de aplicar).
    const destinoToStore = nextKind === MarketingAnnotationKind.promocion ? nextDestino : null;

    const data: Prisma.MarketingDateAnnotationUpdateInput = {};
    if (dto.date !== undefined) data.date = toDbDate(dto.date);
    if (dto.kind !== undefined) data.kind = dto.kind;
    if (dto.label !== undefined) data.label = dto.label;
    if (dto.destino !== undefined || nextKind !== MarketingAnnotationKind.promocion) data.destino = destinoToStore;

    const row = await this.prisma.marketingDateAnnotation.update({
      where: { id },
      data,
      select: { id: true, date: true, kind: true, label: true, destino: true, createdAt: true },
    });
    return this.toView(row);
  }

  async remove(id: string): Promise<void> {
    const existing = await this.prisma.marketingDateAnnotation.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw BusinessException.notFound('NOT_FOUND', 'Anotación no encontrada');
    await this.prisma.marketingDateAnnotation.delete({ where: { id } });
  }
}
