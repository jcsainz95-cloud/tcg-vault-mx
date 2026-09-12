import { ConfigService } from '@nestjs/config';
import { validateSync } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { UploadsService } from '../src/modules/uploads/uploads.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { UpdateKycDto } from '../src/modules/users/dto/users.dto';
import { CreateRequestDto } from '../src/modules/buylist/dto/buylist.dto';

/**
 * ⭐⭐ **`C15` / `SEC-PII-1` (ALTA, `docs/SECURITY_NOTES.md §4.1`) — LA COMPUERTA DE IDENTIDAD DEJA DE
 * PASARSE CON DOS CADENAS CUALESQUIERA.**
 *
 * ### El defecto, con la frase que importa
 * Las **dos** compuertas de cumplimiento —el intake (`POST /buylist/requests`) y la emisión de la
 * oferta— medían lo mismo: `ineFrontKey != null && ineBackKey != null`. **Y ese booleano lo escribía
 * el cliente.** Con `{front:'a', back:'b'}` un vendedor **por encima del umbral AML** pasaba las dos
 * y **cobraba a su CLABE sin habernos dado jamás una identificación**.
 * ⚠️ **Estaba vivo en `production`** desde antes de P-78 (`git show efe65f5:…users.dto.ts:94`).
 *
 * ### Las tres comprobaciones, y por qué ninguna sobra
 * | # | Qué | Qué deja pasar si falta |
 * |---|---|---|
 * | 1 | **Forma** anclada (`KYC_INE_KEY_PATTERN`) | `'a'`, `'../otro/objeto'`, 5.000 caracteres |
 * | 2 | **Dueño** (`KycUploadGrant` de ESE `userId`) | cualquier cadena con forma válida — y, si acertara una key ajena, **declarar suyo el documento de otro** |
 * | 3 | **Existencia** (`HeadObject`) | quien pide un presign y **no sube nada**: expediente que dice «tiene INE» sobre un bucket vacío |
 */

// La FIRMA es local y ya tiene sus candados en `uploads.presign.spec.ts` / `uploads.ine-view-url`.
// Aquí se sustituye para poder inyectar un cliente S3 de mentira sin arrastrar su `endpointProvider`.
const firmados: { input: Record<string, unknown> }[] = [];
jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn(async (_c: unknown, command: { input: Record<string, unknown> }) => {
    firmados.push(command);
    return 'https://bucket.example/objeto?X-Amz-Signature=abc';
  }),
}));

const OTRO_USUARIO = 'user-ajeno';
const YO = 'user-yo';
/** Una key con la forma EXACTA que emite `presign`. */
const KEY_VALIDA = 'kyc_ine/2026-09-12/3f2504e0-4f89-41d3-9a0c-0305e82c3301.png';
const KEY_VALIDA_2 = 'kyc_ine/2026-09-12/3f2504e0-4f89-41d3-9a0c-0305e82c3302.png';

function buildService(opts: {
  grants?: Record<string, string>;
  objetos?: string[];
  headThrows?: Error;
} = {}) {
  const grants = opts.grants ?? { [KEY_VALIDA]: YO, [KEY_VALIDA_2]: YO };
  const objetos = opts.objetos ?? [KEY_VALIDA, KEY_VALIDA_2];
  const send = jest.fn(async (command: { input: { Key: string } }) => {
    if (opts.headThrows) throw opts.headThrows;
    if (!objetos.includes(command.input.Key)) {
      const err = new Error('NotFound') as Error & { $metadata: { httpStatusCode: number } };
      err.name = 'NotFound';
      err.$metadata = { httpStatusCode: 404 };
      throw err;
    }
    return {};
  });
  const prisma = {
    kycUploadGrant: {
      findUnique: jest.fn(async ({ where }: { where: { objectKey: string } }) =>
        grants[where.objectKey] ? { userId: grants[where.objectKey] } : null,
      ),
      create: jest.fn(async ({ data }: { data: unknown }) => data),
    },
  };
  const svc = new UploadsService(
    { get: (k: string) => ({ S3_BUCKET: 'tcg-ine' } as Record<string, string>)[k] } as unknown as ConfigService,
    prisma as unknown as PrismaService,
  );
  // El cliente S3 es perezoso: se inyecta el doble sin tocar la red.
  (svc as unknown as { client: unknown }).client = { send };
  return { svc, prisma, send };
}

