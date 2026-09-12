import { KycStatus, Role, UserStatus } from '@prisma/client';
import { AdminUsersController } from '../src/modules/admin/admin.controller';
import { AdminService } from '../src/modules/admin/admin.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';
import { UploadsService } from '../src/modules/uploads/uploads.service';
import { BusinessException } from '../src/common/business.exception';

/**
 * `A5` · API_CONTRACT §M6-L · ARCHITECTURE §4.53 — **el estado de identidad en el listado y su
 * filtro, sobre el `where` que de verdad se manda a Prisma.**
 *
 * ### Lo que este fichero mide y la suite de integración no puede
 * Aquí se **observa el `where`**: si alguien implementa el caso `none` con un segundo `where.OR`, la
 * respuesta HTTP sigue siendo un `200` con filas — solo que **el buscador desapareció**. Ese daño es
 * invisible desde fuera salvo que se siembre el caso exacto; desde dentro es una aserción de una
 * línea. Los dos ficheros son complementarios, no redundantes:
 *   · aquí: la FORMA del `where`, la lista blanca del `select` y la derivación `?? 'none'`;
 *   · `test/integration/admin-users-kyc-queue.e2e-spec.ts`: los candados `L-1…L-6` por HTTP real.
 *
 * ### La medición que motivó la ficha (2026-09-12, app real + Postgres real)
 * | Petición | Antes de `A5` | Ahora |
 * |---|---|---|
 * | `?kycStatus=pending` | `200`, `total` == el del listado **sin filtro** (cola falsa) | filtra |
 * | `?status=banana` | **`500 INTERNAL`** (`PrismaClientValidationError` escapando) | `400` |
 * | `?zzz=1` | `200`, ignorado en silencio | `400` |
 */

type FoundArgs = {
  where: Record<string, any>;
  select: Record<string, any>;
  skip: number;
  take: number;
  orderBy: Record<string, string>;
};

function build(rows: any[] = []) {
  const findMany = jest.fn(async (_args: FoundArgs) => rows);
  const count = jest.fn(async (_args: { where: Record<string, any> }) => rows.length);
  const prisma = { user: { findMany, count } } as unknown as PrismaService;
  const admin = new AdminService(prisma, {} as PricingService, {} as PiiCryptoService, {} as UploadsService);
  const ctrl = new AdminUsersController(admin, {} as AuditService);
  return { ctrl, findMany, count };
}

const argsOf = (findMany: jest.Mock): FoundArgs => findMany.mock.calls[0][0];
const whereOf = (findMany: jest.Mock) => argsOf(findMany).where;

/** El error tal como lo verá el operador: código, status y `details.field`. */
async function capture(fn: () => unknown): Promise<BusinessException> {
  try {
    await fn();
  } catch (e) {
    return e as BusinessException;
  }
  throw new Error('se esperaba un BusinessException y no hubo ninguno');
}

describe('§M6-L.1 — `kycStatus` viaja en cada fila, SIEMPRE con valor', () => {
  it('sin fila en `KycProfile` ⇒ `none` (⛔ ni `null` ni clave omitida)', async () => {
    const { ctrl } = build([
      { id: 'u1', email: 'a@x.mx', name: 'A', role: Role.customer, status: UserStatus.active, createdAt: new Date(0), kycProfile: null },
      { id: 'u2', email: 'b@x.mx', name: 'B', role: Role.customer, status: UserStatus.active, createdAt: new Date(0), kycProfile: { kycStatus: KycStatus.pending } },
    ]);
    const res: any = await ctrl.list({});
    expect(res.data[0].kycStatus).toBe('none');
    expect(res.data[1].kycStatus).toBe('pending');
    for (const row of res.data) {
      expect(Object.prototype.hasOwnProperty.call(row, 'kycStatus')).toBe(true);
      expect(row.kycStatus).not.toBeNull();
    }
  });

  it('la fila es EXACTAMENTE `AdminUserSummaryDTO`: siete claves, ni una más', async () => {
    const { ctrl } = build([
      { id: 'u1', email: 'a@x.mx', name: 'A', role: Role.customer, status: UserStatus.active, createdAt: new Date(0), kycProfile: { kycStatus: KycStatus.verified } },
    ]);
    const res: any = await ctrl.list({});
    expect(Object.keys(res.data[0]).sort()).toEqual(
      ['createdAt', 'email', 'id', 'kycStatus', 'name', 'role', 'status'].sort(),
    );
    // ⛔ `kycProfile` NO se reenvía crudo: viaja el ESTADO, nunca el objeto de identidad.
    expect(res.data[0]).not.toHaveProperty('kycProfile');
  });

  it('⭐ el `select` es LISTA BLANCA: de `KycProfile` sale `kycStatus` y NADA más (`L-6`, `K-2`)', async () => {
    const { ctrl, findMany } = build();
    await ctrl.list({});
    const select = argsOf(findMany).select;
    expect(Object.keys(select.kycProfile.select)).toEqual(['kycStatus']);
    // Los «no» enumerados por §M6-L.1, comprobados sobre el select real (lo que no está, no se lee).
    for (const prohibido of ['rejectionReason', 'ineFrontKey', 'ineBackKey', 'clabeEnc', 'rfcEnc', 'clabeHmac', 'legalName']) {
      expect(select.kycProfile.select).not.toHaveProperty(prohibido);
    }
    for (const prohibido of ['passwordHash', 'tokenVersion', 'googleId', 'phone', 'updatedAt', 'nameSource']) {
      expect(select).not.toHaveProperty(prohibido);
    }
  });
});

