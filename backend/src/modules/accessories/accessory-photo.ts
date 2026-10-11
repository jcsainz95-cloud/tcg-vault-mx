/**
 * accessory-photo.ts — procesador de la foto de un accesorio (API_CONTRACT §AC.11 «Foto»; ARCHITECTURE §4.AC (g)).
 *
 *  - Tipo por FIRMA (números mágicos), ⛔ nunca por extensión ni por el `mimetype` que declare el navegador:
 *    PNG `89 50 4E 47 0D 0A 1A 0A`, JPEG `FF D8 FF`, WebP `RIFF····WEBP`. Otro ⇒ `unsupported_type`.
 *    (El contrato nombra `file-type`; su versión instalada (21) es solo-ESM y el backend es CommonJS bajo ts-jest. Para
 *    tres formatos, la firma a mano es la misma regla sin dependencia nueva — BACKEND_NOTES §83.A.)
 *  - `sharp` con `limitInputPixels: 40_000_000` ⇒ `too_many_pixels`; no decodifica ⇒ `not_image`; > 10 MiB ⇒ `too_large`
 *    (multer corta antes; esto es la red por si alguien llama al procesador por otra vía).
 *  - `rotate()` (EXIF) → `resize(1200,1200,{fit:'contain'})` con fondo transparente si la fuente tiene alfa y blanco si
 *    no ⇒ cuadrada SIN recortar → WebP calidad 82, y miniatura de 400 hecha desde `full` (la fuente se decodifica UNA vez). ⛔ Sin `withMetadata()`: EXIF/GPS/ICC fuera
 *    (criterio 703); `sharp` no copia metadatos a la salida salvo que se pida.
 *  - `version` = 16 hex del sha256 de `full`.
 * ⛔ Este fichero (ni ningún otro del módulo) importa S3 ni el módulo de subidas de la INE (I-AC-6, AC-B5).
 */
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { BusinessException } from '../../common/business.exception';

export const PHOTO_MAX_BYTES = 10 * 1024 * 1024;
export const PHOTO_MAX_PIXELS = 40_000_000;
export const PHOTO_FULL_PX = 1200;
export const PHOTO_THUMB_PX = 400;
export const PHOTO_WEBP_QUALITY = 82;

export type PhotoInvalidReason = 'too_large' | 'unsupported_type' | 'too_many_pixels' | 'not_image';
export type SniffedType = 'png' | 'jpeg' | 'webp';

export const photoInvalid = (reason: PhotoInvalidReason) =>
  BusinessException.validation('PHOTO_INVALID', `invalid accessory photo: ${reason}`, { reason });

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function sniffImageType(buf: Buffer): SniffedType | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIG)) return 'png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null;
}

export interface ProcessedPhoto {
  fullWebp: Buffer;
  thumbWebp: Buffer;
  version: string;
  sourceMime: string;
  sourceBytes: number;
}

const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };
const CLEAR = { r: 0, g: 0, b: 0, alpha: 0 };

function isPixelLimit(e: unknown): boolean {
  return /pixel limit/i.test(e instanceof Error ? e.message : String(e));
}

export async function processAccessoryPhoto(buf: Buffer): Promise<ProcessedPhoto> {
  if (buf.length > PHOTO_MAX_BYTES) throw photoInvalid('too_large');
  const type = sniffImageType(buf);
  if (type === null) throw photoInvalid('unsupported_type');
  const open = () => sharp(buf, { limitInputPixels: PHOTO_MAX_PIXELS, failOn: 'error' });
  let hasAlpha: boolean;
  try {
    const meta = await open().metadata();
    if (!meta.width || !meta.height) throw photoInvalid('not_image');
    if (meta.width * meta.height > PHOTO_MAX_PIXELS) throw photoInvalid('too_many_pixels');
    hasAlpha = meta.hasAlpha === true;
  } catch (e) {
    if (e instanceof BusinessException) throw e;
    throw photoInvalid(isPixelLimit(e) ? 'too_many_pixels' : 'not_image');
  }
  const background = hasAlpha ? CLEAR : WHITE;
  // Menor de QA (gates §AC sobre `dd26ae79`): la FUENTE se decodifica UNA vez (para `full`); la miniatura sale de `full`,
  // que ya es cuadrada (misma geometría `contain`) y mide 1200² en vez de hasta 40 MP. Antes: dos decodificaciones de la
  // fuente en paralelo ⇒ ~2 × 160 MB de pico por subida.
  let fullWebp: Buffer;
  let thumbWebp: Buffer;
  try {
    fullWebp = await open().rotate().resize(PHOTO_FULL_PX, PHOTO_FULL_PX, { fit: 'contain', background }).webp({ quality: PHOTO_WEBP_QUALITY }).toBuffer();
    thumbWebp = await sharp(fullWebp).resize(PHOTO_THUMB_PX, PHOTO_THUMB_PX, { fit: 'contain', background }).webp({ quality: PHOTO_WEBP_QUALITY }).toBuffer();
  } catch (e) {
    throw photoInvalid(isPixelLimit(e) ? 'too_many_pixels' : 'not_image');
  }
  const version = createHash('sha256').update(fullWebp).digest('hex').slice(0, 16);
  return { fullWebp, thumbWebp, version, sourceMime: `image/${type}`, sourceBytes: buf.length };
}
