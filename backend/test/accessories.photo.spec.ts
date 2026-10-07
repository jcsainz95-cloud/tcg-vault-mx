/**
 * accessories.photo.spec.ts — **AC-B4** (mitad del procesador) · API_CONTRACT §AC.11 «Foto», criterios 702/703.
 *
 *  - Tipo por FIRMA (⛔ nunca por extensión ni por el `mimetype` que diga el navegador): png, jpeg, webp. Otro ⇒
 *    `422 PHOTO_INVALID {reason:'unsupported_type'}`; firma buena pero no decodifica ⇒ `not_image`; más de 40 MP ⇒
 *    `too_many_pixels`; más de 10 MiB ⇒ `too_large`.
 *  - `rotate()` (EXIF), `resize(1200,1200,{fit:'contain'})` con fondo blanco (sin alfa) o transparente (con alfa) ⇒
 *    cuadrada SIN recortar; WebP; miniatura de 400; ⛔ sin metadatos (EXIF y GPS fuera).
 *  - `version` = 16 hex del sha256 de `full`.
 * La mitad HTTP (multipart, límite de multer, nada persistido) está en `integration/accessories-panel.e2e-spec.ts`.
 */
import { createHash } from 'node:crypto';
import { crc32 } from 'node:zlib';
import sharp from 'sharp';
import { processAccessoryPhoto, sniffImageType, PHOTO_MAX_BYTES } from '../src/modules/accessories/accessory-photo';
import { BusinessException } from '../src/common/business.exception';

jest.setTimeout(60_000);

async function reason(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(BusinessException);
    const be = e as BusinessException;
    expect(be.getStatus()).toBe(422);
    expect(be.code).toBe('PHOTO_INVALID');
    return String(be.details.reason);
  }
  throw new Error('no lanzó');
}

const solid = (w: number, h: number, bg: sharp.Color, channels: 3 | 4 = 3) =>
  sharp({ create: { width: w, height: h, channels, background: bg } });

async function pixel(webp: Buffer, x: number, y: number): Promise<number[]> {
  const { data, info } = await sharp(webp).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * 4;
  return [data[i], data[i + 1], data[i + 2], data[i + 3]];
}

describe('AC-B4 — sniffImageType (firma)', () => {
  it('png, jpeg y webp por sus bytes; texto y vacío ⇒ null', async () => {
    expect(sniffImageType(await solid(4, 4, '#f00').png().toBuffer())).toBe('png');
    expect(sniffImageType(await solid(4, 4, '#f00').jpeg().toBuffer())).toBe('jpeg');
    expect(sniffImageType(await solid(4, 4, '#f00').webp().toBuffer())).toBe('webp');
    expect(sniffImageType(Buffer.from('hola, soy texto con nombre .png'))).toBeNull();
    expect(sniffImageType(Buffer.alloc(0))).toBeNull();
    expect(sniffImageType(await solid(4, 4, '#f00').gif().toBuffer())).toBeNull();
  });
});

