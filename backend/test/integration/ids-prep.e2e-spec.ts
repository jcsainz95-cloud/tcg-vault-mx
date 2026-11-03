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
});
