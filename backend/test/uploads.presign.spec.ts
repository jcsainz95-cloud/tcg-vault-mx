import { ConfigService } from '@nestjs/config';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { UploadsService } from '../src/modules/uploads/uploads.service';

/**
 * v1.2 (API_CONTRACT §8) — Uploads acotado SOLO a `kyc_ine` (INE del buylist).
 *  - `POST /uploads/presign` con `purpose=kyc_ine` → presign PUT válido.
 *  - `inventory_photo` / `dispute_claim` (o cualquier otro) → 422 VALIDATION_ERROR.
 */

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn(async () => 'https://s3.internal/kyc_ine/2026-08-14/obj.png?X-Amz-Signature=abc'),
}));

// BUG A1 (INE): capturamos la config con la que se construye el S3Client para verificar que se
// pasa `requestChecksumCalculation: 'WHEN_REQUIRED'` (y su par de response). Con el default del
// SDK v3 (`WHEN_SUPPORTED`) el presign firma headers de checksum que el navegador NO envía en el
// PUT directo a R2 → 403 SignatureDoesNotMatch. Stubs de los Command para no romper el import.
const s3ClientCtorArgs: Array<Record<string, unknown>> = [];
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation((cfg: Record<string, unknown>) => {
    s3ClientCtorArgs.push(cfg);
    return { send: jest.fn() };
  }),
  PutObjectCommand: jest.fn().mockImplementation((input) => ({ input })),
  GetObjectCommand: jest.fn().mockImplementation((input) => ({ input })),
  DeleteObjectCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

