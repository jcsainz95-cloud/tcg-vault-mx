import { DisputesService } from '../src/modules/disputes/disputes.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { StripeService } from '../src/modules/payments/stripe.service';
import { UploadsService } from '../src/modules/uploads/uploads.service';

/**
 * IMPORTANTE (QA) — POST /disputes debe devolver `type` en la respuesta 201 (API_CONTRACT §7).
 * El `type` se deriva server-side del productType: raw→condition_raw, sealed→condition_sealed.
 */
describe('DisputesService.create — la respuesta 201 incluye `type`', () => {
  function build(productType: string) {
    const prisma: any = {
      inventoryItem: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'item1',
          ownerUserId: 'u1',
          productType,
          frontPhotoKey: 'front.jpg',
          backPhotoKey: 'back.jpg',
        }),
      },
      shipmentItem: { findFirst: jest.fn().mockResolvedValue(null) },
      dispute: {
        create: jest.fn(async ({ data }: any) => ({
          id: 'd1',
          status: data.status,
          type: data.type,
          deadlineAt: data.deadlineAt,
        })),
      },
    };
    const svc = new DisputesService(
      prisma as PrismaService,
      {} as StripeService,
      {} as UploadsService,
    );
    return { svc, prisma };
  }

  it('raw → type=condition_raw', async () => {
    const { svc } = build('raw');
    const res = await svc.create('u1', 'item1', 'llegó dañada', ['claim.jpg']);
    expect(res.type).toBe('condition_raw');
    expect(res).toMatchObject({ disputeId: 'd1', status: 'abierta' });
    expect(res.deadlineAt).toBeInstanceOf(Date);
  });

  it('sealed → type=condition_sealed', async () => {
    const { svc } = build('sealed');
    const res = await svc.create('u1', 'item1', 'caja abierta', ['claim.jpg']);
    expect(res.type).toBe('condition_sealed');
  });

  it('graded → 422 NOT_RAW (no aplica disputa de condición)', async () => {
    const { svc, prisma } = build('graded');
    await expect(svc.create('u1', 'item1', 'x', ['c.jpg'])).rejects.toMatchObject({ code: 'NOT_RAW' });
    expect(prisma.dispute.create).not.toHaveBeenCalled();
  });
});
