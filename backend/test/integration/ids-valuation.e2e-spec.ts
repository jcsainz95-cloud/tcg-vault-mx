/**
 * ids-valuation.e2e-spec.ts — 💰 v1.116⟨ids⟩ (API_CONTRACT §IDS.2 «Otros usos del valor de una pieza», criterio 531; P-ARQ-IDS-2
 * sin respuesta ⇒ rige la recomendación: español = inglés × X; liga = su producto) contra Postgres REAL. Propiedad: backend.
 * Los lectores de patrimonio valúan la pieza por SU versión: «Mi bóveda» (`holdings`), su detalle, el valor de reposición
 * (`marketRefOf`), `/admin/vaults`, el inventario y la custodia del admin. Inglés sin liga: sin cambio. Determinista (N=1).
 */
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { E2EHarness } from './helpers/e2e-app';
import { seedE2E } from '../../prisma/seed-e2e';
import { VaultService } from '../../src/modules/vault/vault.service';
import { AdminVaultsService } from '../../src/modules/vault/admin-vaults.service';
import { AdminService } from '../../src/modules/admin/admin.service';

jest.setTimeout(120_000);

describe('E2E — §IDS.2 valor por versión en bóveda, reposición y admin (531)', () => {
  let h: E2EHarness;
  const run = randomUUID().slice(0, 8);
  const pid = 200_000_000 + Math.floor(Math.random() * 90_000_000);
  let setId: string;
  let cardId: string;
  let userId: string;
  let savedDial: Prisma.JsonValue | undefined;
  const ids: string[] = [];
  const today = () => new Date(new Date().toISOString().slice(0, 10));

  async function piece(data: Record<string, unknown> = {}) {
    const p = await h.prisma.inventoryItem.create({
      data: {
        folio: `IDQ-${run}-${ids.length + 1}`,
        cardId,
        productType: 'raw',
        rawCondition: 'NM',
        finish: 'normal',
        ownerType: 'customer',
        ownerUserId: userId,
        ownershipStatus: 'settled',
        status: 'in_custody',
        acquisitionType: 'compra',
        acquisitionCostCents: 100,
        ...data,
      },
    });
    ids.push(p.id);
    return p;
  }

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedE2E(h.prisma);
    savedDial = (await h.prisma.configSetting.findUnique({ where: { key: 'spanish_market_pct' } }))?.valueJson;
    await h.prisma.configSetting.upsert({ where: { key: 'spanish_market_pct' }, create: { key: 'spanish_market_pct', valueJson: 75 }, update: { valueJson: 75 } });
    setId = (await h.prisma.cardSet.create({ data: { externalId: `idq-${run}`, name: `Set Val ${run}` } })).id;
    cardId = (await h.prisma.card.create({ data: { externalId: `idq-${run}-1`, setId, name: `Carta Val ${run}`, number: '1', rarity: 'Common', availableFinishes: ['normal'] } })).id;
    userId = (await h.prisma.user.create({ data: { email: `idq.${run}@e2e.local`, name: 'Cliente Val', role: 'customer' } })).id;
    await h.prisma.priceReference.create({
      data: { cardId, productType: 'raw', gradeKey: 'raw:NM', finish: 'normal', source: 'manual', priceMxnCents: 40_000, capturedDate: today(), isManualOverride: true, refKind: 'market' },
    });
    const cp = await h.prisma.cardProduct.create({
      data: { cardId, tcgplayerProductId: pid, kind: 'stamped', name: `Liga ${run}`, finishes: ['normal'], stampType: 'prize_pack', sourceGroupId: 22880 },
    });
    await h.prisma.priceReference.create({
      data: { cardId, productType: 'raw', gradeKey: 'raw:NM', finish: 'normal', source: 'manual', cardProductId: cp.id, priceMxnCents: 90_000, capturedDate: today(), isManualOverride: true, refKind: 'market' },
    });
  });

  afterAll(async () => {
    if (h) {
      if (savedDial === undefined) await h.prisma.configSetting.deleteMany({ where: { key: 'spanish_market_pct' } });
      else await h.prisma.configSetting.update({ where: { key: 'spanish_market_pct' }, data: { valueJson: savedDial as Prisma.InputJsonValue } });
      await h.prisma.inventoryItem.deleteMany({ where: { id: { in: ids } } });
      await h.prisma.priceReference.deleteMany({ where: { cardId } });
      await h.prisma.cardProduct.deleteMany({ where: { cardId } });
      await h.prisma.card.deleteMany({ where: { id: cardId } });
      await h.prisma.cardSet.deleteMany({ where: { id: setId } });
      await h.prisma.user.deleteMany({ where: { id: userId } });
      await h.close();
    }
  });

  it('inglés 40 000; español 30 000 (×75 %); liga 90 000; español de liga 67 500 — en bóveda, detalle, reposición y admin', async () => {
    const en = await piece();
    const es = await piece({ language: 'es' });
    const lg = await piece({ cardProductId: pid });
    const esLg = await piece({ language: 'es', cardProductId: pid });
    const vault = h.app.get(VaultService);
    const hold = (await vault.holdings(userId)) as unknown as { holdings?: { inventoryItemId: string; referenceValue: { referenceMxnCents?: number } }[]; data?: { inventoryItemId: string; referenceValue: { referenceMxnCents?: number } }[]; portfolio: { totalValueMxnCents: number } };
    const rows = hold.holdings ?? hold.data ?? [];
    const byId = new Map(rows.map((r) => [r.inventoryItemId, r.referenceValue.referenceMxnCents]));
    expect([byId.get(en.id), byId.get(es.id), byId.get(lg.id), byId.get(esLg.id)]).toEqual([40_000, 30_000, 90_000, 67_500]);
    expect(hold.portfolio.totalValueMxnCents).toBe(40_000 + 30_000 + 90_000 + 67_500);
    expect(await vault.marketRefOf(es)).toMatchObject({ cents: 30_000 });
    expect(await vault.marketRefOf(esLg)).toMatchObject({ cents: 67_500 });
    expect(await vault.marketRefOf(en)).toMatchObject({ cents: 40_000 });
    const av = (await h.app.get(AdminVaultsService).list({ q: `idq.${run}`, page: 1, pageSize: 10 } as never)) as unknown as { data: { userId: string; totalValueMxnCents: number }[] };
    expect(av.data.find((r) => r.userId === userId)?.totalValueMxnCents).toBe(227_500);
    const before = await h.app.get(AdminService).custodyValue();
    await h.prisma.inventoryItem.update({ where: { id: es.id }, data: { language: 'en' } });
    const after = await h.app.get(AdminService).custodyValue();
    expect(after.totalCustodyValueCents - before.totalCustodyValueCents).toBe(40_000 - 30_000);
  });
});
