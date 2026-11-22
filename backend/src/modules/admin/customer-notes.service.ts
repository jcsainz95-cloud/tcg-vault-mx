/**
 * customer-notes.service.ts — §FICHA-CLIENTE (docs/API_CONTRACT_FICHA_CLIENTE.md §1b): notas internas del equipo sobre un cliente.
 *
 * ⛔ El `body` es texto libre con PII posible. Solo sale por los 4 endpoints `/admin/users/:id/notes`; NUNCA a `GET /:id`,
 * `overview`, rutas de cliente, correos, exportaciones, medición ni logs, y NUNCA a la bitácora (solo `bodyLength`).
 * Borrado lógico (`deletedAt`). Al anonimizar la cuenta, `AdminService.deleteUser` vacía el `body` (misma transacción).
 */
import { Injectable } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { isUUID } from 'class-validator';
import { BusinessException } from '../../common/business.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

export const NOTE_MAX_LENGTH = 1000;
export const NOTE_MAX_PER_CUSTOMER = 200;
export const NOTE_PAGE_MAX = 50;
/** Namespace del candado consultivo por cliente (el 2.º argumento es `hashtext(userId)`). */
const CUSTOMER_NOTES_LOCK_KEY = 'customer-notes';

export interface NoteActor {
  id: string;
  role: Role;
}

export interface NoteDTO {
  id: string;
  body: string;
  pinned: boolean;
  authorId: string | null;
  authorName: string | null;
  createdAt: string;
  updatedAt: string;
  edited: boolean;
  canEdit: boolean;
}

/** Lista blanca de lectura (R-1): ni `clientRequestId` ni `userId` ni `deletedAt` viajan. */
const NOTE_SELECT = {
  id: true,
  body: true,
  pinned: true,
  authorId: true,
  author: { select: { name: true } },
  createdAt: true,
  updatedAt: true,
} as const;
type NoteRow = Prisma.CustomerNoteGetPayload<{ select: typeof NOTE_SELECT }>;

const canEditNote = (n: { authorId: string | null }, actor: NoteActor): boolean =>
  actor.role === Role.super_admin || (n.authorId !== null && n.authorId === actor.id);

export function toNoteDTO(n: NoteRow, actor: NoteActor): NoteDTO {
  return {
    id: n.id,
    body: n.body,
    pinned: n.pinned,
    authorId: n.authorId,
    authorName: n.author?.name ?? null,
    createdAt: n.createdAt.toISOString(),
    updatedAt: n.updatedAt.toISOString(),
    edited: n.updatedAt.getTime() > n.createdAt.getTime(),
    canEdit: canEditNote(n, actor),
  };
}

/** `body` crudo → texto recortado de 1..1000; fuera de rango ⇒ 400, nunca se corta en silencio. */
function parseBody(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw BusinessException.badRequest('VALIDATION_ERROR', 'body must be a string', { field: 'body' });
  }
  const body = raw.trim();
  if (body.length < 1 || body.length > NOTE_MAX_LENGTH) {
    throw BusinessException.badRequest('VALIDATION_ERROR', `body must be 1 to ${NOTE_MAX_LENGTH} characters`, {
      field: 'body',
      min: 1,
      max: NOTE_MAX_LENGTH,
    });
  }
  return body;
}

