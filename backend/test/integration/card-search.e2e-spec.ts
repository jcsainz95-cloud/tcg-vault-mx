import { E2EHarness } from './helpers/e2e-app';
import { CatalogService } from '../../src/modules/catalog/catalog.service';
import { SetSearchKeyService } from '../../src/modules/catalog/set-search-key.service';
import { clearCardSearchKeysCache } from '../../src/common/card-search';
import { CARD_ORDER_BY_GLOBAL, deriveNumberParts } from '../../src/common/card-order';

/**
 * §BUSCADOR-CARTAS — tabla de aceptación (docs/DECISIONES.md §6, filas 1-32) contra Postgres real.
 * Todo lo que crea lleva el prefijo `e2e-cs-` y se borra al final.
 */
const P = 'e2e-cs-';
type CardSeed = [slug: string, name: string, number: string];
const SETS: { slug: string; name: string; key: string | null; total: number; date: string; cards: CardSeed[] }[] = [
  { slug: 'pre', name: 'Prismatic Evolutions', key: 'PRE', total: 131, date: '2025/01/17', cards: [['pre-78', 'Pikachu', '78'], ['pre-161', 'Umbreon ex', '161'], ['pre-5', 'Eevee', '5']] },
  { slug: 'pal', name: 'Paldea Evolved', key: 'PAL', total: 193, date: '2023/06/09', cards: [['pal-78', 'Aipom', '78'], ['pal-178', 'Mew ex', '178'], ['pal-278', 'Zoroark', '278']] },
  { slug: 'bs', name: 'Base Set', key: 'BS', total: 102, date: '1999/01/09', cards: [['bs-4', 'Charizard', '4'], ['bs-58', 'Pikachu', '58'], ['bs-30', 'Pokémon Catcher', '30'], ['bs-29', 'Nidoran♀', '29'], ['bs-32', 'Nidoran♂', '32'], ['bs-83', "Farfetch'd", '83'], ['bs-124', 'Mr. Mime', '124'], ['bs-9', 'Flabébé', '9']] },
  { slug: 'svi', name: 'Scarlet and Violet', key: 'SVI', total: 198, date: '2023/03/31', cards: [['svi-54', 'Charizard ex', '54'], ['svi-78', 'Pikachu', '78']] },
  { slug: 'ds', name: 'EX Delta Species', key: 'DS', total: 113, date: '2005/10/31', cards: [['ds-100', 'Charizard δ', '100']] },
  { slug: 'swshp', name: 'SWSH Black Star Promos', key: null, total: 0, date: '2019/11/15', cards: [['swsh132', 'Zacian V', 'SWSH132']] },
  { slug: 'brs', name: 'Brilliant Stars TG', key: 'BRS', total: 172, date: '2022/02/25', cards: [['brs-tg12', 'Umbreon V', 'TG12']] },
  { slug: 'asr', name: 'Astral Radiance TG', key: 'ASR', total: 189, date: '2022/05/27', cards: [['asr-tg12', 'Lugia V', 'TG12']] },
  { slug: 'crz', name: 'Crown Zenith GG', key: 'CRZ', total: 159, date: '2023/01/20', cards: [['crz-gg05', 'Mimikyu', 'GG05']] },
  { slug: 'bwp', name: 'BW Black Star Promos', key: null, total: 0, date: '2011/03/01', cards: [['bw100', 'Reshiram', 'BW100']] },
  { slug: 'nokey', name: 'Sin Clave Set', key: null, total: 50, date: '2020/01/01', cards: [['nokey-5', 'Sinclavemon', '5']] },
  { slug: 'dupa', name: 'Dup A', key: 'DUP', total: 20, date: '2020/02/01', cards: [['dupa-7', 'Dupa', '7']] },
  { slug: 'dupb', name: 'Dup B', key: 'DUP', total: 20, date: '2020/03/01', cards: [['dupb-7', 'Dupb', '7']] },
  { slug: 'tcsv', name: 'TCGCSV Set', key: null, total: 0, date: '2024/01/01', cards: [['tcsv-12', 'Charmander', '12']] },
  { slug: 'many', name: 'Muchos Charizard', key: 'MCH', total: 30, date: '2021/01/01', cards: Array.from({ length: 9 }, (_, i): CardSeed => [`many-${i + 1}`, 'Charizard', String(i + 1)]) },
];

