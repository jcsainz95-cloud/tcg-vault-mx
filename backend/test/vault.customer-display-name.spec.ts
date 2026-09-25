import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AdminVaultsService } from '../src/modules/vault/admin-vaults.service';
import { MasterSetService } from '../src/modules/inventory/master-set.service';
import {
  compareByDisplayName,
  customerDisplayName,
} from '../src/modules/vault/customer-display-name';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { VaultService } from '../src/modules/vault/vault.service';
import { DEFAULT_PRICING_CURVE } from '../src/common/pricing-curve';

/**
 * ⭐ API_CONTRACT §M4-VAULT.3 «Nombre y apellido» + H-1 (v1.79.3) — pruebas 27 y 28 (mitad unidad).
 *
 * Un nombre FABRICADO del correo (`nameSource='derived'`) sale `null` en TODO lo que el operador ve en
 * «Bóvedas de clientes»; la vista (iii) del propio cliente NO cambia. Y `?sort=name_asc` con un `null`
 * no revienta: antes `sortRows` hacía `a.name.localeCompare(b.name)` ⇒ `TypeError` ⇒ `500`.
 * La mitad HTTP (las cinco fuentes contra Postgres real) vive en
 * `test/integration/vault-placement-verbs.e2e-spec.ts`.
 */

describe('customerDisplayName — la función (una sola, un cuerpo)', () => {
  it('derived ⇒ null; user/google ⇒ el nombre TAL CUAL (sin recortar ni reordenar)', () => {
    expect(customerDisplayName({ name: 'juan.perez95', nameSource: 'derived' })).toBeNull();
    expect(customerDisplayName({ name: 'María de la Luz Pérez Gómez', nameSource: 'user' })).toBe(
      'María de la Luz Pérez Gómez',
    );
    expect(customerDisplayName({ name: 'Ana López ', nameSource: 'google' })).toBe('Ana López ');
  });

  it('en blanco ⇒ null (nullIfBlank), aunque no sea derived', () => {
    expect(customerDisplayName({ name: '   ', nameSource: 'user' })).toBeNull();
    expect(customerDisplayName({ name: '', nameSource: 'google' })).toBeNull();
  });
});

