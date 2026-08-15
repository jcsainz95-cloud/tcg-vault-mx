import { ConfigService } from '@nestjs/config';
import { UploadsService } from '../src/modules/uploads/uploads.service';

/**
 * v1.2 (API_CONTRACT §8) — Uploads acotado SOLO a `kyc_ine` (INE del buylist).
 *  - `POST /uploads/presign` con `purpose=kyc_ine` → presign PUT válido.
 *  - `inventory_photo` / `dispute_claim` (o cualquier otro) → 422 VALIDATION_ERROR.
 */

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn(async () => 'https://s3.internal/kyc_ine/2026-08-14/obj.png?X-Amz-Signature=abc'),
}));

function buildConfig(overrides: Record<string, string> = {}): ConfigService {
  const values: Record<string, string> = {
    S3_REGION: 'us-east-1',
    S3_ENDPOINT: 'http://localhost:9000',
    S3_BUCKET: 'tcg-ine',
    S3_ACCESS_KEY_ID: 'minioadmin',
    S3_SECRET_ACCESS_KEY: 'minioadmin',
    ...overrides,
  };
  return { get: (k: string) => values[k] } as unknown as ConfigService;
}

describe('UploadsService.presign — solo kyc_ine (v1.2)', () => {
  it('acepta purpose=kyc_ine y devuelve presign PUT con key bajo kyc_ine/', async () => {
    const svc = new UploadsService(buildConfig());
    const res = await svc.presign('kyc_ine', 'image/png');
    expect(res.method).toBe('PUT');
    expect(typeof res.uploadUrl).toBe('string');
    expect(res.uploadKey.startsWith('kyc_ine/')).toBe(true);
    expect(res.headers['Content-Type']).toBe('image/png');
  });

  it('rechaza purpose=inventory_photo con 422 VALIDATION_ERROR', async () => {
    const svc = new UploadsService(buildConfig());
    await expect(svc.presign('inventory_photo', 'image/png')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('rechaza purpose=dispute_claim con 422 VALIDATION_ERROR', async () => {
    const svc = new UploadsService(buildConfig());
    await expect(svc.presign('dispute_claim', 'image/png')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('rechaza cualquier otro propósito arbitrario', async () => {
    const svc = new UploadsService(buildConfig());
    await expect(svc.presign('whatever', 'image/png')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });
});

describe('UploadsService.presign — allow-list de content-type (S-B3)', () => {
  it('acepta image/jpeg', async () => {
    const svc = new UploadsService(buildConfig());
    const res = await svc.presign('kyc_ine', 'image/jpeg');
    expect(res.method).toBe('PUT');
    expect(res.uploadKey.endsWith('.jpeg')).toBe(true);
  });

  it('rechaza text/html (no-imagen) con 422 VALIDATION_ERROR', async () => {
    const svc = new UploadsService(buildConfig());
    await expect(svc.presign('kyc_ine', 'text/html')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('rechaza application/pdf con 422 VALIDATION_ERROR', async () => {
    const svc = new UploadsService(buildConfig());
    await expect(svc.presign('kyc_ine', 'application/pdf')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('rechaza application/octet-stream con 422 VALIDATION_ERROR', async () => {
    const svc = new UploadsService(buildConfig());
    await expect(svc.presign('kyc_ine', 'application/octet-stream')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });
});

describe('UploadsService.presign — límite de tamaño (S-B3)', () => {
  it('acepta un contentLength dentro del tope y lo refleja en headers', async () => {
    const svc = new UploadsService(buildConfig());
    const res = await svc.presign('kyc_ine', 'image/png', 2 * 1024 * 1024);
    expect(res.method).toBe('PUT');
    expect(res.headers['Content-Length']).toBe(String(2 * 1024 * 1024));
    expect(res.maxBytes).toBe(10 * 1024 * 1024);
  });

  it('rechaza un archivo por encima del tope por defecto (10 MiB) con 422', async () => {
    const svc = new UploadsService(buildConfig());
    await expect(
      svc.presign('kyc_ine', 'image/png', 10 * 1024 * 1024 + 1),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('respeta el tope configurable por env KYC_UPLOAD_MAX_BYTES', async () => {
    const svc = new UploadsService(buildConfig({ KYC_UPLOAD_MAX_BYTES: '1048576' }));
    await expect(svc.presign('kyc_ine', 'image/png', 1048577)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    const ok = await svc.presign('kyc_ine', 'image/png', 1048576);
    expect(ok.maxBytes).toBe(1048576);
  });

  it('rechaza contentLength no positivo con 422', async () => {
    const svc = new UploadsService(buildConfig());
    await expect(svc.presign('kyc_ine', 'image/png', 0)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });
});