describe('E2E — búsqueda de cartas (§BUSCADOR-CARTAS, tabla de 32 filas)', () => {
  let h: E2EHarness;
  let catalog: CatalogService;
  const setIds = SETS.map((s) => `${P}set-${s.slug}`);

  const search = async (q: string, extra: { setId?: string; page?: number; pageSize?: number } = {}) => {
    const r = await catalog.searchAllCards({ q, page: extra.page ?? 1, pageSize: extra.pageSize ?? 20, ...(extra.setId ? { setId: extra.setId } : {}) });
    return { total: r.total, all: r.data.map((c) => c.id), ids: r.data.map((c) => c.id).filter((id) => id.startsWith(P)).map((id) => id.slice(P.length)) };
  };
  const legacy = async (q: string) =>
    (await h.prisma.card.findMany({ where: { OR: [{ name: { contains: q, mode: 'insensitive' } }, { number: { contains: q, mode: 'insensitive' } }] }, orderBy: CARD_ORDER_BY_GLOBAL, take: 20, select: { id: true } })).map((c) => c.id);

  beforeAll(async () => {
    h = await E2EHarness.create();
    catalog = h.app.get(CatalogService);
    for (const s of SETS) {
      await h.prisma.cardSet.create({
        data: { id: `${P}set-${s.slug}`, externalId: `${P}set-${s.slug}`, name: s.name, releaseDate: s.date, printedTotal: s.total || null, ptcgoCode: s.key, ...(s.slug === 'tcsv' ? { tcgcsvGroupId: 987654 } : {}) },
      });
      for (const [slug, name, number] of s.cards) {
        const parts = deriveNumberParts(number);
        await h.prisma.card.create({
          data: { id: `${P}${slug}`, externalId: `${P}${slug}`, setId: `${P}set-${s.slug}`, name, number, rarity: 'Rare', availableFinishes: ['normal'], numberSort: parts.numberSort, numberPrefix: parts.prefix },
        });
      }
    }
    clearCardSearchKeysCache();
  });

  afterAll(async () => {
    await h?.prisma.card.deleteMany({ where: { setId: { in: setIds } } });
    await h?.prisma.cardSet.deleteMany({ where: { id: { in: setIds } } });
    clearCardSearchKeysCache();
    await h?.close();
  });

  it('1-2: «PRE 078» y variantes ⇒ la carta 78 de Prismatic Evolutions, primera', async () => {
    for (const q of ['PRE 078', 'PRE078', 'pre 78', 'PRE-078', 'pre078']) {
      const r = await search(q);
      expect(r.ids[0]).toBe('pre-78');
      expect(r.all[0]).toBe(`${P}pre-78`);
    }
  });

  it('3: «078» ⇒ número 78 primero, luego 178/278 (contiene)', async () => {
    const r = await search('078');
    expect(r.ids.slice(0, 5)).toEqual(['pal-78', 'pre-78', 'svi-78', 'pal-178', 'pal-278']);
  });

  it('4-5: «078/131» y «78/131» ⇒ 78 primero; los de set con total 131 antes', async () => {
    for (const q of ['078/131', '78/131']) {
      const r = await search(q);
      expect(r.ids[0]).toBe('pre-78');
      expect(r.ids.slice(0, 3)).toEqual(['pre-78', 'pal-78', 'svi-78']);
    }
  });

  it('6-9: códigos con prefijo (SWSH132, TG12, GG05/gg5, BW100)', async () => {
    expect((await search('SWSH132')).ids[0]).toBe('swsh132');
    expect((await search('swsh 132')).ids[0]).toBe('swsh132');
    expect((await search('TG12')).ids.slice(0, 2).sort()).toEqual(['asr-tg12', 'brs-tg12']);
    expect((await search('GG05')).ids[0]).toBe('crz-gg05');
    expect((await search('gg5')).ids[0]).toBe('crz-gg05');
    expect((await search('BW100')).ids[0]).toBe('bw100');
  });

  it('10-13: nombre + número, nombre + clave (orden libre)', async () => {
    expect((await search('charizard 4')).ids).toContain('bs-4');
    expect((await search('charizard 4')).ids).not.toContain('svi-54');
    expect((await search('pikachu 078')).ids.filter((i) => !i.startsWith('e2e')).sort()).toEqual(['pre-78', 'svi-78']);
    const a = await search('umbreon pre');
    expect(a.ids[0]).toBe('pre-161');
    expect((await search('pre umbreon')).all).toEqual(a.all);
  });

  it('14-16: una sola palabra = idéntico al de hoy (mismos ids y orden)', async () => {
    for (const q of ['Charizard', 'charizard', 'CHARIZARD', 'char', '78']) {
      expect((await search(q)).all).toEqual(await legacy(q));
    }
  });

  it('17-23: acentos, símbolos, delta, ♀♂', async () => {
    expect((await search('pokemon catcher')).ids).toContain('bs-30');
    expect((await search('flabebe')).ids).toContain('bs-9');
    expect((await search("farfetch'd")).ids).toContain('bs-83');
    expect((await search('mr mime')).ids).toContain('bs-124');
    expect((await search('mr. mime')).ids).toContain('bs-124');
    expect((await search('charizard ex')).all).toEqual((await search('charizard EX')).all);
    expect((await search('charizard ex')).ids).toContain('svi-54');
    expect((await search('charizard δ')).ids[0]).toBe('ds-100');
    expect((await search('charizard delta')).ids).toEqual((await search('charizard δ')).ids);
    expect((await search('nidoran')).ids).toEqual(expect.arrayContaining(['bs-29', 'bs-32']));
  });

  it('24: clave de TCGCSV rellenada por el job («30C 12»); no pisa ni repite', async () => {
    expect((await search('30C 12')).ids).not.toContain('tcsv-12');
    const client = { listGroups: async () => [{ groupId: 987654, name: 'TCGCSV Set', abbreviation: '30c' }] };
    const svc = new SetSearchKeyService(h.prisma, client as never);
    const run1 = await svc.fillMissing();
    expect(run1.filled).toBe(1);
    expect((await h.prisma.cardSet.findUnique({ where: { id: `${P}set-tcsv` } }))?.ptcgoCode).toBe('30C');
    expect((await search('30C 12')).ids[0]).toBe('tcsv-12');
    expect((await svc.fillMissing()).filled).toBe(0);
    // nunca pisa la de pokemontcg.io ni repite una clave usada
    await h.prisma.cardSet.update({ where: { id: `${P}set-tcsv` }, data: { ptcgoCode: null } });
    const taken = new SetSearchKeyService(h.prisma, { listGroups: async () => [{ groupId: 987654, name: 'x', abbreviation: 'PRE' }] } as never);
    expect((await taken.fillMissing()).filled).toBe(0);
    expect((await h.prisma.cardSet.findUnique({ where: { id: `${P}set-tcsv` } }))?.ptcgoCode).toBeNull();
    expect((await h.prisma.cardSet.findUnique({ where: { id: `${P}set-pre` } }))?.ptcgoCode).toBe('PRE');
    // cobertura medible
    const cov = await svc.coverage();
    expect(cov.total).toBeGreaterThan(0);
    expect(cov.withoutKey).toBeLessThanOrEqual(cov.total);
  });

  it('25-27: sin resultados y setId', async () => {
    const z = await search('zzzz 999');
    expect(z.total).toBe(0);
    expect(z.all).toEqual([]);
    expect((await search('PRE 078', { setId: `${P}set-pal` })).ids).toEqual([]);
    expect((await search('PRE 078', { setId: `${P}set-pre` })).ids).toEqual(['pre-78']);
  });

  it('28: q larga, %, _, .* ⇒ recortada y sin comodines', async () => {
    const long = await search('x'.repeat(500));
    expect(long.total).toBe(0);
    for (const q of ['%%%', '_', '.*']) {
      const r = await search(q);
      expect(r.total).toBe(0);
    }
    expect((await search('charizard ' + 'zzzzzzzzzz '.repeat(10))).total).toBe(0);
  });

  it('29: clave repetida entre dos sets + número ⇒ trae de ambos', async () => {
    expect((await search('DUP 7')).ids.sort()).toEqual(['dupa-7', 'dupb-7']);
  });

  it('30: paginación estable de «charizard» (sin repetidos ni saltados, orden idéntico)', async () => {
    const full = (await search('charizard', { pageSize: 100 })).all;
    const pages: string[] = [];
    for (let p = 1; p <= Math.ceil(full.length / 3); p++) pages.push(...(await search('charizard', { page: p, pageSize: 3 })).all);
    expect(pages).toEqual(full);
    expect(new Set(pages).size).toBe(pages.length);
    // con identidad (nivel 1 + resto) también
    const f2 = (await search('charizard 4', { pageSize: 100 })).all;
    const p2: string[] = [];
    for (let p = 1; p <= f2.length; p++) p2.push(...(await search('charizard 4', { page: p, pageSize: 1 })).all);
    expect(p2).toEqual(f2);
    const f3 = (await search('PRE 078', { pageSize: 100 })).all;
    const p3: string[] = [];
    for (let p = 1; p <= f3.length; p++) p3.push(...(await search('PRE 078', { page: p, pageSize: 1 })).all);
    expect(p3).toEqual(f3);
  });

  it('31: tope de volcado con q y sin setId (page×pageSize > 1000 ⇒ vacío, total real)', async () => {
    const r = await search('a', { page: 60, pageSize: 20 });
    expect(r.all).toEqual([]);
    const ok = await catalog.searchAllCards({ q: 'charizard', page: 1, pageSize: 20 });
    expect(ok.total).toBeGreaterThan(0);
    const capped = await catalog.searchAllCards({ q: 'charizard', page: 51, pageSize: 20 });
    expect(capped.data).toEqual([]);
    expect(capped.total).toBe(ok.total);
  });

  it('32: sin q con setId ⇒ orden natural y paginación como hoy', async () => {
    const r = await catalog.searchAllCards({ setId: `${P}set-many`, page: 2, pageSize: 4 });
    expect(r.data.map((c) => c.number)).toEqual(['5', '6', '7', '8']);
    expect(r.total).toBe(9);
  });

  it('tiempo: p95 ≤ 300 ms (filas 1, 10, 14; 30 corridas)', async () => {
    for (const q of ['PRE 078', 'charizard 4', 'Charizard']) {
      const t: number[] = [];
      for (let i = 0; i < 30; i++) {
        const s = Date.now();
        await search(q);
        t.push(Date.now() - s);
      }
      t.sort((a, b) => a - b);
      const p95 = t[Math.floor(t.length * 0.95) - 1];
      // eslint-disable-next-line no-console
      console.log(`card-search p95 «${q}» = ${p95} ms (N=30, catálogo de prueba)`);
      expect(p95).toBeLessThanOrEqual(300);
    }
  });
});
