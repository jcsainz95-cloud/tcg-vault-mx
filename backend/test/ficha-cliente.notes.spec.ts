/**
 * §FICHA-CLIENTE §1b — `CustomerNotesService` (unitario, Prisma en memoria): roles, límites, idempotencia, auditoría sin texto.
 * La contraparte contra Postgres real está en `test/integration/ficha-cliente.e2e-spec.ts`.
 */
import { Role } from '@prisma/client';
import { CustomerNotesService, NOTE_MAX_PER_CUSTOMER } from '../src/modules/admin/customer-notes.service';

type Row = { id: string; userId: string; authorId: string | null; body: string; pinned: boolean; clientRequestId: string | null; createdAt: Date; updatedAt: Date; deletedAt: Date | null };

function fake() {
  const rows: Row[] = [];
  const audit: any[] = [];
  let seq = 0;
  const match = (r: Row, w: any) =>
    Object.entries(w ?? {}).every(([k, v]) => (v === null ? (r as any)[k] === null : (r as any)[k] === v));
  const withAuthor = (r: Row) => ({ ...r, author: r.authorId ? { name: `Autor ${r.authorId}` } : null });
  const note = {
    findFirst: jest.fn(async ({ where }: any) => {
      const r = rows.find((x) => match(x, where));
      return r ? withAuthor(r) : null;
    }),
    findMany: jest.fn(async () => rows.map(withAuthor)),
    count: jest.fn(async ({ where }: any) => rows.filter((x) => match(x, where)).length),
    create: jest.fn(async ({ data }: any) => {
      if (data.clientRequestId && rows.some((x) => x.authorId === data.authorId && x.clientRequestId === data.clientRequestId)) {
        const { Prisma } = jest.requireActual('@prisma/client');
        throw new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' });
      }
      const r: Row = { id: `n${(seq += 1)}`, deletedAt: null, ...data };
      rows.push(r);
      return withAuthor(r);
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const r = rows.find((x) => x.id === where.id)!;
      Object.assign(r, data);
      return withAuthor(r);
    }),
    updateMany: jest.fn(async ({ where, data }: any) => {
      const hit = rows.filter((x) => match(x, where));
      hit.forEach((r) => Object.assign(r, data));
      return { count: hit.length };
    }),
  };
  const tx = { customerNote: note, $executeRaw: jest.fn(async () => 1) };
  const prisma: any = {
    user: { findUnique: jest.fn(async ({ where }: any) => (where.id === 'ghost' ? null : where.id === 'sup' ? { role: 'supplier' } : { role: 'customer' })) },
    customerNote: note,
    $transaction: jest.fn(async (fn: any) => fn(tx)),
  };
  const auditSvc: any = { log: jest.fn(async (e: any) => void audit.push(e)) };
  return { svc: new CustomerNotesService(prisma, auditSvc), rows, audit, prisma, note };
}
const op = { id: 'op1', role: Role.vault_operator };
const op2 = { id: 'op2', role: Role.vault_operator };
const sup = { id: 'sa', role: Role.super_admin };