describe('§M6-L.3 — el `where` se arma como `AND: [...]` (candado `L-3`)', () => {
  it('⭐⭐ `q` + `kycStatus=none` es INTERSECCIÓN: DOS cláusulas en el AND, y ningún `OR` en la raíz', async () => {
    const { ctrl, findMany } = build();
    await ctrl.list({ q: 'ana', kycStatus: 'none' });
    const where = whereOf(findMany);

    // La aserción que caza la trampa: si el caso `none` se hubiera implementado con un segundo
    // `where.OR`, el `OR` del buscador estaría PISADO y aquí solo quedaría una cláusula.
    expect(where.AND).toHaveLength(2);
    expect(where).not.toHaveProperty('OR');
    expect(where.AND).toEqual([
      { OR: [{ email: { contains: 'ana', mode: 'insensitive' } }, { name: { contains: 'ana', mode: 'insensitive' } }] },
      { OR: [{ kycProfile: { is: null } }, { kycProfile: { is: { kycStatus: 'none' } } }] },
    ]);
  });

  it('los TRES ejes a la vez ⇒ tres cláusulas (`?q=&status=&kycStatus=` combinan en AND)', async () => {
    const { ctrl, findMany } = build();
    await ctrl.list({ q: 'ana', status: 'active', kycStatus: 'pending' });
    const where = whereOf(findMany);
    expect(where.AND).toHaveLength(3);
    expect(where.AND).toContainEqual({ status: 'active' });
    expect(where.AND).toContainEqual({ kycProfile: { is: { kycStatus: 'pending' } } });
    expect(where).not.toHaveProperty('OR');
    expect(where).not.toHaveProperty('status');
  });

  it('`none` incluye al usuario SIN FILA y al que tiene fila en `none` (la contrapartida de `?? none`)', async () => {
    const { ctrl, findMany } = build();
    await ctrl.list({ kycStatus: 'none' });
    expect(whereOf(findMany).AND).toEqual([
      { OR: [{ kycProfile: { is: null } }, { kycProfile: { is: { kycStatus: 'none' } } }] },
    ]);
  });

  it('los otros tres valores NO miran la ausencia de fila (un `pending` tiene fila por definición)', async () => {
    for (const value of ['pending', 'verified', 'rejected']) {
      const { ctrl, findMany } = build();
      await ctrl.list({ kycStatus: value });
      expect(whereOf(findMany).AND).toEqual([{ kycProfile: { is: { kycStatus: value } } }]);
    }
  });

  it('el `where` del `count` es EL MISMO que el del `findMany` (si no, `total` mentiría)', async () => {
    const { ctrl, findMany, count } = build();
    await ctrl.list({ q: 'ana', kycStatus: 'none' });
    expect(count.mock.calls[0][0].where).toEqual(whereOf(findMany));
  });

  it('sin filtros el `where` queda VACÍO (el padrón entero, conducta de siempre)', async () => {
    const { ctrl, findMany } = build();
    await ctrl.list({});
    expect(whereOf(findMany)).toEqual({});
  });

  it('cadena vacía ≡ ausente: `?kycStatus=` y `?status=` NO filtran (el `Select` en «Todas»)', async () => {
    const { ctrl, findMany } = build();
    await ctrl.list({ kycStatus: '', status: '', q: '' });
    expect(whereOf(findMany)).toEqual({});
  });

  it('⛔ el orden NO cambia en `A5`: sigue `createdAt desc` (la cola ordenada es `A5-b`/`M-56`)', async () => {
    const { ctrl, findMany } = build();
    await ctrl.list({ kycStatus: 'pending' });
    expect(argsOf(findMany).orderBy).toEqual({ createdAt: 'desc' });
  });
});