describe('C15 · capa de VALIDACIÓN — el PoC exacto que midió seguridad', () => {
  /** Las MISMAS opciones del `ValidationPipe` global (`main.ts`): whitelist + transform. */
  const opciones = { whitelist: true, forbidNonWhitelisted: false } as const;

  it('⛔ `UpdateKycDto` con `{front:"a", back:"b"}` ⇒ **≥1 error** (antes: 0)', () => {
    const dto = plainToInstance(UpdateKycDto, { ineFrontUploadKey: 'a', ineBackUploadKey: 'b' });
    const errores = validateSync(dto, opciones);
    expect(errores.length).toBeGreaterThanOrEqual(1);
  });

  it.each([
    ['travesía de rutas', '../otro/objeto'],
    ['prefijo correcto pero forma libre', 'kyc_ine/loquesea.png'],
    ['sin extensión', 'kyc_ine/2026-09-12/3f2504e0-4f89-41d3-9a0c-0305e82c3301'],
    ['uuid inventado', 'kyc_ine/2026-09-12/no-es-un-uuid.png'],
    ['cadena de 5.000 caracteres', `kyc_ine/2026-09-12/${'a'.repeat(5000)}.png`],
  ])('⛔ `UpdateKycDto` rechaza %s', (_n, key) => {
    expect(validateSync(plainToInstance(UpdateKycDto, { ineFrontUploadKey: key }), opciones).length)
      .toBeGreaterThanOrEqual(1);
  });

  it('✅ una key con la forma que emite `presign` pasa la validación estructural', () => {
    const dto = plainToInstance(UpdateKycDto, { ineFrontUploadKey: KEY_VALIDA });
    expect(validateSync(dto, opciones)).toHaveLength(0);
  });

  it('⛔ `CreateRequestDto.ineUploadKeys` deja de ser un `@IsObject()` pelado', () => {
    const malo = plainToInstance(CreateRequestDto, {
      items: [{ cardId: 'c1', productType: 'raw', rawCondition: 'NM' }],
      ineUploadKeys: { front: 'a', back: 'b' },
    });
    const errores = validateSync(malo, opciones);
    // El error tiene que estar EN `ineUploadKeys` (no en otro campo por casualidad).
    expect(errores.some((e) => e.property === 'ineUploadKeys')).toBe(true);

    const bueno = plainToInstance(CreateRequestDto, {
      items: [{ cardId: 'c1', productType: 'raw', rawCondition: 'NM' }],
      ineUploadKeys: { front: KEY_VALIDA, back: KEY_VALIDA_2 },
    });
    expect(validateSync(bueno, opciones).some((e) => e.property === 'ineUploadKeys')).toBe(false);
  });
});

