import { evaluateDiscoveryGroup, MAX_NEW_GROUPS_PER_RUN } from '../src/modules/catalog/tcgcsv-group-discovery';
import { TcgcsvGroupDiscoveryService } from '../src/modules/catalog/tcgcsv-group-discovery.service';

/** AUTO-F (docs/specs/AUTO_CATALOGO.md §F). Casos tomados de la medicion real de la categoria 3 (2026-11-09). */
const NOW = new Date('2026-11-09T12:00:00Z');
const prods = (n: number, withNumber = n) =>
  Array.from({ length: n }, (_, i) => ({ name: `Card ${i}`, number: i < withNumber ? String(i + 1) : null }));
const LIVE = [{ id: 'sv8', name: 'Surging Sparks' }];
const base = (name: string, over: Record<string, unknown> = {}) => ({
  group: { groupId: 9999, name, publishedOn: '2026-01-02T00:00:00' },
  products: prods(60),
  liveSets: LIVE,
  maxContentMatch: 0,
  now: NOW,
  ...over,
});

describe('evaluateDiscoveryGroup', () => {
  it('F1 promo con >=20 numerados, sin equivalente y publicada hace >7 dias ⇒ elegible', () => {
    expect(evaluateDiscoveryGroup(base('Alternate Art Promos'))).toEqual({ verdict: 'eligible', reasons: [] });
  });
  it('nombre que no es de promos ⇒ ignora (sin leer productos)', () => {
    expect(evaluateDiscoveryGroup(base('ME06: Delta Reign')).verdict).toBe('ignore');
  });
  it('F2 menos de 20 numerados (McDonalds 12-16) ⇒ ignora; Player Placement (0) ⇒ ignora', () => {
    expect(evaluateDiscoveryGroup(base("McDonald's Promos 2019", { products: prods(12) })).verdict).toBe('ignore');
    expect(evaluateDiscoveryGroup(base('Player Placement Trainer Promos', { products: prods(4, 0) })).verdict).toBe('ignore');
  });
  it('F3 nombre en el patron Y en la exclusion (Japan, Jumbo, Deck) ⇒ cuarentena', () => {
    expect(evaluateDiscoveryGroup(base('Japan Promos')).verdict).toBe('quarantine');
    expect(evaluateDiscoveryGroup(base('Jumbo Promos')).verdict).toBe('quarantine');
  });
  it('F4 equivalente vivo por nombre o por contenido (>=30 %) ⇒ ignora; 10-30 % ⇒ cuarentena', () => {
    expect(evaluateDiscoveryGroup(base('Surging Sparks Promos', { liveSets: [{ id: 'x', name: 'Surging Sparks Promos' }] })).verdict).toBe('ignore');
    expect(evaluateDiscoveryGroup(base('Alternate Art Promos', { maxContentMatch: 0.3 })).verdict).toBe('ignore');
    expect(evaluateDiscoveryGroup(base('Alternate Art Promos', { maxContentMatch: 0.2 }))).toEqual({ verdict: 'quarantine', reasons: ['content_match_gray'] });
  });
  it('F5 las 6 promos viejas (22872 SVP) ya estan cubiertas ⇒ ignora', () => {
    expect(evaluateDiscoveryGroup(base('SV: Scarlet & Violet Promo Cards', { group: { groupId: 22872, name: 'SV: Scarlet & Violet Promo Cards', publishedOn: '2023-03-31T00:00:00' } })).verdict).toBe('ignore');
  });
  it('F6 publishedOn reciente (<7 dias) o ausente ⇒ cuarentena (caso real: Burger King Promos 2026-11-08)', () => {
    const recent = base('Burger King Promos', { group: { groupId: 2175, name: 'Burger King Promos', publishedOn: '2026-11-08T20:00:05Z' } });
    expect(evaluateDiscoveryGroup(recent)).toEqual({ verdict: 'quarantine', reasons: ['published_too_recent'] });
    expect(evaluateDiscoveryGroup(base('X Promos', { group: { groupId: 1, name: 'X Promos' } })).reasons).toContain('published_on_missing');
  });
  it('F7 numerados entre 50 % y 80 % ⇒ cuarentena; <50 % ⇒ ignora', () => {
    expect(evaluateDiscoveryGroup(base('Z Promos', { products: prods(100, 65) })).reasons).toEqual(['numbered_ratio_gray']);
    expect(evaluateDiscoveryGroup(base('Z Promos', { products: prods(100, 30).concat(prods(0)) })).verdict).toBe('ignore');
  });
});

function svc(opts: { groups: any[]; products: Record<number, any[]>; existing?: string[]; audited?: boolean }) {
  const tcgcsv = {
    listGroups: jest.fn(async () => opts.groups),
    getCardProducts: jest.fn(async (id: number) => opts.products[id].map((p, i) => ({ productId: i, ...p }))),
  };
  const prisma = {
    card: { findMany: jest.fn(async () => []) },
    cardSet: { findMany: jest.fn(async () => (opts.existing ?? []).map((externalId) => ({ externalId }))) },
    auditLog: { findFirst: jest.fn(async () => (opts.audited ? { id: 'a' } : null)) },
  };
  const audit = { log: jest.fn(async () => undefined) };
  return { s: new TcgcsvGroupDiscoveryService(prisma as any, tcgcsv as any, audit as any), tcgcsv, audit };
}
const grp = (groupId: number, name: string, publishedOn = '2026-01-01T00:00:00') => ({ groupId, name, publishedOn });

describe('TcgcsvGroupDiscoveryService.discover', () => {
  const groups = [grp(1, 'A Promos'), grp(2, 'B Promos'), grp(3, 'C Promos'), grp(4, 'Recent Promos', '2026-11-08T00:00:00'), grp(5, 'ME06: Delta Reign'), grp(24451, 'ME: Mega Evolution Promo')];
  const products = { 1: prods(30), 2: prods(30), 3: prods(30), 4: prods(30) };

  it('F8 fail-closed: sin lista viva ⇒ 0 descubrimientos y ni siquiera lee TCGCSV', async () => {
    const { s, tcgcsv } = svc({ groups, products });
    const r = await s.discover([]);
    expect(r.eligible).toEqual([]);
    expect(tcgcsv.listGroups).not.toHaveBeenCalled();
  });
  it('F9 tope: maximo 2 grupos NUEVOS por corrida; la semilla no se re-evalua', async () => {
    const { s } = svc({ groups, products });
    const r = await s.discover(LIVE, NOW);
    expect(MAX_NEW_GROUPS_PER_RUN).toBe(2);
    expect(r.eligible.map((g) => g.groupId)).toEqual([1, 2]);
    expect(r.summary).toMatchObject({ scanned: 6, eligible: 3, quarantined: 1 });
    expect(r.eligible.map((g) => g.groupId)).not.toContain(24451);
  });
  it('los ya importados siguen entrando aunque se alcance el tope', async () => {
    const { s } = svc({ groups, products, existing: ['tcgcsv:3'] });
    const r = await s.discover(LIVE, NOW);
    expect(r.eligible.map((g) => g.groupId).sort()).toEqual([1, 2, 3]);
  });
  it('F10 la cuarentena se audita UNA vez por (grupo, motivos)', async () => {
    const a = svc({ groups, products });
    await a.s.discover(LIVE, NOW);
    expect(a.audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'catalog.tcgcsv_group_quarantined' }));
    const b = svc({ groups, products, audited: true });
    await b.s.discover(LIVE, NOW);
    expect(b.audit.log).not.toHaveBeenCalled();
  });
});