describe('CustomerNotesService', () => {
  it('cuerpo: se recorta; vacío/1001/no-texto ⇒ 400 y NO escribe', async () => {
    const f = fake();
    expect((await f.svc.create('c1', op, { body: '  hola  ' })).note.body).toBe('hola');
    for (const body of ['', '   ', 'x'.repeat(1001), 7 as any, undefined as any]) {
      await expect(f.svc.create('c1', op, { body })).rejects.toMatchObject({ status: 400 });
    }
    await expect(f.svc.create('c1', op, { body: 'x'.repeat(1000) })).resolves.toBeDefined();
    expect(f.rows).toHaveLength(2);
  });

  it('cliente inexistente o proveedor ⇒ 404 en las 4 operaciones', async () => {
    const f = fake();
    for (const id of ['ghost', 'sup']) {
      await expect(f.svc.list(id, op, {})).rejects.toMatchObject({ status: 404 });
      await expect(f.svc.create(id, op, { body: 'x' })).rejects.toMatchObject({ status: 404 });
      await expect(f.svc.update(id, 'n1', op, { pinned: true })).rejects.toMatchObject({ status: 404 });
      await expect(f.svc.remove(id, 'n1', op)).rejects.toMatchObject({ status: 404 });
    }
  });

  it('tope: a la nota 201 ⇒ 409 NOTE_LIMIT y no escribe ni audita', async () => {
    const f = fake();
    for (let i = 0; i < NOTE_MAX_PER_CUSTOMER; i += 1) f.rows.push({ id: `p${i}`, userId: 'c1', authorId: 'op1', body: 'x', pinned: false, clientRequestId: null, createdAt: new Date(), updatedAt: new Date(), deletedAt: null });
    await expect(f.svc.create('c1', op, { body: 'una más' })).rejects.toMatchObject({ status: 409, code: 'NOTE_LIMIT' });
    expect(f.rows).toHaveLength(NOTE_MAX_PER_CUSTOMER);
    expect(f.audit).toHaveLength(0);
    // las borradas no cuentan
    f.rows[0].deletedAt = new Date();
    await expect(f.svc.create('c1', op, { body: 'ya cabe' })).resolves.toMatchObject({ created: true });
  });

  it('clientRequestId repetido ⇒ la misma nota, created=false, una fila y una sola auditoría', async () => {
    const f = fake();
    const a = await f.svc.create('c1', op, { body: 'x', clientRequestId: 'r1' });
    const b = await f.svc.create('c1', op, { body: 'x', clientRequestId: 'r1' });
    expect([a.created, b.created]).toEqual([true, false]);
    expect(b.note.id).toBe(a.note.id);
    expect(f.rows).toHaveLength(1);
    expect(f.audit).toHaveLength(1);
    // misma llave en OTRO cliente ⇒ 409, no se reutiliza
    await expect(f.svc.create('c2', op, { body: 'x', clientRequestId: 'r1' })).rejects.toMatchObject({ status: 409 });
  });

  it('PATCH body: autor y súper-admin sí; otro operador ⇒ 403; pinned: cualquiera', async () => {
    const f = fake();
    const n = (await f.svc.create('c1', op, { body: 'mía' })).note;
    await expect(f.svc.update('c1', n.id, op2, { body: 'ajena' })).rejects.toMatchObject({ status: 403 });
    expect(f.rows[0].body).toBe('mía');
    expect((await f.svc.update('c1', n.id, op2, { pinned: true })).pinned).toBe(true);
    expect((await f.svc.update('c1', n.id, op, { body: 'editada' })).edited).toBe(true);
    expect((await f.svc.update('c1', n.id, sup, { body: 'del súper' })).body).toBe('del súper');
  });

  it('nota sin autor (cuenta del autor borrada): el operador no la edita; el súper sí', async () => {
    const f = fake();
    const n = (await f.svc.create('c1', op, { body: 'huérfana' })).note;
    f.rows[0].authorId = null;
    await expect(f.svc.update('c1', n.id, op, { body: 'x' })).rejects.toMatchObject({ status: 403 });
    await expect(f.svc.remove('c1', n.id, op)).rejects.toMatchObject({ status: 403 });
    await expect(f.svc.remove('c1', n.id, sup)).resolves.toBeUndefined();
  });

  it('IDOR: la nota de c1 por la ruta de c2 ⇒ 404 (editar, fijar y borrar)', async () => {
    const f = fake();
    const n = (await f.svc.create('c1', op, { body: 'x' })).note;
    await expect(f.svc.update('c2', n.id, sup, { pinned: true })).rejects.toMatchObject({ status: 404 });
    await expect(f.svc.update('c2', n.id, sup, { body: 'y' })).rejects.toMatchObject({ status: 404 });
    await expect(f.svc.remove('c2', n.id, sup)).rejects.toMatchObject({ status: 404 });
    expect(f.rows[0]).toMatchObject({ body: 'x', deletedAt: null });
  });

  it('borrado lógico: la fila queda con deletedAt; segundo borrado ⇒ 404', async () => {
    const f = fake();
    const n = (await f.svc.create('c1', op, { body: 'x' })).note;
    await f.svc.remove('c1', n.id, op);
    expect(f.rows[0].deletedAt).toBeInstanceOf(Date);
    await expect(f.svc.remove('c1', n.id, sup)).rejects.toMatchObject({ status: 404 });
  });

  it('auditoría: user.note.create|update|pin|delete con {noteId,pinned,bodyLength} y SIN texto, en la misma transacción', async () => {
    const f = fake();
    const secret = 'TEXTO-SECRETO-EN-LA-NOTA';
    const n = (await f.svc.create('c1', op, { body: secret })).note;
    await f.svc.update('c1', n.id, op, { body: `${secret} v2`, pinned: true });
    await f.svc.remove('c1', n.id, op);
    expect(f.audit.map((a) => a.action)).toEqual(['user.note.create', 'user.note.update', 'user.note.pin', 'user.note.delete']);
    for (const a of f.audit) {
      expect(a).toMatchObject({ entityType: 'User', entityId: 'c1', actorUserId: 'op1' });
      expect(Object.keys(a.after).sort()).toEqual(['bodyLength', 'noteId', 'pinned']);
      expect(JSON.stringify(a)).not.toContain('SECRETO');
    }
    expect(f.audit[0].after.bodyLength).toBe(secret.length);
    // el 2º argumento de `audit.log` es el `tx` ⇒ participa del mismo commit/rollback
    const f2 = fake();
    const logSpy = (f2.svc as any).audit.log as jest.Mock;
    await f2.svc.create('c1', op, { body: 'x' });
    expect(logSpy.mock.calls[0][1]).toBeDefined();
  });

  it('si la bitácora falla, la nota NO queda (falla cerrado: lo decide la transacción)', async () => {
    const f = fake();
    (f.svc as any).audit.log = jest.fn(async () => {
      throw new Error('audit down');
    });
    // el `$transaction` falso no revierte; basta comprobar que el error se propaga (el real lo revierte)
    await expect(f.svc.create('c1', op, { body: 'x' })).rejects.toThrow('audit down');
  });

  it('canEdit lo calcula el servidor: autor o súper-admin', async () => {
    const f = fake();
    await f.svc.create('c1', op, { body: 'x' });
    expect((await f.svc.list('c1', op, {})).items[0].canEdit).toBe(true);
    expect((await f.svc.list('c1', op2, {})).items[0].canEdit).toBe(false);
    expect((await f.svc.list('c1', sup, {})).items[0].canEdit).toBe(true);
  });

  it('list: limit/cursor inválidos ⇒ 400', async () => {
    const f = fake();
    for (const q of [{ limit: '0' }, { limit: '51' }, { limit: 'x' }, { cursor: 'no-uuid' }]) {
      await expect(f.svc.list('c1', op, q)).rejects.toMatchObject({ status: 400 });
    }
  });
});
