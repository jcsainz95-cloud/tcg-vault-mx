import { DisputesService } from '../src/modules/disputes/disputes.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { StripeService } from '../src/modules/payments/stripe.service';
import { DISPUTE_EVIDENCE_CONTACT } from '../src/modules/disputes/disputes.constants';

/**
 * IMPORTANTE (QA) — POST /disputes debe devolver `type` en la respuesta 201 (API_CONTRACT §7).
 * El `type` se deriva server-side del productType: raw→condition_raw, sealed→condition_sealed.
 * v1.2: la respuesta incluye `evidenceContact` (correo de soporte) y ya NO se envían fotos.
 */
describe('DisputesService.create — la respuesta 201 incluye `type` y `evidenceContact`', () => {
  function build(productType: string) {
    const prisma: any = {
      inventoryItem: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'item1',
          ownerUserId: 'u1',
          productType,
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
    const svc = new DisputesService(prisma as PrismaService, {} as StripeService);
    return { svc, prisma };
  }

  it('raw → type=condition_raw + evidenceContact', async () => {
    const { svc } = build('raw');
    const res = await svc.create('u1', 'item1', 'llegó dañada');
    expect(res.type).toBe('condition_raw');
    expect(res).toMatchObject({ disputeId: 'd1', status: 'abierta' });
    expect(res.deadlineAt).toBeInstanceOf(Date);
    expect(res.evidenceContact).toBe(DISPUTE_EVIDENCE_CONTACT);
  });

  it('sealed → type=condition_sealed', async () => {
    const { svc } = build('sealed');
    const res = await svc.create('u1', 'item1', 'caja abierta');
    expect(res.type).toBe('condition_sealed');
    expect(res.evidenceContact).toBe(DISPUTE_EVIDENCE_CONTACT);
  });

  it('graded → 422 NOT_RAW (no aplica disputa de condición)', async () => {
    const { svc, prisma } = build('graded');
    await expect(svc.create('u1', 'item1', 'x')).rejects.toMatchObject({ code: 'NOT_RAW' });
    expect(prisma.dispute.create).not.toHaveBeenCalled();
  });

  it('no persiste claves de foto (v1.2 sin fotos)', async () => {
    const { svc, prisma } = build('raw');
    await svc.create('u1', 'item1', 'llegó dañada');
    const data = prisma.dispute.create.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('ingressPhotoKeys');
    expect(data).not.toHaveProperty('claimPhotoKeys');
  });
});
