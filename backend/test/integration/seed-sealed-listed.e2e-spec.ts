/**
 * seed-sealed-listed.e2e-spec.ts — v1.87.4⟨wishlist⟩ (WSH-F5, petición de frontend). Propiedad: backend.
 *
 * El seed sintético deja UNA pieza sellada publicada (`E2E_SEALED_LISTED`): sin ella `GET /catalog/sealed` daba `total: 0`
 * contra el stack y el «avísame» con el cuerpo de la pantalla no se podía medir de punta a punta. Se mide por HTTP lo que
 * frontend usará: la teja en `GET /catalog/sealed?q=<nombre de la CARTA ancla>` (el `q` del grid busca por `Card.name`, no por
 * el nombre del producto) con precio, la ficha `GET /catalog/sealed/:id`, y que el seed
 * la RESETEA (vendida y desmapeada ⇒ re-seed ⇒ a la venta y mapeada otra vez).
 */
import { E2EHarness } from './helpers/e2e-app';
import { seedE2E } from '../../prisma/seed-e2e';
import { E2E_CARDS, E2E_SEALED_LISTED } from '../../prisma/e2e-fixtures';

describe('seed sintético — la pieza SELLADA a la venta (E2E_SEALED_LISTED)', () => {
  let h: E2EHarness;

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedE2E(h.prisma);
  });
  afterAll(async () => {
    await h?.close();
  });

  const tile = async () => {
    const r = await h.api('GET', `/catalog/sealed?q=${encodeURIComponent(E2E_CARDS.thirdraw.name)}&pageSize=100`);
    expect(r.status).toBe(200);
    return r.body as { data: Record<string, unknown>[]; total: number };
  };

  it('aparece en `GET /catalog/sealed?q=<carta ancla>` con precio, y su ficha resuelve al mismo producto mapeado', async () => {
    const piece = await h.prisma.inventoryItem.findUniqueOrThrow({ where: { folio: E2E_SEALED_LISTED.folio } });
    expect({
      productType: piece.productType,
      status: piece.status,
      ownerType: piece.ownerType,
      tcgplayerProductId: piece.tcgplayerProductId,
      tcgplayerGroupId: piece.tcgplayerGroupId,
      listPriceCents: piece.listPriceCents,
    }).toEqual({
      productType: 'sealed',
      status: 'listed',
      ownerType: 'platform',
      tcgplayerProductId: E2E_SEALED_LISTED.tcgplayerProductId,
      tcgplayerGroupId: E2E_SEALED_LISTED.tcgplayerGroupId,
      listPriceCents: E2E_SEALED_LISTED.listPriceCents,
    });

    const body = await tile();
    const mine = body.data.filter((d) => JSON.stringify(d).includes(E2E_SEALED_LISTED.productName));
    expect(mine).toHaveLength(1);
    expect(mine[0].fromPriceCents).toEqual(expect.any(Number));
    expect(mine[0].fromPriceCents as number).toBeGreaterThan(0);

    const detail = await h.api('GET', `/catalog/sealed/${piece.id}`);
    expect(detail.status).toBe(200);
    expect(typeof detail.body.group.representativeItemId).toBe('string');
    expect(JSON.stringify(detail.body)).toContain(E2E_SEALED_LISTED.productName);
  });

  it('re-seed la devuelve a la venta y mapeada aunque un flujo la haya vendido y desmapeado', async () => {
    await h.prisma.inventoryItem.update({
      where: { folio: E2E_SEALED_LISTED.folio },
      data: { status: 'shipped', tcgplayerProductId: null, tcgplayerGroupId: null },
    });
    await seedE2E(h.prisma);
    const piece = await h.prisma.inventoryItem.findUniqueOrThrow({ where: { folio: E2E_SEALED_LISTED.folio } });
    expect({ status: piece.status, tcg: piece.tcgplayerProductId }).toEqual({ status: 'listed', tcg: E2E_SEALED_LISTED.tcgplayerProductId });
    expect(JSON.stringify((await tile()).data)).toContain(E2E_SEALED_LISTED.productName);
  });
});