describe('AC-B4 — processAccessoryPhoto', () => {
  it.each(['png', 'jpeg', 'webp'] as const)('%s aceptado ⇒ full 1200×1200 y thumb 400×400 en WebP', async (fmt) => {
    const src = await solid(800, 600, '#0a0')[fmt]().toBuffer();
    const out = await processAccessoryPhoto(src);
    const mf = await sharp(out.fullWebp).metadata();
    const mt = await sharp(out.thumbWebp).metadata();
    expect([mf.format, mf.width, mf.height]).toEqual(['webp', 1200, 1200]);
    expect([mt.format, mt.width, mt.height]).toEqual(['webp', 400, 400]);
    expect(out.sourceMime).toBe(`image/${fmt}`);
    expect(out.sourceBytes).toBe(src.length);
    expect(out.version).toBe(createHash('sha256').update(out.fullWebp).digest('hex').slice(0, 16));
  });

  it('3000×2000 ⇒ 1200×1200 con relleno: esquinas = fondo blanco, centro = la foto; full más chica que la original', async () => {
    const noise = Buffer.alloc(3000 * 2000 * 3);
    for (let i = 0; i < noise.length; i += 1) noise[i] = (i * 2654435761) >>> 24;
    // Imagen ruidosa (para que el original pese) con una banda roja sólida al centro.
    const src = await sharp(noise, { raw: { width: 3000, height: 2000, channels: 3 } })
      .composite([{ input: await solid(1000, 600, '#ff0000').png().toBuffer(), left: 1000, top: 700 }])
      .jpeg({ quality: 92 })
      .toBuffer();
    const out = await processAccessoryPhoto(src);
    expect(out.fullWebp.length).toBeLessThan(src.length);
    const corner = await pixel(out.fullWebp, 2, 2);
    expect(corner.slice(0, 3).every((v) => v >= 245)).toBe(true); // blanco (relleno de arriba: 200 px)
    const bottom = await pixel(out.fullWebp, 1197, 1197);
    expect(bottom.slice(0, 3).every((v) => v >= 245)).toBe(true);
    const centro = await pixel(out.fullWebp, 600, 600);
    expect(centro[0]).toBeGreaterThan(200);
    expect(centro[1]).toBeLessThan(60);
  });

  it('con alfa ⇒ el relleno es TRANSPARENTE', async () => {
    const src = await solid(600, 300, { r: 0, g: 0, b: 255, alpha: 1 }, 4).png().toBuffer();
    const out = await processAccessoryPhoto(src);
    expect((await pixel(out.fullWebp, 3, 3))[3]).toBe(0);
    expect((await pixel(out.fullWebp, 600, 600))[3]).toBe(255);
  });

  it('orientación EXIF aplicada: 300×100 con orientación 6 queda vertical (relleno a los lados)', async () => {
    const src = await solid(300, 100, '#ff0000').jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const out = await processAccessoryPhoto(src);
    expect((await pixel(out.fullWebp, 3, 600)).slice(0, 3).every((v) => v >= 245)).toBe(true); // lado izquierdo: relleno
    expect((await pixel(out.fullWebp, 600, 5))[0]).toBeGreaterThan(200); // arriba al centro: la foto (vertical)
  });

  it('⛔ sin EXIF ni GPS en la salida', async () => {
    const src = await solid(400, 400, '#888')
      .jpeg()
      .withExif({ IFD0: { Copyright: 'dueño', Make: 'Cámara' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '19/1 25/1 0/1' } })
      .toBuffer();
    const inMeta = await sharp(src).metadata();
    expect(inMeta.exif).toBeDefined(); // control: la entrada SÍ trae EXIF
    expect(inMeta.exif!.toString('latin1')).toContain('dueño'.slice(0, 3));
    const out = await processAccessoryPhoto(src);
    for (const b of [out.fullWebp, out.thumbWebp]) {
      const m = await sharp(b).metadata();
      expect(m.exif).toBeUndefined();
      expect(m.xmp).toBeUndefined();
      expect(m.icc).toBeUndefined();
      expect(b.includes(Buffer.from('Exif'))).toBe(false);
    }
  });

  it('texto renombrado ⇒ unsupported_type', async () => {
    expect(await reason(processAccessoryPhoto(Buffer.from('esto no es una imagen, aunque se llame foto.png')))).toBe('unsupported_type');
  });

  it('GIF (firma válida de imagen pero tipo no admitido) ⇒ unsupported_type', async () => {
    expect(await reason(processAccessoryPhoto(await solid(4, 4, '#f00').gif().toBuffer()))).toBe('unsupported_type');
  });

  it('firma PNG con cuerpo basura ⇒ not_image', async () => {
    const png = await solid(10, 10, '#f00').png().toBuffer();
    const roto = Buffer.concat([png.subarray(0, 16), Buffer.alloc(200, 0x41)]);
    expect(await reason(processAccessoryPhoto(roto))).toBe('not_image');
  });

  it('más de 40 MP declarados ⇒ too_many_pixels (sin decodificar)', async () => {
    const png = Buffer.from(await solid(10, 10, '#f00').png().toBuffer());
    // IHDR: bytes 16..23 = ancho/alto; CRC del chunk (tipo+datos) en 29..32.
    png.writeUInt32BE(8000, 16);
    png.writeUInt32BE(6000, 20);
    png.writeUInt32BE(crc32(png.subarray(12, 29)) >>> 0, 29);
    expect(await reason(processAccessoryPhoto(png))).toBe('too_many_pixels');
  });

  it('más de 10 MiB ⇒ too_large (red de seguridad además de multer)', async () => {
    const png = await solid(10, 10, '#f00').png().toBuffer();
    const grande = Buffer.concat([png, Buffer.alloc(PHOTO_MAX_BYTES + 1 - png.length)]);
    expect(grande.length).toBe(PHOTO_MAX_BYTES + 1);
    expect(await reason(processAccessoryPhoto(grande))).toBe('too_large');
  });
});