@Injectable()
export class CustomerNotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** El cliente existe y no es una cuenta `supplier` ⇒ si no, 404 (misma respuesta: no se distingue). */
  private async assertCustomer(userId: string): Promise<void> {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (!u || u.role === Role.supplier) throw BusinessException.notFound();
  }

  /** La nota VIVA de ESTE cliente; de otro cliente o borrada ⇒ 404 (IDOR). */
  private async loadLive(tx: Prisma.TransactionClient | PrismaService, userId: string, noteId: string) {
    const n = await tx.customerNote.findFirst({ where: { id: noteId, userId, deletedAt: null }, select: NOTE_SELECT });
    if (!n) throw BusinessException.notFound();
    return n;
  }

  async list(userId: string, actor: NoteActor, q: { cursor?: unknown; limit?: unknown }) {
    await this.assertCustomer(userId);
    let take = 20;
    if (q.limit !== undefined && q.limit !== '') {
      const l = Number(q.limit);
      if (typeof q.limit !== 'string' || !Number.isInteger(l) || l < 1 || l > NOTE_PAGE_MAX) {
        throw BusinessException.badRequest('VALIDATION_ERROR', `limit must be an integer 1 to ${NOTE_PAGE_MAX}`, { field: 'limit' });
      }
      take = l;
    }
    let cursor: string | undefined;
    if (q.cursor !== undefined && q.cursor !== '') {
      if (typeof q.cursor !== 'string' || !isUUID(q.cursor)) {
        throw BusinessException.badRequest('VALIDATION_ERROR', 'cursor is invalid', { field: 'cursor' });
      }
      cursor = q.cursor;
    }
    const rows = await this.prisma.customerNote.findMany({
      where: { userId, deletedAt: null },
      orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: NOTE_SELECT,
    });
    const page = rows.slice(0, take);
    return {
      items: page.map((n) => toNoteDTO(n, actor)),
      nextCursor: rows.length > take ? page[page.length - 1].id : null,
    };
  }

  /** `{ note, created }`: `created=false` ⇒ repetición idempotente por `clientRequestId` (el controlador responde 200). */
  async create(
    userId: string,
    actor: NoteActor,
    dto: { body?: unknown; pinned?: boolean; clientRequestId?: string },
  ): Promise<{ note: NoteDTO; created: boolean }> {
    await this.assertCustomer(userId);
    const body = parseBody(dto.body);
    const pinned = dto.pinned === true;
    const clientRequestId = dto.clientRequestId ?? null;

    const existing = async () => {
      if (clientRequestId === null) return null;
      const prev = await this.prisma.customerNote.findFirst({
        where: { authorId: actor.id, clientRequestId },
        select: { ...NOTE_SELECT, userId: true, deletedAt: true },
      });
      if (!prev) return null;
      // Misma llave para otro cliente, o la nota ya se borró: no se reutiliza (ni se devuelve texto borrado).
      if (prev.userId !== userId || prev.deletedAt !== null) {
        throw BusinessException.conflict('CONFLICT', 'clientRequestId was already used', { field: 'clientRequestId' });
      }
      return { note: toNoteDTO(prev, actor), created: false };
    };

    const prior = await existing();
    if (prior) return prior;

    try {
      const note = await this.prisma.$transaction(async (tx) => {
        // Serializa las altas del MISMO cliente: el tope de 200 no se rebasa con dos POST simultáneos.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${CUSTOMER_NOTES_LOCK_KEY}), hashtext(${userId}))`;
        const live = await tx.customerNote.count({ where: { userId, deletedAt: null } });
        if (live >= NOTE_MAX_PER_CUSTOMER) {
          throw BusinessException.conflict('NOTE_LIMIT', `A customer can have at most ${NOTE_MAX_PER_CUSTOMER} notes`, {
            max: NOTE_MAX_PER_CUSTOMER,
          });
        }
        const now = new Date();
        const row = await tx.customerNote.create({
          // createdAt = updatedAt EXACTOS al alta: `edited` es `updatedAt > createdAt`.
          data: { userId, authorId: actor.id, body, pinned, clientRequestId, createdAt: now, updatedAt: now },
          select: NOTE_SELECT,
        });
        await this.audit.log(
          {
            actorUserId: actor.id,
            actorRole: actor.role,
            action: 'user.note.create',
            entityType: 'User',
            entityId: userId,
            after: { noteId: row.id, pinned, bodyLength: body.length },
          },
          tx,
        );
        return row;
      });
      return { note: toNoteDTO(note, actor), created: true };
    } catch (e) {
      // Doble clic simultáneo: perdió la carrera contra el índice único ⇒ devuelve la ganadora.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const again = await existing();
        if (again) return again;
      }
      throw e;
    }
  }

  async update(userId: string, noteId: string, actor: NoteActor, dto: { body?: unknown; pinned?: boolean }): Promise<NoteDTO> {
    await this.assertCustomer(userId);
    const touchesBody = dto.body !== undefined;
    const touchesPinned = dto.pinned !== undefined;
    if (!touchesBody && !touchesPinned) {
      throw BusinessException.badRequest('VALIDATION_ERROR', 'body or pinned is required', { field: 'body' });
    }
    const body = touchesBody ? parseBody(dto.body) : undefined;

    return this.prisma.$transaction(async (tx) => {
      const cur = await this.loadLive(tx, userId, noteId);
      // Cambiar el TEXTO: solo el autor o el súper-admin. Fijar/desfijar: cualquiera de los dos roles.
      if (touchesBody && !canEditNote(cur, actor)) {
        throw BusinessException.forbidden('FORBIDDEN', 'Only the author or a super_admin can edit this note');
      }
      const bodyChanged = body !== undefined && body !== cur.body;
      const pinChanged = dto.pinned !== undefined && dto.pinned !== cur.pinned;
      if (!bodyChanged && !pinChanged) return toNoteDTO(cur, actor);

      const row = await tx.customerNote.update({
        where: { id: noteId },
        data: {
          ...(bodyChanged ? { body } : {}),
          ...(pinChanged ? { pinned: dto.pinned } : {}),
          // Fijar NO es editar el texto: se conserva `updatedAt` para que `edited` no mienta.
          // `edited` ≡ `updatedAt > createdAt`: un cambio de texto SIEMPRE se lleva ≥ 1 ms de ventaja (edición en el mismo milisegundo del alta).
          updatedAt: bodyChanged ? new Date(Math.max(Date.now(), cur.createdAt.getTime() + 1)) : cur.updatedAt,
        },
        select: NOTE_SELECT,
      });
      const base = { actorUserId: actor.id, actorRole: actor.role, entityType: 'User', entityId: userId };
      if (bodyChanged) {
        await this.audit.log(
          { ...base, action: 'user.note.update', after: { noteId, pinned: row.pinned, bodyLength: row.body.length } },
          tx,
        );
      }
      if (pinChanged) {
        await this.audit.log({ ...base, action: 'user.note.pin', after: { noteId, pinned: row.pinned, bodyLength: row.body.length } }, tx);
      }
      return toNoteDTO(row, actor);
    });
  }

  async remove(userId: string, noteId: string, actor: NoteActor): Promise<void> {
    await this.assertCustomer(userId);
    await this.prisma.$transaction(async (tx) => {
      const cur = await this.loadLive(tx, userId, noteId);
      if (!canEditNote(cur, actor)) {
        throw BusinessException.forbidden('FORBIDDEN', 'Only the author or a super_admin can delete this note');
      }
      // Escritura condicionada: dos DELETE simultáneos no auditan dos veces.
      const r = await tx.customerNote.updateMany({ where: { id: noteId, userId, deletedAt: null }, data: { deletedAt: new Date() } });
      if (r.count !== 1) throw BusinessException.notFound();
      await this.audit.log(
        {
          actorUserId: actor.id,
          actorRole: actor.role,
          action: 'user.note.delete',
          entityType: 'User',
          entityId: userId,
          after: { noteId, pinned: cur.pinned, bodyLength: cur.body.length },
        },
        tx,
      );
    });
  }
}
