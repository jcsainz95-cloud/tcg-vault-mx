import { DisputesService } from '../src/modules/disputes/disputes.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { StripeService } from '../src/modules/payments/stripe.service';
import { DISPUTE_EVIDENCE_CONTACT } from '../src/modules/disputes/disputes.constants';

/**
 * v1.2 — La disputa de condición ya NO tiene comparador de fotos de ingreso/reclamo:
 * la evidencia se envía por CORREO a soporte. `adminGet` no debe generar ninguna URL de
 * foto; expone `evidenceContact` (correo de soporte) y los datos del item (para gradeadas,
 * gradingCompany + gradeValue + certNumber).
 */
describe('DisputesService.adminGet — v1.2 evidencia por correo (sin fotos)', () => {
  it('no sirve fotos y expone evidenceContact + datos del item', async () => {
    const prisma: any = {
      dispute: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'd1',
          status: 'abierta',
          description: 'raspón',
          type: 'condition_raw',
          deadlineAt: new Date('2026-08-21T00:00:00Z'),
          inventoryItem: {
            id: 'inv1',
            productType: 'graded',
            gradingCompany: 'PSA',
            gradeValue: '10',
            certNumber: 'PSA-12345678',
            card: {},
          },
        }),
      },
    };
    const svc = new DisputesService(prisma as PrismaService, {} as StripeService);

    const res: any = await svc.adminGet('d1');

    expect(res.evidenceContact).toBe(DISPUTE_EVIDENCE_CONTACT);
    expect(res).not.toHaveProperty('ingressPhotoUrls');
    expect(res).not.toHaveProperty('claimPhotoUrls');
    expect(res.item.certNumber).toBe('PSA-12345678');
    expect(res.type).toBe('condition_raw');
  });
});
