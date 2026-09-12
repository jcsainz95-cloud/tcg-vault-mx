import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { UploadsService } from '../src/modules/uploads/uploads.service';

/**
 * ⭐ **v1.69 (P-78) — el enlace de LECTURA del INE: su caducidad y su cabecera.**
 * API_CONTRACT §M6-K.2.1 (candado **K-9**) · ARCHITECTURE §3.4.c.
 *
 * Dos candados, y el segundo existe para que nadie «arregle» lo que está medido:
 *  1. **TTL 120 s con TECHO DURO de 300.** Ninguna entrada del entorno puede producir un enlace de
 *     vida ilimitada: un dial de caducidad sin techo acaba valiendo 24 h.
 *  2. **`ResponseContentDisposition: 'attachment'` se CONSERVA.** Medido (orquestador, Chromium
 *     real, 3/3): la cabecera **NO impide** pintar la imagen en un `<img>`; **impide navegar** a ella
 *     como documento de primer nivel, que es el vector de S-B3 (HTML ejecutable en el origen del
 *     storage). Quitarla «porque estorba para verla» reabre S-B3 **sin ganar nada**.
 */

const signed: { key?: string; expiresIn?: number; disposition?: string }[] = [];

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn(
    async (_client: unknown, command: { input: Record<string, unknown> }, opts: { expiresIn: number }) => {
      signed.push({
        key: command.input.Key as string,
        expiresIn: opts.expiresIn,
        disposition: command.input.ResponseContentDisposition as string,
      });
      return `https://bucket.example/${String(command.input.Key)}?X-Amz-Signature=abc`;
    },
  ),
}));

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send: jest.fn() })),
  PutObjectCommand: jest.fn().mockImplementation((input) => ({ input })),
  GetObjectCommand: jest.fn().mockImplementation((input) => ({ input })),
  DeleteObjectCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

function buildService(env: Record<string, string> = {}) {
  const values: Record<string, string> = {
    S3_REGION: 'us-east-1',
    S3_ENDPOINT: 'http://localhost:9000',
    S3_BUCKET: 'tcg-ine',
    S3_ACCESS_KEY_ID: 'minioadmin',
    S3_SECRET_ACCESS_KEY: 'minioadmin',
    ...env,
  };
  return new UploadsService({ get: (k: string) => values[k] } as unknown as ConfigService);
}

beforeEach(() => {
  signed.length = 0;
});

describe('K-9 · `KYC_INE_VIEW_URL_TTL_SECONDS`: 120 por defecto, techo DURO de 300', () => {
  it('sin dial ⇒ 120, sin recorte', () => {
    expect(buildService().resolveIneViewUrlTtl()).toEqual({ seconds: 120, clamped: false });
  });

  it('dial válido por debajo del techo ⇒ se respeta (y el candado de C10(c) usa 240)', () => {
    expect(buildService({ KYC_INE_VIEW_URL_TTL_SECONDS: '60' }).resolveIneViewUrlTtl()).toEqual({
      seconds: 60,
      clamped: false,
    });
    // ⭐ v1.70 (C10(c)): «con `=240`, el `after.expiresInSeconds` de la fila ES 240». Un test que
    // solo comprueba el default de 120 no distingue «lee el dial» de «escribe una constante».
    expect(buildService({ KYC_INE_VIEW_URL_TTL_SECONDS: '240' }).resolveIneViewUrlTtl()).toEqual({
      seconds: 240,
      clamped: false,
    });
    expect(buildService({ KYC_INE_VIEW_URL_TTL_SECONDS: '300' }).resolveIneViewUrlTtl()).toEqual({
      seconds: 300,
      clamped: false,
    });
  });

  it('⭐ dial de 3600 ⇒ CLAMPA a 300, lo REGISTRA y devuelve el valor pedido (C10(c))', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      // El `seconds` es el que rige; `requested` es la historia que la bitácora necesita para no
      // afirmar un 300 sin decir que alguien pidió 3600 (misma clase que `S-FX-3`).
      expect(buildService({ KYC_INE_VIEW_URL_TTL_SECONDS: '3600' }).resolveIneViewUrlTtl()).toEqual({
        seconds: 300,
        clamped: true,
        requested: 3600,
      });
      // El `warn` se CONSERVA además de la fila: un log rota, una fila no — hacen falta los dos.
      expect(warn).toHaveBeenCalled();
      expect(String(warn.mock.calls[0][0])).toContain('clamped to 300');
    } finally {
      warn.mockRestore();
    }
  });

  it.each([
    ['una palabra', 'forever'],
    ['negativo', '-1'],
    ['cero', '0'],
    ['decimal', '119.5'],
    ['vacío', ''],
  ])('⛔ dial inválido (%s) ⇒ cae al DEFAULT de 120, nunca a «sin límite»', (_n, raw) => {
    expect(buildService({ KYC_INE_VIEW_URL_TTL_SECONDS: raw }).resolveIneViewUrlTtl()).toEqual({
      seconds: 120,
      clamped: false,
    });
  });
});

describe('S-B3 · la cabecera `attachment` se CONSERVA en el presigned GET', () => {
  it('firma con `ResponseContentDisposition: attachment` y con el TTL que se le pasa', async () => {
    const svc = buildService();
    await svc.presignGet('kyc_ine/2026-09-11/front.png', svc.resolveIneViewUrlTtl().seconds);
    expect(signed).toHaveLength(1);
    expect(signed[0].disposition).toBe('attachment');
    expect(signed[0].expiresIn).toBe(120);
    expect(signed[0].key).toBe('kyc_ine/2026-09-11/front.png');
  });

  it('el TTL del INE (120) NO es el default histórico de `presignGet` (300): se pasa explícito', async () => {
    const svc = buildService();
    await svc.presignGet('kyc_ine/x.png');
    expect(signed[0].expiresIn).toBe(300); // default de la firma, que este frente NO usa
  });
});
