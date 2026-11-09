/**
 * psa-acabado.e2e-spec.ts - PSA-ACABADO (B5/B7/B8, docs/specs/PSA_ACABADO.md) + AUTO-B (liga idempotente) contra Postgres REAL.
 * Propiedad: backend. Datos propios (prefijo RUN) y limpieza al final.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PricingService } from '../../src/modules/pricing/pricing.service';
import { PromoCollectionLinkService } from '../../src/modules/catalog/promo-collection-link.service';

jest.setTimeout(60_000);
const RUN = `psa${Date.now().toString(36)}`;
const prisma = new PrismaClient();
const FX = { rate: 19, bufferPct: 5 };
let setId = '';
let cardId = '';

beforeAll(async () => {
  const set = await prisma.cardSet.create({ data: { externalId: `${RUN}-set`, name: 'PSA test' } });
  setId = set.id;
  const card = await prisma.card.create({
    data: { externalId: `${RUN}-c1`, setId, name: 'Gengar', number: '50', availableFinishes: ['holofoil', 'reverse_holo'] },
  });
  cardId = card.id;
});
afterAll(async () => {
  await prisma.promoCollectionLink.deleteMany({});
  await prisma.priceReference.deleteMany({ where: { cardId } });
  await prisma.card.deleteMany({ where: { setId } });
  await prisma.cardSet.deleteMany({ where: { id: setId } });
  await prisma.$disconnect();
});

const pricing = () => new PricingService(prisma as never, {} as never, {} as never, {} as never, {} as never, {} as never);
const today = () => new Date(new Date().toISOString().slice(0, 10));

describe('PSA-ACABADO contra Postgres real', () => {
  it('B5 - la fila automatica vieja (scoped=false) se borra EN LA MISMA tx que escribe la nueva; la manual y la market no', async () => {
    const base = { cardId, productType: 'graded' as const, gradeKey: 'graded:PSA:10', capturedDate: today(), refKind: 'graded_estimate' as const };
    await prisma.priceReference.create({ data: { ...base, finish: 'normal', source: 'pokemonpricetracker', priceMxnCents: 111_111, estimateFinishScoped: false } });
    await prisma.priceReference.create({
      data: { ...base, finish: 'holofoil', source: 'manual', priceMxnCents: 222_222, isManualOverride: true, estimateFinishScoped: false },
    });
    const wrote = await pricing().persistGradedEstimateReference(cardId, '10', 'holofoil', { amountCents: 9_000, currency: 'USD', source: 'pokemonpricetracker' }, FX);
    // la manual del dia en holofoil gana (O.6): no se escribe; la vieja automatica de 'normal' SI se barre solo si hubo escritura.
    expect(wrote).toBe(false);
    expect(await prisma.priceReference.count({ where: { cardId, finish: 'normal' } })).toBe(1); // sin escritura no hay barrido
    const wrote2 = await pricing().persistGradedEstimateReference(cardId, '10', 'reverse_holo', { amountCents: 3_000, currency: 'USD', source: 'pokemonpricetracker' }, FX);
    expect(wrote2).toBe(true);
    const rows = (await prisma.priceReference.findMany({ where: { cardId, gradeKey: 'graded:PSA:10' } })).sort((a, b) => a.finish.localeCompare(b.finish));
    expect(await prisma.priceReference.count({ where: { cardId, finish: 'normal' } })).toBe(0); // la vieja automatica se barrio en la misma tx
    expect(rows.map((r) => [r.finish, r.estimateFinishScoped, r.isManualOverride])).toEqual([
      ['holofoil', false, true], // manual intacta
      ['reverse_holo', true, false], // la nueva, por acabado
    ]);
  });

  it('B7 - segunda corrida: 0 duplicados (la clave unica por acabado)', async () => {
    await pricing().persistGradedEstimateReference(cardId, '10', 'reverse_holo', { amountCents: 3_000, currency: 'USD', source: 'pokemonpricetracker' }, FX);
    expect(await prisma.priceReference.count({ where: { cardId, finish: 'reverse_holo', gradeKey: 'graded:PSA:10' } })).toBe(1);
  });

  it('Gengar: holo y reverse con cifras DISTINTAS quedan como filas separadas, nunca la misma copiada', async () => {
    await prisma.priceReference.deleteMany({ where: { cardId } });
    await pricing().persistGradedEstimateReference(cardId, '9', 'holofoil', { amountCents: 9_000, currency: 'MXN', source: 'pokemonpricetracker' }, FX);
    await pricing().persistGradedEstimateReference(cardId, '9', 'reverse_holo', { amountCents: 2_000, currency: 'MXN', source: 'pokemonpricetracker' }, FX);
    const rows = (await prisma.priceReference.findMany({ where: { cardId } })).sort((a, b) => a.finish.localeCompare(b.finish));
    expect(rows.map((r) => [r.finish, r.priceMxnCents])).toEqual([['holofoil', 9_000], ['reverse_holo', 2_000]]);
  });

  it('B8 - la migracion es ADITIVA e idempotente: re-ejecutarla no falla ni mueve ningun priceMxnCents', async () => {
    const before = await prisma.priceReference.findMany({ where: { cardId }, select: { id: true, priceMxnCents: true } });
    const dir = join(__dirname, '..', '..', 'prisma', 'migrations');
    for (const name of readdirSync(dir).filter((d) => /_psa_finish_scope$|_promo_collection_link$/.test(d))) {
      const sql = readFileSync(join(dir, name, 'migration.sql'), 'utf8');
      // sentencia por sentencia (Prisma no admite varias en una); los DO $$ ... $$ llevan ';' internos y se tratan como un bloque.
      const body = sql.replace(/--.*$/gm, '');
      const blocks: string[] = body.match(/DO \$\$[\s\S]*?END \$\$;/g) ?? [];
      const rest = blocks.reduce((acc, b) => acc.replace(b, ''), body);
      for (const st of [...blocks.map((b) => b.replace(/;$/, '')), ...rest.split(';').map((x) => x.trim()).filter(Boolean)]) {
        await prisma.$executeRawUnsafe(st);
      }
    }
    const after = await prisma.priceReference.findMany({ where: { cardId }, select: { id: true, priceMxnCents: true } });
    expect(after).toEqual(before);
  });
});

describe('AUTO-B - recalculo de la liga contra Postgres real', () => {
  it('B6 - recalcular dos veces: la 2.a corrida cambia 0 filas', async () => {
    const promoSet = await prisma.cardSet.create({ data: { externalId: 'svp', name: 'SVP test' } }).catch(async () => prisma.cardSet.findUniqueOrThrow({ where: { externalId: 'svp' } }));
    const expansion = await prisma.card.create({ data: { externalId: `${RUN}-x1`, setId, name: 'Pikachu', number: '1', contentKey: `pokemon|pikachu|60|zap` } });
    const promo = await prisma.card.create({ data: { externalId: `${RUN}-p1`, setId: promoSet.id, name: 'Pikachu', number: '1', contentKey: `pokemon|pikachu|60|zap` } });
    const svc = new PromoCollectionLinkService(prisma as never);
    const first = await svc.recompute();
    expect(first).toMatchObject({ high: 1 });
    const second = await svc.recompute();
    expect(second).toMatchObject({ high: 1, changed: 0 });
    const apartado = await svc.collectionPromos([setId], new Set([promo.id]));
    expect(apartado).toMatchObject({ total: 1, owned: 1 });
    await prisma.promoCollectionLink.deleteMany({});
    await prisma.card.deleteMany({ where: { id: { in: [promo.id, expansion.id] } } });
    await prisma.cardSet.deleteMany({ where: { id: promoSet.id, cards: { none: {} } } }).catch(() => undefined);
  });
});
