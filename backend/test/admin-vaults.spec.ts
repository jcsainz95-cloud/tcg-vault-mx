import { AdminVaultsService } from '../src/modules/vault/admin-vaults.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';

/**
 * v1.20-master-set-everywhere (§4.20c) — GET /admin/vaults: lista de clientes CON bóveda.
 *  - valuación con la MISMA base del portafolio §3: referencia por acabado (getReferencesBatch,
 *    1 lote); pendientes EXCLUIDOS del total y CONTADOS en pendingPriceCount.
 *  - pieceCount con el filtro de status "en bóveda" (scope user_vault).
 *  - sorts normados (value_desc default | pieces_desc | name_asc), paginación, filtro q.
 *  - PII mínima: name/email; nunca CLABE/RFC/INE (el DTO no los conoce).
 */

const PIECE = (ownerUserId: string, cardId: string, finish = 'normal') => ({
  ownerUserId,
  cardId,
  productType: 'raw',
  rawCondition: 'NM',
  gradingCompany: null,
  gradeValue: null,
  finish,
});

function build(over: {
  pieces?: any[];
  users?: any[];
  refs?: Map<string, any>;
} = {}) {
  const prisma = {
    inventoryItem: { findMany: jest.fn().mockResolvedValue(over.pieces ?? []) },
    user: { findMany: jest.fn().mockResolvedValue(over.users ?? []) },
  } as unknown as PrismaService;
  const pricing = {
    gradeKeyFor: jest.fn().mockReturnValue('raw_NM'),
    getReferencesBatch: jest.fn().mockResolvedValue(over.refs ?? new Map()),
  } as unknown as PricingService;
  return { prisma, pricing, svc: new AdminVaultsService(prisma, pricing) };
}

describe('AdminVaultsService.list — valuación de portafolio + sorts (§4.20c)', () => {
  const USERS = [
    { id: 'u1', name: 'Ana', email: 'ana@x.mx' },
    { id: 'u2', name: 'Beto', email: 'beto@x.mx' },
  ];

  it('suma la referencia POR ACABADO de cada pieza; pendientes excluidos y contados', async () => {
    const refs = new Map<string, any>([
      ['c1|raw|raw_NM|normal', { status: 'priced', referenceMxnCents: 10000 }],
      ['c1|raw|raw_NM|reverse_holo', { status: 'priced', referenceMxnCents: 25000 }],
      // c2 sin referencia → pendiente.
    ]);
    const { prisma, pricing, svc } = build({
      pieces: [
        PIECE('u1', 'c1', 'normal'),
        PIECE('u1', 'c1', 'reverse_holo'),
        PIECE('u1', 'c2'), // pendiente
        PIECE('u2', 'c1', 'normal'),
      ],
      users: USERS,
      refs,
    });

    const res = await svc.list({ page: 1, pageSize: 20, sort: 'value_desc' });

    const u1 = res.data.find((r) => r.userId === 'u1')!;
    expect(u1).toEqual({
      userId: 'u1',
      name: 'Ana',
      email: 'ana@x.mx',
      pieceCount: 3,
      totalValueMxnCents: 35000, // 10000 + 25000; el pendiente NO suma
      pendingPriceCount: 1,
    });
    const u2 = res.data.find((r) => r.userId === 'u2')!;
    expect(u2.pieceCount).toBe(1);
    expect(u2.totalValueMxnCents).toBe(10000);

    // value_desc default: Ana (35000) antes que Beto (10000).
    expect(res.data.map((r) => r.userId)).toEqual(['u1', 'u2']);
    expect(res.total).toBe(2);

    // El filtro de piezas es el de "en bóveda" (mismo del scope user_vault) y SOLO clientes.
    const where = (prisma.inventoryItem.findMany as jest.Mock).mock.calls[0][0].where;
    expect(where.ownerType).toBe('customer');
    expect(where.status).toEqual({
      notIn: ['withdrawn', 'shipped', 'delivered', 'lost', 'damaged'],
    });
    // Valuación en LOTE (una llamada), no una query por pieza/usuario.
    expect((pricing.getReferencesBatch as jest.Mock).mock.calls).toHaveLength(1);
    expect((prisma.inventoryItem.findMany as jest.Mock).mock.calls).toHaveLength(1);
    expect((prisma.user.findMany as jest.Mock).mock.calls).toHaveLength(1);
  });

  it('sort=pieces_desc y sort=name_asc', async () => {
    const refs = new Map<string, any>([
      ['c1|raw|raw_NM|normal', { status: 'priced', referenceMxnCents: 10000 }],
    ]);
    const pieces = [
      PIECE('u1', 'c1'),
      PIECE('u2', 'c1'),
      PIECE('u2', 'c1'),
    ];
    {
      const { svc } = build({ pieces, users: USERS, refs });
      const res = await svc.list({ page: 1, pageSize: 20, sort: 'pieces_desc' });
      expect(res.data.map((r) => r.userId)).toEqual(['u2', 'u1']);
    }
    {
      const { svc } = build({ pieces, users: USERS, refs });
      const res = await svc.list({ page: 1, pageSize: 20, sort: 'name_asc' });
      expect(res.data.map((r) => r.name)).toEqual(['Ana', 'Beto']);
    }
  });

  it('sin piezas de clientes → página vacía (y sin llamadas de valuación)', async () => {
    const { pricing, svc } = build({ pieces: [] });
    const res = await svc.list({ page: 1, pageSize: 20, sort: 'value_desc' });
    expect(res).toEqual({ data: [], page: 1, pageSize: 20, total: 0 });
    expect((pricing.getReferencesBatch as jest.Mock).mock.calls).toHaveLength(0);
  });

  it('el filtro q se aplica sobre name/email (usuarios fuera del filtro no aparecen)', async () => {
    const { prisma, svc } = build({
      pieces: [PIECE('u1', 'c1'), PIECE('u2', 'c1')],
      users: [USERS[0]], // el user.findMany (con q) solo devuelve a Ana
      refs: new Map(),
    });
    const res = await svc.list({ q: 'ana', page: 1, pageSize: 20, sort: 'value_desc' });
    expect(res.data.map((r) => r.userId)).toEqual(['u1']);
    const where = (prisma.user.findMany as jest.Mock).mock.calls[0][0].where;
    expect(where.OR).toEqual([
      { name: { contains: 'ana', mode: 'insensitive' } },
      { email: { contains: 'ana', mode: 'insensitive' } },
    ]);
  });

  it('PII mínima: el DTO expone name/email y agregados — nunca CLABE/RFC/INE ni folios', async () => {
    const { svc } = build({
      pieces: [PIECE('u1', 'c1')],
      users: [USERS[0]],
      refs: new Map(),
    });
    const res = await svc.list({ page: 1, pageSize: 20, sort: 'value_desc' });
    expect(Object.keys(res.data[0]).sort()).toEqual(
      ['email', 'name', 'pendingPriceCount', 'pieceCount', 'totalValueMxnCents', 'userId'].sort(),
    );
  });
});