/** v1.70 (C15): el presign REGISTRA la key a nombre de quien la pidió ⇒ necesita Prisma. */
const USER_ID = 'user-e2e-1';
const grants: { userId: string; objectKey: string; contentType: string }[] = [];
function buildPrisma() {
  return {
    kycUploadGrant: {
      create: jest.fn(async ({ data }: { data: (typeof grants)[number] }) => {
        grants.push(data);
        return data;
      }),
    },
  } as unknown as import('../src/prisma/prisma.service').PrismaService;
}

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
    const svc = new UploadsService(buildConfig(), buildPrisma());
    const res = await svc.presign(USER_ID, 'kyc_ine', 'image/png', 1024);
    expect(res.method).toBe('PUT');
    expect(typeof res.uploadUrl).toBe('string');
    expect(res.uploadKey.startsWith('kyc_ine/')).toBe(true);
    expect(res.headers['Content-Type']).toBe('image/png');
  });

  it('rechaza purpose=inventory_photo con 422 VALIDATION_ERROR', async () => {
    const svc = new UploadsService(buildConfig(), buildPrisma());
    await expect(svc.presign(USER_ID, 'inventory_photo', 'image/png')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('rechaza purpose=dispute_claim con 422 VALIDATION_ERROR', async () => {
    const svc = new UploadsService(buildConfig(), buildPrisma());
    await expect(svc.presign(USER_ID, 'dispute_claim', 'image/png')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('rechaza cualquier otro propósito arbitrario', async () => {
    const svc = new UploadsService(buildConfig(), buildPrisma());
    await expect(svc.presign(USER_ID, 'whatever', 'image/png')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });
});

describe('UploadsService.presign — allow-list de content-type (S-B3)', () => {
  it('acepta image/jpeg', async () => {
    const svc = new UploadsService(buildConfig(), buildPrisma());
    const res = await svc.presign(USER_ID, 'kyc_ine', 'image/jpeg', 1024);
    expect(res.method).toBe('PUT');
    expect(res.uploadKey.endsWith('.jpeg')).toBe(true);
  });

  it('rechaza text/html (no-imagen) con 422 VALIDATION_ERROR', async () => {
    const svc = new UploadsService(buildConfig(), buildPrisma());
    await expect(svc.presign(USER_ID, 'kyc_ine', 'text/html')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('rechaza application/pdf con 422 VALIDATION_ERROR', async () => {
    const svc = new UploadsService(buildConfig(), buildPrisma());
    await expect(svc.presign(USER_ID, 'kyc_ine', 'application/pdf')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('rechaza application/octet-stream con 422 VALIDATION_ERROR', async () => {
    const svc = new UploadsService(buildConfig(), buildPrisma());
    await expect(svc.presign(USER_ID, 'kyc_ine', 'application/octet-stream')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });
});

describe('UploadsService.presign — límite de tamaño (S-B3)', () => {
  it('acepta un contentLength dentro del tope y lo refleja en headers', async () => {
    const svc = new UploadsService(buildConfig(), buildPrisma());
    const res = await svc.presign(USER_ID, 'kyc_ine', 'image/png', 2 * 1024 * 1024);
    expect(res.method).toBe('PUT');
    expect(res.headers['Content-Length']).toBe(String(2 * 1024 * 1024));
    expect(res.maxBytes).toBe(10 * 1024 * 1024);
  });

  it('rechaza un archivo por encima del tope por defecto (10 MiB) con 422', async () => {
    const svc = new UploadsService(buildConfig(), buildPrisma());
    await expect(
      svc.presign(USER_ID, 'kyc_ine', 'image/png', 10 * 1024 * 1024 + 1),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('respeta el tope configurable por env KYC_UPLOAD_MAX_BYTES', async () => {
    const svc = new UploadsService(buildConfig({ KYC_UPLOAD_MAX_BYTES: '1048576' }), buildPrisma());
    await expect(svc.presign(USER_ID, 'kyc_ine', 'image/png', 1048577)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    const ok = await svc.presign(USER_ID, 'kyc_ine', 'image/png', 1048576);
    expect(ok.maxBytes).toBe(1048576);
  });

  it('rechaza contentLength no positivo con 422', async () => {
    const svc = new UploadsService(buildConfig(), buildPrisma());
    await expect(svc.presign(USER_ID, 'kyc_ine', 'image/png', 0)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });
});

describe('UploadsService — construcción del S3Client (BUG A1: presigned PUT a R2)', () => {
  beforeEach(() => {
    s3ClientCtorArgs.length = 0;
  });

  it('construye el S3Client con requestChecksumCalculation=WHEN_REQUIRED (no firma checksum en el presign)', async () => {
    const svc = new UploadsService(buildConfig(), buildPrisma());
    // fuerza la construcción lazy del cliente (getter `s3`) vía un presign real
    await svc.presign(USER_ID, 'kyc_ine', 'image/png', 1024);
    expect(s3ClientCtorArgs).toHaveLength(1);
    expect(s3ClientCtorArgs[0]).toMatchObject({
      requestChecksumCalculation: 'WHEN_REQUIRED',
    });
  });

  it('también fija responseChecksumValidation=WHEN_REQUIRED', async () => {
    const svc = new UploadsService(buildConfig(), buildPrisma());
    await svc.presign(USER_ID, 'kyc_ine', 'image/png', 1024);
    expect(s3ClientCtorArgs[0]).toMatchObject({
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  });

  it('reutiliza un único S3Client entre presigns (no reconstruye por llamada)', async () => {
    const svc = new UploadsService(buildConfig(), buildPrisma());
    await svc.presign(USER_ID, 'kyc_ine', 'image/png', 1024);
    await svc.presign(USER_ID, 'kyc_ine', 'image/jpeg', 1024);
    expect(s3ClientCtorArgs).toHaveLength(1);
  });
});

/**
 * P-UP-1 (pentest MEDIA, confirmado por seguridad §3.4) — el tope de tamaño era EVADIBLE.
 *
 * `contentLength` era opcional: omitirlo saltaba el chequeo contra `KYC_UPLOAD_MAX_BYTES` **y**
 * hacía que la URL se firmara sin `ContentLength` (`UNSIGNED-PAYLOAD`) ⇒ PUT de tamaño arbitrario
 * al bucket que guarda fotos de INE. El candado lo elegía el llamador.
 *
 * Estos tests son el candado en rojo: el que importa es «SIEMPRE se firma con ContentLength»,
 * porque un `?? {}` o un `if (contentLength !== undefined)` de vuelta los pone rojos.
 */
describe('UploadsService.presign — P-UP-1: el tope se exige SIEMPRE', () => {
  beforeEach(() => {
    (PutObjectCommand as unknown as jest.Mock).mockClear();
  });

  it('OMITIR contentLength ya NO produce una URL sin cota: 422 VALIDATION_ERROR', async () => {
    const svc = new UploadsService(buildConfig(), buildPrisma());
    await expect(svc.presign(USER_ID, 'kyc_ine', 'image/png')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    // Y no llegó a firmarse nada.
    expect(PutObjectCommand as unknown as jest.Mock).not.toHaveBeenCalled();
  });

  it('un contentLength `null` (cliente que manda el campo vacío) tampoco pasa', async () => {
    const svc = new UploadsService(buildConfig(), buildPrisma());
    await expect(
      svc.presign(USER_ID, 'kyc_ine', 'image/png', null as unknown as number),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(PutObjectCommand as unknown as jest.Mock).not.toHaveBeenCalled();
  });

  it('todo presign que SÍ sale lleva ContentLength FIJADO en la firma (no UNSIGNED-PAYLOAD)', async () => {
    const svc = new UploadsService(buildConfig(), buildPrisma());
    const res = await svc.presign(USER_ID, 'kyc_ine', 'image/png', 4321);
    const calls = (PutObjectCommand as unknown as jest.Mock).mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toMatchObject({ ContentLength: 4321, ContentType: 'image/png' });
    // …y el cliente recibe el header exacto que debe enviar en el PUT.
    expect(res.headers['Content-Length']).toBe('4321');
  });

  it('el tope de env también se firma: justo en el límite pasa, un byte más no', async () => {
    const svc = new UploadsService(buildConfig({ KYC_UPLOAD_MAX_BYTES: '2048' }), buildPrisma());
    const ok = await svc.presign(USER_ID, 'kyc_ine', 'image/png', 2048);
    expect(ok.headers['Content-Length']).toBe('2048');
    expect((PutObjectCommand as unknown as jest.Mock).mock.calls[0][0]).toMatchObject({
      ContentLength: 2048,
    });
    await expect(svc.presign(USER_ID, 'kyc_ine', 'image/png', 2049)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('rechaza tamaños no enteros (fraccionarios) — no se firma un ContentLength inválido', async () => {
    const svc = new UploadsService(buildConfig(), buildPrisma());
    await expect(svc.presign(USER_ID, 'kyc_ine', 'image/png', 1024.5)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(PutObjectCommand as unknown as jest.Mock).not.toHaveBeenCalled();
  });
});

/**
 * P-UP-1 — INVARIANTE, no casos sueltos: *ninguna* forma que un cliente pueda mandar produce una
 * URL sin cota. O sale 422, o la firma lleva un `ContentLength` entero, positivo, <= al tope y
 * exactamente igual al header que se devuelve. Un solo `if (contentLength !== undefined)` de
 * vuelta en cualquiera de los tres puntos (validación, firma, header) pone esto en rojo.
 */
describe('UploadsService.presign — P-UP-1: invariante «toda URL sale acotada»', () => {
  const SHAPES: Array<[string, unknown]> = [
    ['omitido', undefined],
    ['null', null],
    ['cero', 0],
    ['negativo', -1],
    ['fraccionario', 1024.5],
    ['NaN', NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['string numérico', '2048'],
    ['objeto', {}],
    ['por encima del tope', 2049],
    ['justo en el tope', 2048],
    ['dentro del tope', 100],
  ];

  it.each(SHAPES)('contentLength %s: o 422, o firma acotada (nunca UNSIGNED-PAYLOAD)', async (_name, value) => {
    (PutObjectCommand as unknown as jest.Mock).mockClear();
    const svc = new UploadsService(buildConfig({ KYC_UPLOAD_MAX_BYTES: '2048' }), buildPrisma());
    let res: Awaited<ReturnType<UploadsService['presign']>> | undefined;
    try {
      res = await svc.presign(USER_ID, 'kyc_ine', 'image/png', value as number);
    } catch (e) {
      expect(e).toMatchObject({ code: 'VALIDATION_ERROR' });
      // Nada se firmó: no queda una URL suelta por ahí.
      expect(PutObjectCommand as unknown as jest.Mock).not.toHaveBeenCalled();
      return;
    }
    // Si resolvió, la cota TIENE que estar en la firma.
    const input = (PutObjectCommand as unknown as jest.Mock).mock.calls[0][0] as {
      ContentLength?: unknown;
    };
    expect(typeof input.ContentLength).toBe('number');
    expect(Number.isInteger(input.ContentLength)).toBe(true);
    expect(input.ContentLength as number).toBeGreaterThan(0);
    expect(input.ContentLength as number).toBeLessThanOrEqual(res.maxBytes);
    expect(res.headers['Content-Length']).toBe(String(input.ContentLength));
  });
});
