import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { EnergyType } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { PiiCryptoService } from '../../src/common/crypto/pii-crypto.service';
import { CatalogService, DeckMetaUnitDTO } from '../../src/modules/catalog/catalog.service';
import { DeckMatcherService } from '../../src/modules/decks-meta/deck-matcher.service';
import { DecksMetaService, ENERGY_BUNDLE_PRICE_KEY } from '../../src/modules/decks-meta/decks-meta.service';
import { verifyPullToken } from '../../src/modules/decks-meta/deck-pull-token';
import { accessoryPhotoOf } from '../../src/modules/decks-meta/energy-bundle';
import { MetaDeckLineDTO } from '../../src/modules/decks-meta/decks-meta.dto';

/**
 * 💰 §AC.8 (stream C) contra Postgres REAL con `M-73`: AC-B29 (`basicEnergy` ligado), AC-B30 (`energyBundle` de la ficha,
 * `paste` sin token), AC-B36 («Agregar de jalón» igual) y AC-B32 en su parte de lectura (el validador del servicio lee la
 * lista FIRMADA, el deck publicado, las existencias y el dial de la BD). El catálogo de piezas se stubea como en
 * `decks-meta-persistence.e2e-spec.ts`.
 */
describe('decks-meta energías y paquete (§AC.8, integración)', () => {
  const prisma = new PrismaService();
  const pii = new PiiCryptoService(new ConfigService({ PII_HMAC_KEY: 'z'.repeat(48) }));
  const unitsByCard = new Map<string, DeckMetaUnitDTO[]>();
  const catalog = {
    getSellableRawUnitsByCardIds: jest.fn(async (ids: string[]) => {
      const out = new Map<string, DeckMetaUnitDTO[]>();
      for (const id of ids) if (unitsByCard.has(id)) out.set(id, unitsByCard.get(id)!);
      return out;
    }),
  } as unknown as CatalogService;
  const matcher = new DeckMatcherService(prisma);
  const service = new DecksMetaService(prisma, catalog, matcher, pii);

  const tag = randomUUID().slice(0, 8);
  const setId = `set-${tag}`;
  const cardX = `card-x-${tag}`;
  const cardY = `card-y-${tag}`;
  const slug = `energias-${tag}`;
  const code = tag.replace(/[0-9]/g, (d) => String.fromCharCode(97 + Number(d))).slice(0, 4).toUpperCase();
  const listText = [
    'Pokémon: 6',
    `4 Carta X ${code} 1`,
    `2 Carta Y ${code} 2`,
    'Energy: 10',
    '6 Basic {P} Energy',
    '4 Basic Darkness Energy',
  ].join('\n');
  const X_UNITS = [`inv-x1-${tag}`, `inv-x2-${tag}`];
  const Y_UNITS = [`inv-y1-${tag}`];
  const SIGNED = [...X_UNITS, ...Y_UNITS].sort();

  let energyIds: Record<EnergyType, string>;
  const PHOTO_V = '0123456789abcdef';
  let dialExisted = false;

  async function setEnergy(t: EnergyType, data: { active?: boolean; stockQty?: number; reservedQty?: number; priceCents?: number | null }) {
    // Orden seguro para el CHECK accessory_stock: reservado nunca > existencias.
    if (data.reservedQty !== undefined) await prisma.accessory.update({ where: { id: energyIds[t] }, data: { reservedQty: 0 } });
    await prisma.accessory.update({
      where: { id: energyIds[t] },
      data: {
        ...(data.stockQty !== undefined ? { stockQty: data.stockQty } : {}),
        ...(data.priceCents !== undefined ? { priceCents: data.priceCents } : {}),
        ...(data.active !== undefined ? { active: data.active } : {}),
      },
    });
    if (data.reservedQty !== undefined) await prisma.accessory.update({ where: { id: energyIds[t] }, data: { reservedQty: data.reservedQty } });
  }

  const allLines = (g: { pokemon: MetaDeckLineDTO[]; trainer: MetaDeckLineDTO[]; energy: MetaDeckLineDTO[] }) => [...g.pokemon, ...g.trainer, ...g.energy];

  beforeAll(async () => {
    await prisma.$connect();
    const rows = await prisma.accessory.findMany({ where: { category: 'energy' } });
    energyIds = Object.fromEntries(rows.map((r) => [r.energyType!, r.id])) as Record<EnergyType, string>;
    expect(Object.keys(energyIds).sort()).toEqual(Object.values(EnergyType).sort()); // semilla de M-73
    for (const t of ['psychic', 'darkness'] as EnergyType[]) {
      await prisma.accessory.update({ where: { id: energyIds[t] }, data: { priceCents: 500, photoVersion: PHOTO_V, stockQty: 40, reservedQty: 0, active: true } });
    }
    dialExisted = !!(await prisma.configSetting.findUnique({ where: { key: ENERGY_BUNDLE_PRICE_KEY } }));
    expect(dialExisted).toBe(false); // esquema propio: el dial no existe ⇒ default 2000

    await prisma.cardSet.create({ data: { id: setId, externalId: `ext-${tag}`, name: `Set ${tag}`, ptcgoCode: code } });
    await prisma.card.create({ data: { id: cardX, externalId: `${tag}-1`, setId, name: 'Carta X', number: '1', supertype: 'Pokémon' } });
    await prisma.card.create({ data: { id: cardY, externalId: `${tag}-2`, setId, name: 'Carta Y', number: '2', supertype: 'Pokémon' } });
    unitsByCard.set(cardX, X_UNITS.map((id) => ({ inventoryItemId: id, priceMxnCents: 5000 })));
    unitsByCard.set(cardY, Y_UNITS.map((id) => ({ inventoryItemId: id, priceMxnCents: 7000 })));
    await service.adminCreateOrCurate({ slug, name: `Energías ${tag}`, listText, rank: 1, published: true });
  });

  afterAll(async () => {
    for (const t of Object.values(EnergyType)) {
      await prisma.accessory.update({ where: { id: energyIds[t] }, data: { active: false, reservedQty: 0, stockQty: 0, priceCents: 500, photoVersion: null } });
    }
    await prisma.configSetting.deleteMany({ where: { key: ENERGY_BUNDLE_PRICE_KEY } });
    const decks = await prisma.metaDeck.findMany({ where: { slug: { contains: tag } } });
    for (const d of decks) {
      await prisma.metaDeck.update({ where: { id: d.id }, data: { currentListId: null } });
      await prisma.metaDeckList.updateMany({ where: { deckId: d.id }, data: { supersededById: null } });
      await prisma.metaDeckCard.deleteMany({ where: { list: { deckId: d.id } } });
      await prisma.metaDeckList.deleteMany({ where: { deckId: d.id } });
      await prisma.metaDeck.delete({ where: { id: d.id } });
    }
    await prisma.metaFetchRun.deleteMany({ where: { note: { contains: tag } } });
    await prisma.card.deleteMany({ where: { setId } });
    await prisma.cardSet.deleteMany({ where: { id: setId } });
    await prisma.$disconnect();
  });

  describe('AC-B29 basicEnergy (criterio 734)', () => {
    it('energía con producto activo ⇒ ligada (tipo, id, precio, soldOut, foto); las demás líneas ⇒ null', async () => {
      const d = await service.getBySlug(slug);
      const p = d.groups.energy.find((l) => l.rawName === 'Basic {P} Energy')!;
      expect(p.basicEnergy).toEqual({
        energyType: 'psychic',
        accessoryId: energyIds.psychic,
        unitPriceCents: 500,
        soldOut: false,
        photo: accessoryPhotoOf(energyIds.psychic, PHOTO_V),
      });
      for (const l of d.groups.pokemon) expect(l.basicEnergy).toBeNull();
    });

    it('producto inactivo ⇒ basicEnergy null (la línea se pinta como hoy)', async () => {
      await setEnergy('darkness', { active: false });
      try {
        const d = await service.getBySlug(slug);
        expect(d.groups.energy.find((l) => l.rawName === 'Basic Darkness Energy')!.basicEnergy).toBeNull();
      } finally {
        await setEnergy('darkness', { active: true });
      }
    });

    it('agotado (stock = apartado) ⇒ soldOut true', async () => {
      await setEnergy('psychic', { reservedQty: 40 });
      try {
        const d = await service.getBySlug(slug);
        expect(d.groups.energy.find((l) => l.rawName === 'Basic {P} Energy')!.basicEnergy?.soldOut).toBe(true);
      } finally {
        await setEnergy('psychic', { reservedQty: 0 });
      }
    });

    it('paste: trae basicEnergy por línea, SIN energyBundle ni pullToken (P-EN-7)', async () => {
      const r = await service.paste(listText);
      expect(r).not.toHaveProperty('energyBundle');
      expect(JSON.stringify(r)).not.toContain('pullToken');
      expect(r.groups.energy.find((l) => l.rawName === 'Basic {P} Energy')!.basicEnergy?.accessoryId).toBe(energyIds.psychic);
    });
  });

  describe('AC-B30 energyBundle de la ficha (criterios 735, 740, 745)', () => {
    it('ofrecido: price = dial (default 2000), looseTotal, energies; pullToken firma la unión de jalón y la lista VIGENTE', async () => {
      const d = await service.getBySlug(slug);
      expect(d.energyBundle).toMatchObject({
        offered: true,
        reason: null,
        priceCents: 2000,
        looseTotalCents: 5000,
        energies: [
          { energyType: 'psychic', quantity: 6, accessoryId: energyIds.psychic },
          { energyType: 'darkness', quantity: 4, accessoryId: energyIds.darkness },
        ],
      });
      const deck = await prisma.metaDeck.findUnique({ where: { slug } });
      const v = verifyPullToken(pii, d.energyBundle.pullToken, Math.floor(Date.now() / 1000));
      expect(v.ok && v.payload).toMatchObject({ v: 1, slug, listId: deck!.currentListId, ids: SIGNED });
    });

    it('el dial manda: energy_bundle_price_cents = 6000 ⇒ 5000 ≤ 6000 ⇒ not_offered (P-EN-3)', async () => {
      await prisma.configSetting.create({ data: { key: ENERGY_BUNDLE_PRICE_KEY, valueJson: 6000, updatedBy: 'test' } });
      try {
        const d = await service.getBySlug(slug);
        expect(d.energyBundle).toMatchObject({ offered: false, reason: 'not_offered', priceCents: 6000 });
        expect(typeof d.energyBundle.pullToken).toBe('string'); // SIEMPRE presente
      } finally {
        await prisma.configSetting.deleteMany({ where: { key: ENERGY_BUNDLE_PRICE_KEY } });
      }
    });

    it('dial fuera de rango ⇒ se usa el default 2000 (no se cobra un valor corrupto)', async () => {
      await prisma.configSetting.create({ data: { key: ENERGY_BUNDLE_PRICE_KEY, valueJson: 0, updatedBy: 'test' } });
      try {
        expect((await service.getBySlug(slug)).energyBundle.priceCents).toBe(2000);
      } finally {
        await prisma.configSetting.deleteMany({ where: { key: ENERGY_BUNDLE_PRICE_KEY } });
      }
    });

    it('existencias cortas ⇒ insufficient_stock (6 Psíquica pedidas, 5 disponibles)', async () => {
      await setEnergy('psychic', { reservedQty: 35 });
      try {
        expect((await service.getBySlug(slug)).energyBundle).toMatchObject({ offered: false, reason: 'insufficient_stock' });
      } finally {
        await setEnergy('psychic', { reservedQty: 0 });
      }
    });

    it('P-AC-4: el jalón mete 2 de 6 copias no-energía (< 3) ⇒ not_offered', async () => {
      unitsByCard.set(cardX, [{ inventoryItemId: X_UNITS[0], priceMxnCents: 5000 }]);
      try {
        expect((await service.getBySlug(slug)).energyBundle).toMatchObject({ offered: false, reason: 'not_offered' });
      } finally {
        unitsByCard.set(cardX, X_UNITS.map((id) => ({ inventoryItemId: id, priceMxnCents: 5000 })));
      }
    });
  });

  it('AC-B36 «Agregar de jalón» igual: unitInventoryItemIds, availableQty y precio no cambian', async () => {
    const d = await service.getBySlug(slug);
    const x = d.groups.pokemon.find((l) => l.number === '1')!;
    const y = d.groups.pokemon.find((l) => l.number === '2')!;
    expect([x.unitInventoryItemIds, x.availableQty, x.unitPriceMxnCents]).toEqual([X_UNITS, 2, 5000]);
    expect([y.unitInventoryItemIds, y.availableQty, y.unitPriceMxnCents]).toEqual([Y_UNITS, 1, 7000]);
    for (const l of d.groups.energy) {
      expect([l.unitInventoryItemIds, l.availableQty, l.unitPriceMxnCents, l.card]).toEqual([[], 0, null, null]);
    }
    expect(allLines(d.groups).flatMap((l) => l.unitInventoryItemIds).sort()).toEqual(SIGNED);
  });

  describe('AC-B32 (lectura) DecksMetaService.evaluateDeckPulls', () => {
    it('token de la ficha + todas las piezas ⇒ bundle con precio del dial y componentes por tipo', async () => {
      const { energyBundle } = await service.getBySlug(slug);
      const [r] = await service.evaluateDeckPulls([{ pullToken: energyBundle.pullToken, withEnergyBundle: true }], {
        requestInventoryItemIds: [...SIGNED, 'otra'],
      });
      expect(r).toMatchObject({
        status: 'bundle',
        deckSlug: slug,
        signedInventoryItemIds: SIGNED,
        bundle: { priceCents: 2000, looseTotalCents: 5000 },
      });
      expect(r.status === 'bundle' && r.bundle.energies.map((e) => [e.energyType, e.quantity, e.accessoryId])).toEqual([
        ['psychic', 6, energyIds.psychic],
        ['darkness', 4, energyIds.darkness],
      ]);
    });

    it('falta una pieza firmada ⇒ deck_incomplete', async () => {
      const { energyBundle } = await service.getBySlug(slug);
      const [r] = await service.evaluateDeckPulls([{ pullToken: energyBundle.pullToken, withEnergyBundle: true }], {
        requestInventoryItemIds: SIGNED.slice(1),
      });
      expect(r).toMatchObject({ status: 'invalid', reason: 'deck_incomplete' });
    });

    it('existencias: 5 disponibles ⇒ insufficient_stock; con la propia reserva (+1, retryOfCheckoutToken) ⇒ bundle', async () => {
      const { energyBundle } = await service.getBySlug(slug);
      await setEnergy('psychic', { reservedQty: 35 });
      try {
        const pulls = [{ pullToken: energyBundle.pullToken, withEnergyBundle: true }];
        const [a] = await service.evaluateDeckPulls(pulls, { requestInventoryItemIds: SIGNED });
        expect(a).toMatchObject({ status: 'invalid', reason: 'insufficient_stock' });
        const [b] = await service.evaluateDeckPulls(pulls, {
          requestInventoryItemIds: SIGNED,
          extraAvailableByAccessoryId: new Map([[energyIds.psychic, 1]]),
        });
        expect(b.status).toBe('bundle');
      } finally {
        await setEnergy('psychic', { reservedQty: 0 });
      }
    });

    it('deck despublicado o en pausa ⇒ deck_unpublished', async () => {
      const { energyBundle } = await service.getBySlug(slug);
      const deck = (await prisma.metaDeck.findUnique({ where: { slug } }))!;
      const pulls = [{ pullToken: energyBundle.pullToken, withEnergyBundle: true }];
      try {
        await prisma.metaDeck.update({ where: { id: deck.id }, data: { pausedByOperator: true } });
        expect((await service.evaluateDeckPulls(pulls, { requestInventoryItemIds: SIGNED }))[0]).toMatchObject({ reason: 'deck_unpublished' });
        await prisma.metaDeck.update({ where: { id: deck.id }, data: { pausedByOperator: false, published: false } });
        expect((await service.evaluateDeckPulls(pulls, { requestInventoryItemIds: SIGNED }))[0]).toMatchObject({ reason: 'deck_unpublished' });
      } finally {
        await prisma.metaDeck.update({ where: { id: deck.id }, data: { pausedByOperator: false, published: true } });
      }
    });

    it('token de otra llave ⇒ invalid_token; vencido (reloj +31 d) ⇒ expired', async () => {
      const other = new DecksMetaService(prisma, catalog, matcher, new PiiCryptoService(new ConfigService({ PII_HMAC_KEY: 'q'.repeat(48) })));
      const { energyBundle } = await other.getBySlug(slug);
      const [a] = await service.evaluateDeckPulls([{ pullToken: energyBundle.pullToken, withEnergyBundle: true }], { requestInventoryItemIds: SIGNED });
      expect(a).toMatchObject({ status: 'invalid', reason: 'invalid_token', deckSlug: null });
      const mine = (await service.getBySlug(slug)).energyBundle.pullToken;
      const [b] = await service.evaluateDeckPulls([{ pullToken: mine, withEnergyBundle: true }], {
        requestInventoryItemIds: SIGNED,
        now: new Date(Date.now() + 31 * 24 * 3600 * 1000),
      });
      expect(b).toMatchObject({ status: 'invalid', reason: 'expired', deckSlug: slug });
    });

    it('acepta un cliente de transacción (la sesión de B valida dentro de su tx)', async () => {
      const { energyBundle } = await service.getBySlug(slug);
      const r = await prisma.$transaction((tx) =>
        service.evaluateDeckPulls([{ pullToken: energyBundle.pullToken, withEnergyBundle: false }], { requestInventoryItemIds: SIGNED, db: tx }),
      );
      expect(r[0].status).toBe('offer');
    });

    it('la lista se re-cura (otra energía): el token viejo sigue leyendo la lista FIRMADA', async () => {
      const { energyBundle } = await service.getBySlug(slug);
      const signedListId = (await prisma.metaDeck.findUnique({ where: { slug } }))!.currentListId;
      await service.adminCreateOrCurate({
        slug, name: `Energías ${tag}`, rank: 1, published: true,
        listText: [`4 Carta X ${code} 1`, `2 Carta Y ${code} 2`, '12 Basic {M} Energy'].join('\n'),
      });
      const now = (await prisma.metaDeck.findUnique({ where: { slug } }))!.currentListId;
      expect(now).not.toBe(signedListId);
      const [r] = await service.evaluateDeckPulls([{ pullToken: energyBundle.pullToken, withEnergyBundle: true }], {
        requestInventoryItemIds: SIGNED,
      });
      expect(r.status === 'bundle' && r.metaDeckListId).toBe(signedListId);
      expect(r.status === 'bundle' && r.bundle.energies.map((e) => e.energyType)).toEqual(['psychic', 'darkness']);
      // La ficha nueva firma la lista nueva (y metal no tiene producto activo ⇒ not_offered).
      const fresh = await service.getBySlug(slug);
      expect(fresh.energyBundle).toMatchObject({ offered: false, reason: 'not_offered', energies: [{ energyType: 'metal', quantity: 12, accessoryId: null }] });
    });
  });
});
