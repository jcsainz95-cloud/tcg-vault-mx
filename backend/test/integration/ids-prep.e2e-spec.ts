/**
 * ids-prep.e2e-spec.ts — v1.116⟨ids⟩ (API_CONTRACT §IDS.5 «Pedidos por preparar») contra Postgres REAL y la app por HTTP.
 * Propiedad: backend. La hoja de preparación de un envío directo trae `versionInternalLine` por línea, leída del `OrderItem`
 * de origen (CONGELADO), no de la pieza: «ES · LIGA · Prize Pack — sello Play! Pokémon, Cosmos Holo»; `null` en inglés sin
 * liga. Determinista (N=1).
 */
import { randomUUID } from 'crypto';
import { E2EHarness } from './helpers/e2e-app';
import { seedE2E } from '../../prisma/seed-e2e';
import { ShipPrepDb } from './helpers/ship-prep-db';
import { ShipmentPrepService } from '../../src/modules/shipments/shipment-prep.service';

jest.setTimeout(120_000);

describe('E2E — §IDS.5 versionInternalLine en «Pedidos por preparar»', () => {
  let h: E2EHarness;
  let db: ShipPrepDb;

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedE2E(h.prisma);
    db = new ShipPrepDb(h, `idp${randomUUID().slice(0, 6)}`);
    await db.init();
  });

  afterAll(async () => {
    if (h) {
      await db?.cleanup();
      await h.close();
    }
  });

  it('una línea española de liga lleva su línea interna; la inglesa sin liga, null; la pieza corregida después no la cambia', async () => {
    const { shipment, orderItems, pieces } = await db.mkDirect({ prices: [10_000, 20_000] });
    await h.prisma.orderItem.update({
      where: { id: orderItems[0].id },
      data: { language: 'es', stampType: 'prize_pack', stampLabel: 'Cosmos Holo' },
    });
    // La pieza se «corrige» después: la hoja sigue leyendo lo congelado.
    await h.prisma.inventoryItem.update({ where: { id: pieces[0].id }, data: { language: 'en' } });
    const r = await db.queue();
    expect(r.status).toBe(200);
    const row = (r.body.data as { shipmentId: string; items: { inventoryItemId: string; versionInternalLine: string | null }[] }[]).find(
      (x) => x.shipmentId === shipment.id,
    )!;
    const items = row.items;
    const byPiece = new Map(items.map((i) => [i.inventoryItemId, i.versionInternalLine]));
    expect(byPiece.get(pieces[0].id)).toBe('ES · LIGA · Prize Pack — sello Play! Pokémon, Cosmos Holo');
    expect(byPiece.get(pieces[1].id)).toBeNull();
  });

  /**
   * IDS-B27 (v1.116.4, D-IDS-T) — un RETIRO de bóveda sin pedido de origen toma la línea de la PIEZA (`language` + su producto
   * `stamped`, rótulo vigente) con la misma `versionInternalLineOf`; con origen manda el `OrderItem` aunque cambie
   * `CardProduct.stampLabel`; `(en, null)` y una promo `en` sin origen ⇒ `null` (promo/Deck Exclusive no es liga).
   */
  describe('IDS-B27 — retiro sin pedido de origen: `versionInternalLine` de la pieza (D-IDS-T)', () => {
    const stampedPid = 500_000_000 + Math.floor(Math.random() * 90_000_000);
    const promoPid = stampedPid + 1;
    let stampedId: string;

    beforeAll(async () => {
      stampedId = (
        await h.prisma.cardProduct.create({
          data: { cardId: db.cardId, tcgplayerProductId: stampedPid, kind: 'stamped', name: `Liga B27 ${stampedPid}`, finishes: ['normal'], stampType: 'prize_pack', stampLabel: 'Cosmos Holo', sourceGroupId: 22880 },
        })
      ).id;
      await h.prisma.cardProduct.create({ data: { cardId: db.cardId, tcgplayerProductId: promoPid, kind: 'promo', name: `Promo B27 ${promoPid}`, finishes: ['normal'] } });
    });

    afterAll(async () => {
      await db.cleanup();
      await h.prisma.cardProduct.deleteMany({ where: { tcgplayerProductId: { in: [stampedPid, promoPid] } } });
    });

    async function sheet(shipmentId: string): Promise<Map<string, string | null>> {
      const prep = h.app.get(ShipmentPrepService);
      const row = await prep.loadRow(h.prisma, shipmentId);
      const view = await prep.buildView(h.prisma, row!);
      return new Map(view.items.map((i) => [i.inventoryItemId, i.versionInternalLine]));
    }

    it('sin origen: `es` + liga ⇒ la línea de la pieza; `(en, null)` y promo `en` ⇒ null', async () => {
      const u = await db.mkUser('Retiro B27');
      const mk = async (data: { language?: 'es'; cardProductId?: number }) => {
        const p = await db.mkPiece({ status: 'in_custody', ownerType: 'customer', ownerUserId: u.id, ownershipStatus: 'settled' });
        if (data.language || data.cardProductId) await h.prisma.inventoryItem.update({ where: { id: p.id }, data });
        return p;
      };
      const esLiga = await mk({ language: 'es', cardProductId: stampedPid });
      const en = await mk({});
      const promo = await mk({ cardProductId: promoPid });
      const w = await db.mkWithdrawal(u.id, [esLiga.id, en.id, promo.id], 'picking');
      const by = await sheet(w.shipment.id);
      expect(by.get(esLiga.id)).toBe('ES · LIGA · Prize Pack — sello Play! Pokémon, Cosmos Holo');
      expect(by.get(en.id)).toBeNull();
      expect(by.get(promo.id)).toBeNull();
    });

    it('con origen: manda el `OrderItem` congelado aunque cambie `CardProduct.stampLabel`', async () => {
      const u = await db.mkUser('Retiro B27 origen');
      const vo = await db.mkVaultOrder(u.id, { prices: [50000, 30000], placement: 'none' });
      await h.prisma.inventoryItem.update({ where: { id: vo.pieces[0].id }, data: { language: 'es', cardProductId: stampedPid } });
      await h.prisma.orderItem.update({ where: { id: vo.orderItems[0].id }, data: { language: 'es', stampType: 'prize_pack', stampLabel: 'Cosmos Holo' } });
      await h.prisma.cardProduct.update({ where: { id: stampedId }, data: { stampLabel: 'Rótulo Nuevo' } });
      try {
        const w = await db.mkWithdrawal(u.id, [vo.pieces[0].id, vo.pieces[1].id], 'picking');
        const by = await sheet(w.shipment.id);
        expect(by.get(vo.pieces[0].id)).toBe('ES · LIGA · Prize Pack — sello Play! Pokémon, Cosmos Holo');
        expect(by.get(vo.pieces[1].id)).toBeNull();
      } finally {
        await h.prisma.cardProduct.update({ where: { id: stampedId }, data: { stampLabel: 'Cosmos Holo' } });
      }
    });
  });
});
