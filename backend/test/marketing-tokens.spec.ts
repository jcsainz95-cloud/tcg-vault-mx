/**
 * 🔒 CANDADO — acceso del analista: emitir / listar / revocar el token `marketing-reader`
 * (API_CONTRACT §MKT.G.6, §MKT.G.9 (4)(5); D-MKT-PANEL-3; cierra MKT-TL4).
 *
 * Sin Postgres: una BD EN MEMORIA modela `MarketingApiToken` + `AuditLog` + `$transaction`, y por encima corren
 * los objetos REALES: `MarketingTokensController` → `MarketingTokenAdminService` (emitir/revocar) y
 * `MarketingApiTokenGuard` → `MarketingTokenService.verify` (la puerta de `aggregates`). Ambos lados leen la
 * MISMA fila, como en producción. La versión por HTTP contra Postgres vive en
 * `test/integration/marketing-panel.e2e-spec.ts`.
 *
 * | §MKT.G.9 | Qué fija |
 * |---|---|
 * | 4 | emitir ⇒ el guard de `aggregates` deja pasar ⇒ revocar ⇒ el guard da 401, en el mismo proceso, sin reiniciar |
 * | 5 | ni `GET …/tokens` ni `…/revoke` ni la fila de `AuditLog` llevan `token`/`tokenHash` (ni el claro, ni el hash) |
 *
 * Y además: revocación idempotente (mismo `revokedAt`, sin 2ª bitácora); 404 en id inexistente; `label` inválido
 * ⇒ 422 con `details.field='label'`; `status` revoked/expired/active; caducidad a 12 meses.
 */
import { randomUUID } from 'crypto';
import { MarketingTokensController } from '../src/modules/marketing/marketing-tokens.controller';
import { MarketingTokenAdminService } from '../src/modules/marketing/marketing-token-admin.service';
import { MarketingTokenService } from '../src/modules/marketing/marketing-token.service';
import { MarketingApiTokenGuard } from '../src/modules/marketing/marketing-token.guard';
import { AuditService } from '../src/modules/audit/audit.service';
import { hashToken } from '../src/modules/marketing/token-crypto';

interface TokenRow {
  id: string;
  label: string;
  tokenHash: string;
  createdByUserId: string | null;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  revokedByUserId: string | null;
  lastUsedAt: Date | null;
}

/** Proyección `select` de Prisma sobre una fila en memoria. */
const pick = (row: Record<string, unknown>, select?: Record<string, boolean>) => {
  if (!select) return { ...row };
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(select)) if (v) out[k] = row[k];
  return out;
};

const matches = (row: TokenRow, where: Record<string, unknown>): boolean =>
  Object.entries(where).every(([k, v]) => (row as unknown as Record<string, unknown>)[k] === v);

/** BD en memoria: lo justo que usan el servicio de emisión/revocación, `verify()` y `AuditService.log`. */
function memoryDb() {
  const tokens: TokenRow[] = [];
  const audit: Record<string, unknown>[] = [];
  const db: any = {
    tokens,
    audit,
    marketingApiToken: {
      create: jest.fn(async ({ data, select }: any) => {
        const row: TokenRow = {
          id: randomUUID(),
          createdByUserId: null,
          createdAt: new Date(),
          revokedAt: null,
          revokedByUserId: null,
          lastUsedAt: null,
          ...data,
        };
        tokens.push(row);
        return pick(row as never, select);
      }),
      findUnique: jest.fn(async ({ where, select }: any) => {
        const row = tokens.find((t) => matches(t, where));
        return row ? pick(row as never, select) : null;
      }),
      findMany: jest.fn(async ({ select, orderBy }: any) => {
        const rows = [...tokens];
        if (orderBy?.createdAt === 'desc') rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return rows.map((r) => pick(r as never, select));
      }),
      update: jest.fn(async ({ where, data, select }: any) => {
        const row = tokens.find((t) => matches(t, where));
        if (!row) throw new Error('P2025');
        Object.assign(row, data);
        return pick(row as never, select);
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const rows = tokens.filter((t) => matches(t, where));
        for (const r of rows) Object.assign(r, data);
        return { count: rows.length };
      }),
    },
    auditLog: {
      create: jest.fn(async ({ data }: any) => {
        audit.push({ ...data });
        return data;
      }),
    },
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(db)),
  };
  return db;
}

