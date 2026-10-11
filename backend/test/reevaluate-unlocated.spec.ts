import {
  describeUrl,
  parseArgs,
  reevaluateUnlocated,
  resolveDatabaseUrl,
  selectUnlocated,
} from '../scripts/reevaluate-unlocated';

/**
 * ⭐ Errata SU-1 (API_CONTRACT §M1-SU, SU.3) — lo que el script del rezago decide SIN base: el salto a
 * `DATABASE_PUBLIC_URL`, que la URL no se imprime, los argumentos, la selección y que el modo por defecto no llama
 * al cuerpo que escribe. La corrida contra Postgres real (SU-B6) vive en `integration/reevaluate-unlocated.e2e-spec.ts`.
 */
describe('scripts/reevaluate-unlocated — base', () => {
  const INTERNAL = 'postgresql://u:s3cr3t@postgres.railway.internal:5432/railway';
  const PUBLIC = 'postgresql://u:s3cr3t@roundhouse.proxy.rlwy.net:41234/railway';

  it('`*.railway.internal` ⇒ salta a `DATABASE_PUBLIC_URL` (el mismo salto que import-sepomex)', () => {
    expect(resolveDatabaseUrl({ DATABASE_URL: INTERNAL, DATABASE_PUBLIC_URL: PUBLIC }).url).toBe(PUBLIC);
  });

  it('`*.railway.internal` sin `DATABASE_PUBLIC_URL` ⇒ aborta (no intenta la red interna desde fuera)', () => {
    expect(() => resolveDatabaseUrl({ DATABASE_URL: INTERNAL })).toThrow(/DATABASE_PUBLIC_URL/);
  });

  it('cualquier otra base se usa tal cual; sin `DATABASE_URL` aborta', () => {
    const local = 'postgresql://u:p@localhost:5432/x?schema=public';
    expect(resolveDatabaseUrl({ DATABASE_URL: local, DATABASE_PUBLIC_URL: PUBLIC }).url).toBe(local);
    expect(() => resolveDatabaseUrl({})).toThrow(/falta DATABASE_URL/);
  });

  it('⛔ la etiqueta imprimible no lleva credenciales, ni host ni puerto fuera de local', () => {
    const { label } = resolveDatabaseUrl({ DATABASE_URL: INTERNAL, DATABASE_PUBLIC_URL: PUBLIC });
    expect(label).not.toContain('s3cr3t');
    expect(label).not.toContain('roundhouse');
    expect(label).not.toContain('41234');
    expect(describeUrl('postgresql://u:p@localhost:5432/x')).toBe('localhost:5432/x');
  });
});

describe('scripts/reevaluate-unlocated — argumentos', () => {
  it('por defecto NO aplica; `--apply` aplica; cualquier otra cosa es error de uso', () => {
    expect(parseArgs([])).toEqual({ apply: false });
    expect(parseArgs(['--apply'])).toEqual({ apply: true });
    expect(() => parseArgs(['--aply'])).toThrow(/argumento desconocido/);
    expect(() => parseArgs(['--apply=false'])).toThrow(/argumento desconocido/);
  });
});

describe('scripts/reevaluate-unlocated — selección y modos', () => {
  const build = () => {
    const findMany = jest.fn(async () => [{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    const inventory = {
      previewPublication: jest.fn(async (ids: string[]) =>
        ids.map((id, i) => ({
          inventoryItemId: id,
          outcome: (['would_publish', 'price_pending', 'not_publishable'] as const)[i],
        })),
      ),
      reevaluateForPublication: jest.fn(async (ids: string[]) =>
        ids.map((id, i) => ({
          inventoryItemId: id,
          outcome: (['published', 'price_pending', 'not_publishable'] as const)[i],
          missing: [],
        })),
      ),
    };
    return { deps: { prisma: { inventoryItem: { findMany } } as any, inventory: inventory as any }, findMany, inventory };
  };

  it('la selección es EXACTAMENTE plataforma ∧ in_stock ∧ sin cajón, en orden estable', async () => {
    const { deps, findMany } = build();
    expect(await selectUnlocated(deps.prisma)).toEqual(['a', 'b', 'c']);
    expect(findMany).toHaveBeenCalledWith({
      where: { ownerType: 'platform', status: 'in_stock', locationId: null },
      select: { id: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  });

  it('⛔ sin `--apply` NO llama al cuerpo que escribe; solo al pronóstico', async () => {
    const { deps, inventory } = build();
    const r = await reevaluateUnlocated(deps, { apply: false });
    expect(r).toEqual({ mode: 'dry-run', selected: 3, wouldPublish: 1, pricePending: 1, notPublishable: 1 });
    expect(inventory.reevaluateForPublication).not.toHaveBeenCalled();
  });

  it('con `--apply` corre `reevaluateForPublication` sobre la selección y cuenta por `outcome`', async () => {
    const { deps, inventory } = build();
    const r = await reevaluateUnlocated(deps, { apply: true });
    expect(inventory.reevaluateForPublication).toHaveBeenCalledWith(['a', 'b', 'c']);
    expect(r).toMatchObject({ mode: 'apply', selected: 3, published: 1, pricePending: 1, notPublishable: 1 });
    expect(r.byOutcome.missing_location).toBe(0);
  });
});
