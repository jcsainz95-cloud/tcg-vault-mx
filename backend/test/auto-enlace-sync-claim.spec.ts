import { CardLinkRepairService } from '../src/modules/catalog/card-link-repair.service';

/** §AUTO-ENLACE AE-3 (límite de `sync` por set) y AE-4 (etiqueta de error, nunca el texto crudo del proveedor). */
const mkClaim = (lastAt: Date | null) => {
  const created: any[] = [];
  const tx = {
    $executeRaw: jest.fn(async () => 1),
    auditLog: {
      findFirst: jest.fn(async () => (lastAt ? { createdAt: lastAt } : null)),
      create: jest.fn(async (a: any) => (created.push(a.data), { id: 'claim-1' })),
    },
  };
  const deleteMany = jest.fn(async () => ({ count: 1 }));
  const prisma = { $transaction: jest.fn(async (fn: any) => fn(tx)), auditLog: { deleteMany } } as any;
  return { svc: new CardLinkRepairService(prisma, {} as any, { log: jest.fn() } as any), created, tx, deleteMany, prisma };
};

describe('claimSync / releaseSyncClaim (AE-3)', () => {
  it('sin reclamo previo ⇒ escribe UNA fila catalog.sync_claim con el externalId y devuelve su id', async () => {
    const { svc, created } = mkClaim(null);
    await expect(svc.claimSync('me05', 'u1')).resolves.toBe('claim-1');
    expect(created).toEqual([{ actorUserId: 'u1', action: 'catalog.sync_claim', entityType: 'CardSet', entityId: 'me05', after: { setId: 'me05' } }]);
  });

  it('reclamo de hace < 10 min ⇒ 429 RATE_LIMITED con mensaje PROPIO de sync, retryAfterSeconds y sin escribir otra fila', async () => {
    const { svc, created } = mkClaim(new Date(Date.now() - 60_000));
    const e: any = await svc.claimSync('me05', 'u1').catch((x) => x);
    expect(e.getStatus()).toBe(429);
    expect(JSON.stringify(e.getResponse())).toContain('RATE_LIMITED');
    expect(JSON.stringify(e.getResponse())).toContain('synced');
    expect(JSON.stringify(e.getResponse())).not.toContain('repaired');
    expect(created).toHaveLength(0);
    expect(JSON.stringify(e.getResponse())).toMatch(/retryAfterSeconds":(5[0-9]|60)/);
  });

  it('reclamo de hace > 10 min ⇒ pasa y escribe uno nuevo', async () => {
    const { svc, created } = mkClaim(new Date(Date.now() - 11 * 60_000));
    await svc.claimSync('me05', 'u1');
    expect(created).toHaveLength(1);
  });

  it('V5: setId con formato inválido ⇒ 422 ANTES de abrir transacción ni escribir auditoría', async () => {
    const { svc, prisma, created } = mkClaim(null);
    for (const bad of ['', 'ME05', 'me 05', "x'; drop", 'a'.repeat(5) + '/../b', '-a']) {
      const e: any = await svc.claimSync(bad, 'u1').catch((x) => x);
      expect([bad, e.getStatus?.()]).toEqual([bad, 422]);
    }
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(created).toHaveLength(0);
  });

  it('releaseSyncClaim borra el reclamo por id y nunca lanza', async () => {
    const { svc, deleteMany } = mkClaim(null);
    await svc.releaseSyncClaim('claim-1');
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: 'claim-1' } });
    deleteMany.mockRejectedValueOnce(new Error('db down'));
    await expect(svc.releaseSyncClaim('claim-1')).resolves.toBeUndefined();
  });
});

describe('attemptSet — AE-4: etiqueta, no texto crudo del proveedor', () => {
  it('un fallo del proveedor deja `error` = etiqueta (nombre+código) y la bitácora NO contiene el mensaje crudo', async () => {
    const audits: any[] = [];
    const prisma = { cardSet: { findUnique: jest.fn(async () => ({ name: 'Set', externalId: 'me05' })) } } as any;
    const secret = 'Bearer sk_live_SECRETO https://tcgcsv.com/x?token=abc';
    const boom = Object.assign(new Error(secret), { code: 'E_UPSTREAM' });
    const resolver = { resolveCardProductsForSet: jest.fn(async () => { throw boom; }) } as any;
    const audit = { log: jest.fn(async (a: any) => { audits.push(a); }) } as any;
    const svc = new CardLinkRepairService(prisma, resolver, audit);
    const r = await (svc as any).attemptSet('s1', 'manual', 'u1');
    expect(r.error).toBe('Error E_UPSTREAM');
    expect(JSON.stringify(r)).not.toContain('SECRETO');
    expect(JSON.stringify(audits)).not.toContain('SECRETO');
    expect(audits[0].after).toMatchObject({ failed: true, error: 'Error E_UPSTREAM' });
  });
});