function build() {
  const db = memoryDb();
  const auditSvc = new AuditService(db);
  const admin = new MarketingTokenAdminService(db, auditSvc);
  const ctrl = new MarketingTokensController(admin);
  const verifier = new MarketingTokenService(db);
  const guard = new MarketingApiTokenGuard(verifier);
  /** Lo que haría `GET …/aggregates` con ese bearer: correr el guard. */
  const callAggregates = async (bearer: string) => {
    const req: Record<string, unknown> = { headers: { authorization: `Bearer ${bearer}` }, ip: '203.0.113.7' };
    const ctx = { switchToHttp: () => ({ getRequest: () => req }) } as never;
    return guard.canActivate(ctx);
  };
  return { db, ctrl, callAggregates };
}

const OWNER = { id: 'u-owner', role: 'super_admin' as const };

/** Todas las claves de un valor JSON, a cualquier profundidad. */
function allKeys(v: unknown, acc: string[] = []): string[] {
  if (Array.isArray(v)) v.forEach((x) => allKeys(x, acc));
  else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      acc.push(k);
      allKeys(x, acc);
    }
  }
  return acc;
}

describe('§MKT.G.9 (4) — revocar sin desplegar: emitir ⇒ 200 ⇒ revocar ⇒ 401, mismo proceso', () => {
  it('el token emitido abre aggregates; tras revocar, la SIGUIENTE llamada da 401 UNAUTHENTICATED', async () => {
    const { ctrl, callAggregates } = build();
    const issued = await ctrl.issue(OWNER, { label: 'analista marketing' }, '198.51.100.1');
    expect(typeof issued.token).toBe('string');
    await expect(callAggregates(issued.token)).resolves.toBe(true);

    const view = await ctrl.revoke(OWNER, issued.id, '198.51.100.1');
    expect(view.status).toBe('revoked');

    await expect(callAggregates(issued.token)).rejects.toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });
  });

  it('revocar uno no toca a otro token activo', async () => {
    const { ctrl, callAggregates } = build();
    const a = await ctrl.issue(OWNER, { label: 'uno' }, '198.51.100.1');
    const b = await ctrl.issue(OWNER, { label: 'dos' }, '198.51.100.1');
    await ctrl.revoke(OWNER, a.id, '198.51.100.1');
    await expect(callAggregates(a.token)).rejects.toMatchObject({ status: 401 });
    await expect(callAggregates(b.token)).resolves.toBe(true);
  });
});

describe('§MKT.G.9 (5) — el claro viaja UNA vez', () => {
  it('POST trae {id,label,token,createdAt,expiresAt}; GET, revoke y AuditLog no traen token/tokenHash ni el valor', async () => {
    const { ctrl, db } = build();
    const issued = await ctrl.issue(OWNER, { label: 'analista' }, '198.51.100.1');
    expect(Object.keys(issued).sort()).toEqual(['createdAt', 'expiresAt', 'id', 'label', 'token']);
    const hash = hashToken(issued.token);

    const list = await ctrl.list();
    const revoked = await ctrl.revoke(OWNER, issued.id, '198.51.100.1');

    for (const [nombre, json] of [
      ['GET …/tokens', list],
      ['POST …/revoke', revoked],
      ['AuditLog', db.audit],
    ] as const) {
      const keys = allKeys(JSON.parse(JSON.stringify(json)));
      expect({ nombre, token: keys.includes('token'), tokenHash: keys.includes('tokenHash') }).toEqual({ nombre, token: false, tokenHash: false });
      const s = JSON.stringify(json);
      expect(s.includes(issued.token)).toBe(false);
      expect(s.includes(hash)).toBe(false);
      // ⛔ ni un prefijo del claro.
      expect(s.includes(issued.token.slice(0, 12))).toBe(false);
    }
  });

  it('bitácora: marketing.token.issue {label, expiresAt} y marketing.token.revoke {revokedAt}, con actor e ip', async () => {
    const { ctrl, db } = build();
    const issued = await ctrl.issue(OWNER, { label: 'analista' }, '198.51.100.1');
    await ctrl.revoke(OWNER, issued.id, '198.51.100.2');
    expect(db.audit).toEqual([
      expect.objectContaining({
        action: 'marketing.token.issue',
        entityType: 'MarketingApiToken',
        entityId: issued.id,
        actorUserId: 'u-owner',
        actorRole: 'super_admin',
        ip: '198.51.100.1',
        after: { label: 'analista', expiresAt: issued.expiresAt },
      }),
      expect.objectContaining({
        action: 'marketing.token.revoke',
        entityType: 'MarketingApiToken',
        entityId: issued.id,
        ip: '198.51.100.2',
        after: { revokedAt: expect.any(String) },
      }),
    ]);
  });
});