describe('§M6-L.3/L.4 — un valor fuera del enum es `400`, jamás una lista sin filtrar (`L-4`, `L-5`)', () => {
  it('`?kycStatus=banana` ⇒ 400 VALIDATION_ERROR con `details.field=kycStatus` y NO consulta la BD', async () => {
    const { ctrl, findMany } = build();
    const err = await capture(() => ctrl.list({ kycStatus: 'banana' }));
    expect(err.getStatus()).toBe(400);
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.details).toMatchObject({ field: 'kycStatus', allowed: ['none', 'pending', 'verified', 'rejected'] });
    expect(findMany).not.toHaveBeenCalled();
  });

  it('⭐ `?status=banana` ⇒ 400 (antes de `A5` era un **500 INTERNAL** medido: `D-A5-2`/`N-A5-1`)', async () => {
    const { ctrl, findMany } = build();
    const err = await capture(() => ctrl.list({ status: 'banana' }));
    expect(err.getStatus()).toBe(400);
    expect(err.details).toMatchObject({ field: 'status', allowed: ['active', 'blocked', 'deleted'] });
    expect(findMany).not.toHaveBeenCalled();
  });

  it('⭐ los dos ejes son DISJUNTOS y el `400` dice cuál falló (`L-5`: por eso no hace falta renombrarlos)', async () => {
    const cruzado = await capture(() => build().ctrl.list({ status: 'pending' }));
    expect(cruzado.getStatus()).toBe(400);
    expect((cruzado.details as any).field).toBe('status');

    const alReves = await capture(() => build().ctrl.list({ kycStatus: 'active' }));
    expect(alReves.getStatus()).toBe(400);
    expect((alReves.details as any).field).toBe('kycStatus');
  });

  it('los valores admitidos se DERIVAN del schema (⛔ ninguna lista a mano que se pueda desincronizar)', async () => {
    for (const value of Object.values(KycStatus)) {
      const { ctrl, findMany } = build();
      await ctrl.list({ kycStatus: value });
      expect(findMany).toHaveBeenCalled();
    }
    for (const value of Object.values(UserStatus)) {
      const { ctrl, findMany } = build();
      await ctrl.list({ status: value });
      expect(whereOf(findMany).AND).toEqual([{ status: value }]);
    }
  });

  it('`deleted` se admite: es un valor legal del campo y ya viaja en el DTO (§M6-L.4)', async () => {
    const { ctrl, findMany } = build();
    await ctrl.list({ status: 'deleted' });
    expect(whereOf(findMany).AND).toEqual([{ status: 'deleted' }]);
  });

  it('mayúsculas/espacios NO se «arreglan»: `Pending` es un valor distinto y cae en 400', async () => {
    for (const value of ['Pending', ' pending', 'PENDING']) {
      const err = await capture(() => build().ctrl.list({ kycStatus: value }));
      expect(err.getStatus()).toBe(400);
    }
  });
});

describe('`D-A5-3` — una query desconocida deja de ignorarse EN ESTE endpoint', () => {
  it('`?zzz=1` ⇒ 400 con `details.field=zzz` (antes: `200` con el padrón entero)', async () => {
    const { ctrl, findMany } = build();
    const err = await capture(() => ctrl.list({ zzz: '1' }));
    expect(err.getStatus()).toBe(400);
    expect(err.details).toMatchObject({ field: 'zzz' });
    expect(findMany).not.toHaveBeenCalled();
  });

  it('la lista blanca son CINCO llaves, y las cinco pasan', async () => {
    const { ctrl, findMany } = build();
    await ctrl.list({ q: 'a', status: 'active', kycStatus: 'none', page: '2', pageSize: '5' });
    expect(findMany).toHaveBeenCalled();
    expect(argsOf(findMany).skip).toBe(5);
    expect(argsOf(findMany).take).toBe(5);
  });

  it('un typo cercano NO se perdona: `kycstatus` (minúscula) es 400, no un filtro que se cae', async () => {
    const err = await capture(() => build().ctrl.list({ kycstatus: 'pending' }));
    expect(err.getStatus()).toBe(400);
    expect((err.details as any).field).toBe('kycstatus');
  });

  it('parámetro REPETIDO (`?q=a&q=b`, que llega como array) ⇒ 400, no un descarte silencioso', async () => {
    const err = await capture(() => build().ctrl.list({ q: ['a', 'b'] as unknown as string }));
    expect(err.getStatus()).toBe(400);
    expect((err.details as any).field).toBe('q');
  });
});

describe('§M6 — la paginación publicada NO cambia (⛔ no se «arregla de paso»)', () => {
  it('defaults: `page=1`, `pageSize=20`', async () => {
    const { ctrl, findMany } = build();
    const res: any = await ctrl.list({});
    expect(argsOf(findMany)).toMatchObject({ skip: 0, take: 20 });
    expect(res).toMatchObject({ page: 1, pageSize: 20 });
  });

  it('`pageSize` fuera de rango se ACOTA a [1,100] y NO es error; `page` se normaliza a ≥ 1', async () => {
    const casos: [string, string, number, number][] = [
      // `pageSize=0` cae en el `|| 20` ANTES del acote: default, no mínimo. Es la conducta
      // publicada, medida aquí tal cual es — ⛔ no se «corrige» dentro de `A5`.
      ['0', '0', 1, 20],
      ['-3', '1000', 1, 100],
      ['no-es-un-numero', 'tampoco', 1, 20],
    ];
    for (const [page, pageSize, expPage, expSize] of casos) {
      const { ctrl, findMany } = build();
      const res: any = await ctrl.list({ page, pageSize });
      expect([res.page, res.pageSize]).toEqual([expPage, expSize]);
      expect(argsOf(findMany).take).toBe(expSize);
    }
  });
});