describe('C15 · la COMPUERTA del servicio — forma, dueño y existencia', () => {
  it('✅ key mía, con objeto detrás ⇒ pasa, y se preguntó por el objeto (HeadObject)', async () => {
    const { svc, send } = buildService();
    await expect(
      svc.assertOwnedIneKeys(YO, { front: KEY_VALIDA, back: KEY_VALIDA_2 }),
    ).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('⛔ EL PoC: dos cadenas inventadas ⇒ `422 INE_UPLOAD_KEY_INVALID`', async () => {
    const { svc } = buildService();
    await expect(svc.assertOwnedIneKeys(YO, { front: 'a', back: 'b' })).rejects.toMatchObject({
      code: 'INE_UPLOAD_KEY_INVALID',
      details: { field: 'ineFrontUploadKey' },
    });
  });

  it('⛔ key con forma válida que el presign NUNCA emitió ⇒ 422', async () => {
    const { svc } = buildService({ grants: {} });
    await expect(svc.assertOwnedIneKeys(YO, { front: KEY_VALIDA })).rejects.toMatchObject({
      code: 'INE_UPLOAD_KEY_INVALID',
    });
  });

  it('⛔⛔ key de OTRO usuario ⇒ 422 (no se puede declarar propio el documento ajeno)', async () => {
    const { svc } = buildService({ grants: { [KEY_VALIDA]: OTRO_USUARIO } });
    await expect(svc.assertOwnedIneKeys(YO, { front: KEY_VALIDA })).rejects.toMatchObject({
      code: 'INE_UPLOAD_KEY_INVALID',
    });
  });

  it('⛔ permiso mío pero SIN objeto subido ⇒ 422 (un permiso no es una imagen)', async () => {
    const { svc } = buildService({ objetos: [] });
    await expect(svc.assertOwnedIneKeys(YO, { front: KEY_VALIDA })).rejects.toMatchObject({
      code: 'INE_UPLOAD_KEY_INVALID',
    });
  });

  it('⚠️ un fallo de RED del `HeadObject` NO se traduce a «no existe»: se propaga', async () => {
    const roto = new Error('ECONNREFUSED') as Error & { $metadata: { httpStatusCode: number } };
    roto.$metadata = { httpStatusCode: 500 };
    const { svc } = buildService({ headThrows: roto });
    // «No pude preguntar» y «no está» son hechos distintos; confundirlos convertiría un corte de red
    // en un expediente aceptado (o rechazado) por casualidad.
    await expect(svc.assertOwnedIneKeys(YO, { front: KEY_VALIDA })).rejects.toThrow('ECONNREFUSED');
  });

  it('sin keys no hay nada que validar: ni BD ni red', async () => {
    const { svc, prisma, send } = buildService();
    await expect(svc.assertOwnedIneKeys(YO, {})).resolves.toBeUndefined();
    expect(prisma.kycUploadGrant.findUnique).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('el mensaje NO distingue cuál de las tres falló (no es un oráculo de keys ajenas)', async () => {
    const inexistente = buildService({ grants: {} });
    const ajena = buildService({ grants: { [KEY_VALIDA]: OTRO_USUARIO } });
    const sinObjeto = buildService({ objetos: [] });
    const codigos = await Promise.all(
      [inexistente, ajena, sinObjeto].map((b) =>
        b.svc.assertOwnedIneKeys(YO, { front: KEY_VALIDA }).then(
          () => null,
          (e: { code: string; message: string; details: unknown }) => `${e.code}|${e.message}|${JSON.stringify(e.details)}`,
        ),
      ),
    );
    expect(new Set(codigos).size).toBe(1);
  });
});

describe('C15 · el presign REGISTRA la key a nombre de quien la pidió', () => {
  it('`presign` escribe el `KycUploadGrant` con el `userId` del actor', async () => {
    const { svc, prisma } = buildService();
    const res = await svc.presign(YO, 'kyc_ine', 'image/png', 1024);
    expect(prisma.kycUploadGrant.create).toHaveBeenCalledWith({
      data: { userId: YO, objectKey: res.uploadKey, contentType: 'image/png' },
    });
    // Y la key que emite CUMPLE el patrón que la compuerta exige: si divergieran, el producto se
    // rechazaría a sí mismo en la siguiente pantalla.
    expect(res.uploadKey).toMatch(
      /^kyc_ine\/\d{4}-\d{2}-\d{2}\/[0-9a-f-]{36}\.[a-z0-9]{1,8}$/,
    );
  });
});

describe('C14 / SEC-PII-2 · el `no-store` alcanza a los BYTES, no solo al JSON', () => {
  it('el `PutObjectCommand` fija `CacheControl: no-store` **y** lo devuelve en `headers`', async () => {
    firmados.length = 0;
    const { svc } = buildService();
    const res = await svc.presign(YO, 'kyc_ine', 'image/png', 10);
    // ⭐ LAS DOS MITADES, y hacen falta las dos:
    // (a) va en el comando que se FIRMA ⇒ el objeto nace con el metadato en el bucket…
    expect(firmados).toHaveLength(1);
    expect(firmados[0].input.CacheControl).toBe('no-store');
    // (b) …y por eso mismo es cabecera FIRMADA: el cliente DEBE enviarla, así que viaja en la
    //     respuesta del presign (el front hace `{...presign.headers}`). Sin (b), (a) rompe la subida.
    expect(res.headers['Cache-Control']).toBe('no-store');
  });
});