describe('§MKT.G.6 — forma, idempotencia y errores', () => {
  it('caduca a los 12 meses; la vista lista trae los campos del contrato y status active', async () => {
    const { ctrl } = build();
    const issued = await ctrl.issue(OWNER, { label: '  analista  ' }, '198.51.100.1');
    expect(issued.label).toBe('analista'); // recortado
    const ms = Date.parse(issued.expiresAt) - Date.parse(issued.createdAt);
    expect(Math.round(ms / 86_400_000)).toBe(365);
    const { items } = await ctrl.list();
    expect(items).toHaveLength(1);
    expect(Object.keys(items[0]).sort()).toEqual(
      ['createdAt', 'createdByUserId', 'expiresAt', 'id', 'label', 'lastUsedAt', 'revokedAt', 'revokedByUserId', 'status'].sort(),
    );
    expect(items[0]).toMatchObject({ status: 'active', createdByUserId: 'u-owner', revokedAt: null });
  });

  it('lista del más nuevo al más viejo; status expired si expiresAt ≤ ahora', async () => {
    const { ctrl, db } = build();
    const viejo = await ctrl.issue(OWNER, { label: 'viejo' }, '198.51.100.1');
    const fila = db.tokens.find((t: TokenRow) => t.id === viejo.id);
    fila.createdAt = new Date('2025-01-01T00:00:00Z');
    fila.expiresAt = new Date('2026-01-01T00:00:00Z');
    const nuevo = await ctrl.issue(OWNER, { label: 'nuevo' }, '198.51.100.1');
    const { items } = await ctrl.list();
    expect(items.map((i) => i.id)).toEqual([nuevo.id, viejo.id]);
    expect(items[1].status).toBe('expired');
  });

  it('revocar es idempotente: 200 con el MISMO revokedAt y sin segunda bitácora', async () => {
    const { ctrl, db } = build();
    const issued = await ctrl.issue(OWNER, { label: 'analista' }, '198.51.100.1');
    const r1 = await ctrl.revoke(OWNER, issued.id, '198.51.100.1');
    const r2 = await ctrl.revoke({ id: 'otra-cuenta', role: 'super_admin' }, issued.id, '198.51.100.9');
    expect(r2.revokedAt).toBe(r1.revokedAt);
    expect(r2.revokedByUserId).toBe('u-owner');
    expect(db.audit.filter((a: { action: string }) => a.action === 'marketing.token.revoke')).toHaveLength(1);
  });

  it('id inexistente ⇒ 404 NOT_FOUND', async () => {
    const { ctrl } = build();
    await expect(ctrl.revoke(OWNER, randomUUID(), '198.51.100.1')).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
  });

  it.each([
    ['vacío', ''],
    ['solo espacios', '   '],
    ['61 caracteres', 'a'.repeat(61)],
    ['carácter fuera de lista (@)', 'ana@tienda'],
    ['carácter fuera de lista (<)', '<script>'],
    ['racha de 7 dígitos', 'tel 5512345'],
    ['no es texto', 42],
    ['ausente', undefined],
  ])('label %s ⇒ 422 VALIDATION_ERROR con details.field=label y no crea nada', async (_n, label) => {
    const { ctrl, db } = build();
    await expect(ctrl.issue(OWNER, { label } as never, '198.51.100.1')).rejects.toMatchObject({
      status: 422,
      code: 'VALIDATION_ERROR',
      details: { field: 'label' },
    });
    expect(db.tokens).toHaveLength(0);
    expect(db.audit).toHaveLength(0);
  });

  it('si la bitácora falla, el token NO queda emitido (misma transacción)', async () => {
    const { ctrl, db } = build();
    const tokensAntes: TokenRow[] = [];
    db.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const snapshot = [...db.tokens];
      try {
        return await fn(db);
      } catch (e) {
        db.tokens.splice(0, db.tokens.length, ...snapshot);
        throw e;
      }
    });
    db.auditLog.create.mockRejectedValueOnce(new Error('audit down'));
    await expect(ctrl.issue(OWNER, { label: 'analista' }, '198.51.100.1')).rejects.toThrow('audit down');
    expect(db.tokens).toEqual(tokensAntes);
    expect(db.$transaction).toHaveBeenCalled();
  });
});