describe('compareByDisplayName — null al final, desempate email (unidades de código) y userId', () => {
  const r = (userId: string, name: string | null, email: string) => ({ userId, name, email });
  it('los null van al final y entre ellos por email', () => {
    const rows = [
      r('u3', null, 'zeta@x.mx'),
      r('u1', 'Zoe', 'z@x.mx'),
      r('u4', null, 'Beta@x.mx'),
      r('u2', 'Ana', 'a@x.mx'),
    ];
    expect([...rows].sort(compareByDisplayName).map((x) => x.userId)).toEqual([
      'u2',
      'u1',
      'u4', // 'B' (0x42) < 'z' (0x7a): unidades de código, no locale
      'u3',
    ]);
  });
  it('mismo email (imposible en BD, pero el orden es total) ⇒ userId', () => {
    expect(compareByDisplayName(r('b', null, 'e'), r('a', null, 'e'))).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------- GET /admin/vaults

const PIECE = (ownerUserId: string, cardId = 'c1') => ({
  ownerUserId,
  cardId,
  productType: 'raw',
  rawCondition: 'NM',
  gradingCompany: null,
  gradeValue: null,
  finish: 'normal',
});

function buildList(users: any[], pieces: any[]) {
  const prisma = {
    inventoryItem: { findMany: jest.fn().mockResolvedValue(pieces) },
    user: { findMany: jest.fn().mockResolvedValue(users), findUnique: jest.fn() },
  } as unknown as PrismaService;
  const pricing = {
    tryGradeKeyFor: jest.fn().mockReturnValue('raw_NM'),
    getReferencesBatch: jest.fn().mockResolvedValue(
      new Map([['c1|raw|raw_NM|normal', { status: 'priced', referenceMxnCents: 100 }]]),
    ),
  } as unknown as PricingService;
  const vault = { sealedTab: jest.fn().mockResolvedValue({ groups: [] }) } as unknown as VaultService;
  return { prisma, svc: new AdminVaultsService(prisma, pricing, vault) };
}

describe('GET /admin/vaults — `name` = customerDisplayName (prueba 27, mitad unidad)', () => {
  it('cliente derived ⇒ name null y email presente; google ⇒ User.name idéntico', async () => {
    const { prisma, svc } = buildList(
      [
        { id: 'd', name: 'juan.perez95', nameSource: 'derived', email: 'juan.perez95@gmail.com' },
        { id: 'g', name: 'Gil Google', nameSource: 'google', email: 'gil@gmail.com' },
      ],
      [PIECE('d'), PIECE('g')],
    );
    const res = await svc.list({ page: 1, pageSize: 20, sort: 'value_desc' });
    const d = res.data.find((x) => x.userId === 'd')!;
    expect(d.name).toBeNull();
    expect(d.email).toBe('juan.perez95@gmail.com');
    expect(res.data.find((x) => x.userId === 'g')!.name).toBe('Gil Google');
    // la consulta trae el origen del nombre (sin él, la regla no se puede aplicar)
    const select = (prisma.user.findMany as jest.Mock).mock.calls[0][0].select;
    expect(select.nameSource).toBe(true);
  });

  it('`?q=` NO cambia: sigue buscando sobre User.name y User.email guardados', async () => {
    const { prisma, svc } = buildList(
      [{ id: 'd', name: 'juan.perez95', nameSource: 'derived', email: 'juan.perez95@gmail.com' }],
      [PIECE('d')],
    );
    const res = await svc.list({ q: 'juan.perez', page: 1, pageSize: 20, sort: 'value_desc' });
    expect(res.data.map((x) => x.userId)).toEqual(['d']);
    expect((prisma.user.findMany as jest.Mock).mock.calls[0][0].where.OR).toEqual([
      { name: { contains: 'juan.perez', mode: 'insensitive' } },
      { email: { contains: 'juan.perez', mode: 'insensitive' } },
    ]);
  });
});

describe('GET /admin/vaults — orden con null (prueba 28)', () => {
  const USERS = [
    { id: 'z', name: 'Zoe', nameSource: 'user', email: 'zoe@x.mx' },
    { id: 'd2', name: 'zz', nameSource: 'derived', email: 'zz@x.mx' },
    { id: 'a', name: 'Ana', nameSource: 'user', email: 'ana@x.mx' },
    { id: 'd1', name: 'aa', nameSource: 'derived', email: 'aa@x.mx' },
  ];
  const PIECES = [PIECE('z'), PIECE('d2'), PIECE('a'), PIECE('d1')];

  it('⭐ name_asc ⇒ Ana, Zoe, y los derived al final por email — 200, no TypeError', async () => {
    const { svc } = buildList(USERS, PIECES);
    const res = await svc.list({ page: 1, pageSize: 20, sort: 'name_asc' });
    expect(res.data.map((x) => x.userId)).toEqual(['a', 'z', 'd1', 'd2']);
  });

  it('value_desc y pieces_desc con empate total ⇒ el MISMO desempate (nombre, null al final)', async () => {
    for (const sort of ['value_desc', 'pieces_desc']) {
      const { svc } = buildList(USERS, PIECES);
      const res = await svc.list({ page: 1, pageSize: 20, sort });
      expect(res.data.map((x) => x.userId)).toEqual(['a', 'z', 'd1', 'd2']);
    }
  });
});

describe('GET /admin/vaults/:userId/sealed — owner.name (prueba 27)', () => {
  it('derived ⇒ owner.name null; user ⇒ nombre', async () => {
    const { prisma, svc } = buildList([], []);
    (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce({
      id: 'd',
      name: 'juan.perez95',
      nameSource: 'derived',
      email: 'juan.perez95@gmail.com',
    });
    const res = await svc.sealed('d', {});
    expect(res.owner).toEqual({ userId: 'd', name: null, email: 'juan.perez95@gmail.com' });
    expect((prisma.user.findUnique as jest.Mock).mock.calls[0][0].select.nameSource).toBe(true);
  });
});

// ---------------------------------------------------------------- master-sets (vista admin (ii) vs (iii))

function buildMasterSet(user: any) {
  const prisma = {
    cardSet: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue({
        id: 's1',
        name: 'Set',
        series: 'SV',
        releaseDate: '2024/11/08',
        printedTotal: 1,
      }),
    },
    card: { groupBy: jest.fn().mockResolvedValue([]), findMany: jest.fn().mockResolvedValue([]) },
    inventoryItem: { groupBy: jest.fn().mockResolvedValue([]), findMany: jest.fn().mockResolvedValue([]) },
    user: { findUnique: jest.fn().mockResolvedValue(user) },
    $queryRaw: jest.fn().mockResolvedValue([]),
  } as unknown as PrismaService;
  const pricing = {
    loadPricingCurve: jest.fn(async () => DEFAULT_PRICING_CURVE),
    decideSalePrice: jest.fn(PricingService.prototype.decideSalePrice),
    getReferencesBatch: jest.fn().mockResolvedValue(new Map()),
    getSeparateProductsByCard: jest.fn(async () => new Map()),
    getPricedRawFinishesBatch: jest.fn().mockResolvedValue(new Map()),
    gradeKeyFor: jest.fn().mockReturnValue('raw_NM'),
    tryGradeKeyFor: jest.fn().mockReturnValue('raw_NM'),
    getVariantOverridesBatch: jest.fn(async () => new Map()),
    getVariantOverride: jest.fn(async () => null),
  } as unknown as PricingService;
  return { prisma, svc: new MasterSetService(prisma, pricing) };
}

describe('master-sets — owner.name (prueba 27): admin (ii) con la regla, cliente (iii) intacta', () => {
  const DERIVED = { id: 'd', name: 'juan.perez95', nameSource: 'derived', email: 'juan.perez95@gmail.com' };
  const GOOGLE = { id: 'g', name: 'Gil Google', nameSource: 'google', email: 'gil@gmail.com' };

  it('binder e índice admin (includeOwnerEmail) ⇒ derived sale null, con email', async () => {
    const { svc } = buildMasterSet(DERIVED);
    const binder = await svc.binder('s1', { kind: 'user_vault', userId: 'd' }, { includeOwnerEmail: true });
    expect(binder.owner).toEqual({ userId: 'd', name: null, email: 'juan.perez95@gmail.com' });
    const index = await svc.index(
      { page: 1, pageSize: 20, sort: 'release_desc' },
      { kind: 'user_vault', userId: 'd' },
      { includeOwnerEmail: true },
    );
    expect(index.owner).toEqual({ userId: 'd', name: null, email: 'juan.perez95@gmail.com' });
  });

  it('google ⇒ User.name idéntico en admin', async () => {
    const { svc } = buildMasterSet(GOOGLE);
    const binder = await svc.binder('s1', { kind: 'user_vault', userId: 'g' }, { includeOwnerEmail: true });
    expect(binder.owner!.name).toBe('Gil Google');
  });

  it('⛔ candado de la frontera: la vista (iii) del propio derived SIGUE con User.name', async () => {
    const { svc } = buildMasterSet(DERIVED);
    const mine = await svc.binder('s1', { kind: 'user_vault', userId: 'd' });
    expect(mine.owner).toEqual({ userId: 'd', name: 'juan.perez95' });
  });
});

// ---------------------------------------------------------------- una función, cinco fuentes

describe('H-1 — las cinco fuentes usan LA función (⛔ ningún ternario copiado)', () => {
  const SRC = join(__dirname, '..', 'src', 'modules');
  const FUENTES = [
    'vault/admin-vaults.service.ts', // list + sealed
    'inventory/master-set.service.ts', // resolveOwner (admin)
    'vault/vault-preparation.view.ts', // cola vault (customer.fullName), que `shipments` importa
    'vault/vault-physical-inventory.service.ts', // vista física (owner.name)
  ];
  it.each(FUENTES)('%s importa y llama customerDisplayName', (f) => {
    const src = readFileSync(join(SRC, f), 'utf8');
    expect(src).toMatch(/import \{[^}]*customerDisplayName[^}]*\} from '[^']*customer-display-name'/);
    expect(src).toMatch(/customerDisplayName\(/);
    // ⛔ el ternario no se repite fuera de la función
    expect(src).not.toMatch(/nameSource\s*===\s*'derived'/);
  });
});
