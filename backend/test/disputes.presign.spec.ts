import { DisputesService } from '../src/modules/disputes/disputes.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { StripeService } from '../src/modules/payments/stripe.service';
import { UploadsService } from '../src/modules/uploads/uploads.service';

/**
 * SEC-A5: las fotos de INE/KYC y de disputa NO se sirven por URL pública del bucket;
 * se generan URLs prefirmadas de lectura de vida corta. Aquí verificamos que `adminGet`
 * usa `UploadsService.presignGet` y no la base pública `S3_PUBLIC_BASE_URL`.
 */
describe('DisputesService.adminGet — SEC-A5 presigned GET (no URL pública)', () => {
  const PUBLIC_BASE = 'https://public-cdn.example.com';

  beforeEach(() => {
    process.env.S3_PUBLIC_BASE_URL = PUBLIC_BASE;
  });

  it('sirve las fotos por presign de lectura, nunca por la base pública del bucket', async () => {
    const prisma: any = {
      dispute: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'd1',
          status: 'abierta',
          description: 'raspón',
          ingressPhotoKeys: ['kyc_ine/2026/ingress-front.jpg'],
          claimPhotoKeys: ['dispute_claim/2026/claim.jpg'],
          inventoryItem: { id: 'inv1', card: {} },
        }),
      },
    };
    const uploads = {
      presignGet: jest.fn(async (key: string) => `https://s3.internal/${key}?X-Amz-Signature=abc123`),
    } as unknown as UploadsService;
    const svc = new DisputesService(prisma as PrismaService, {} as StripeService, uploads);

    const res = await svc.adminGet('d1');

    expect(uploads.presignGet).toHaveBeenCalledWith('kyc_ine/2026/ingress-front.jpg');
    expect(uploads.presignGet).toHaveBeenCalledWith('dispute_claim/2026/claim.jpg');
    expect(res.ingressPhotoUrls[0]).toContain('X-Amz-Signature=');
    expect(res.claimPhotoUrls[0]).toContain('X-Amz-Signature=');
    // Ninguna URL debe apoyarse en la base pública del bucket.
    expect(res.ingressPhotoUrls[0].startsWith(PUBLIC_BASE)).toBe(false);
    expect(res.claimPhotoUrls[0].startsWith(PUBLIC_BASE)).toBe(false);
  });
});
