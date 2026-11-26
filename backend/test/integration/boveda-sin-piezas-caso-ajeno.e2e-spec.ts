/**
 * §BOVEDA-COBRADA-SIN-PIEZAS (menor I-A de qa) — un caso «Por reponer» excluye SOLO la línea que lo originó
 * (`originOrderItemId`), no cualquier línea cuya pieza toque otro caso.
 */
import { E2EHarness } from './helpers/e2e-app';
import { VaultOrphansDb } from './helpers/vault-orphans-db';
import { findUnassignedLines } from '../../src/modules/payments/vault-orphans';

const RUN = Date.now().toString(36);

describe('§BOVEDA-COBRADA-SIN-PIEZAS — el caso «Por reponer» de otra línea no oculta la mía', () => {
  let h: E2EHarness;
  let fx: VaultOrphansDb;
  beforeAll(async () => {
    h = await E2EHarness.create();
    fx = new VaultOrphansDb(h, `ca${RUN}`);
    await fx.init();
  });
  afterAll(async () => {
    if (h) {
      await fx.cleanup();
      await h.close();
    }
  });

  it('caso de OTRA línea sobre la misma pieza ⇒ mi línea sigue «sin asignar»; caso de MI línea ⇒ excluida', async () => {
    const a = await fx.user('a');
    const b = await fx.user('b');
    const card = await fx.card('ajeno');
    const p = await fx.piece(card.id, { status: 'picking' }); // pieza que NO es del comprador A
    const q = await fx.piece(card.id, { status: 'in_custody', ownerType: 'customer', ownerUserId: b.id, ownershipStatus: 'settled' });
    const { order: orderA, lines: linesA } = await fx.settledVaultOrder(a.id, [p]);
    const { lines: linesB } = await fx.settledVaultOrder(b.id, [q]);
    const caseOf = async (originLine: string, pieceId: string, owner: string) =>
      h.prisma.replacementCase.create({
        data: {
          source: 'vault_purchase',
          customerUserId: owner,
          originalInventoryItemId: pieceId,
          originOrderItemId: originLine,
          placementItemId: (await h.prisma.vaultPlacementItem.findFirstOrThrow({ where: { orderItemId: originLine } })).id,
          missingReason: 'not_found',
          openedAt: new Date(),
          openedByUserId: b.id,
        },
      });
    const foreign = await caseOf(linesB[0].id, p.id, b.id); // toca la pieza P, pero nace de la línea de B
    expect((await findUnassignedLines(h.prisma, { orderIds: [orderA.id] })).map((l) => l.orderItemId)).toEqual([linesA[0].id]);
    await h.prisma.replacementCase.delete({ where: { id: foreign.id } });
    await caseOf(linesA[0].id, p.id, a.id); // nace de MI línea ⇒ ya está tratada
    expect(await findUnassignedLines(h.prisma, { orderIds: [orderA.id] })).toEqual([]);
  });
});
