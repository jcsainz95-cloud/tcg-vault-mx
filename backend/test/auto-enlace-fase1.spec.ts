import { CardLinkRepairService } from '../src/modules/catalog/card-link-repair.service';

/** §AUTO-ENLACE fase 1 — dpp/promos viejas: «sin grupo» era una etiqueta falsa; ahora `promo_route` con el grupo de la tabla. */
const mk = (externalId: string, resolverRes: unknown, describe: unknown) => {
  const audits: any[] = [];
  const prisma = { cardSet: { findUnique: jest.fn(async () => ({ name: 'Set', externalId })) } } as any;
  const resolver = { resolveCardProductsForSet: jest.fn(async () => resolverRes), describeGroup: jest.fn(async () => describe) } as any;
  const audit = { log: jest.fn(async (a: any) => audits.push(a)) } as any;
  return { svc: new CardLinkRepairService(prisma, resolver, audit), audits };
};

describe('card-link-repair — motivo y grupo por set (fase 1)', () => {
  it('dpp (resolver null por ruta propia) ⇒ promo_route con groupUsed promo_table 1421, NUNCA no_group', async () => {
    const { svc, audits } = mk('dpp', null, { groupId: 1421, name: 'DP Black Star Promos', via: 'promo_table', failure: null });
    const r = await (svc as any).attemptSet('s1', 'manual', 'u1');
    expect(r.notLinkable).toBe('promo_route');
    expect(r.reason).toBe('promo_route');
    expect(r.groupUsed).toEqual({ groupId: 1421, name: 'DP Black Star Promos', via: 'promo_table' });
    expect(audits[0].after).toMatchObject({ notLinkable: 'promo_route', reason: 'promo_route' });
  });

  it('set sin grupo ⇒ no_group/group_none; ambiguo ⇒ group_ambiguous', async () => {
    const a = await (mk('x', null, { groupId: null, name: null, via: null, failure: 'none' }).svc as any).attemptSet('s', 'manual', null);
    expect([a.notLinkable, a.reason]).toEqual(['no_group', 'group_none']);
    const b = await (mk('x', null, { groupId: null, name: null, via: null, failure: 'ambiguous' }).svc as any).attemptSet('s', 'manual', null);
    expect(b.reason).toBe('group_ambiguous');
  });

  it('corrida normal: priced y groupUsed salen del resolver; colisiones ⇒ reason collisions', async () => {
    const { svc } = mk('me55c', { groupId: 24837, groupName: 'ME: Classic', groupVia: 'auto', pricesWritten: 7, collisions: 2, conflicts: 0, reasonCounts: { collision: 2 }, examples: [], touchedCardIds: [] }, null);
    const r = await (svc as any).attemptSet('s', 'manual', null);
    expect(r).toMatchObject({ priced: 7, reason: 'collisions', groupUsed: { groupId: 24837, name: 'ME: Classic', via: 'auto' } });
  });
});
