/**
 * accessories.photo-single-decode.spec.ts — menor de QA en los gates de §AC sobre `dd26ae79` (BACKEND_NOTES §83.gates).
 * Propiedad: backend.
 *
 * Antes: `processAccessoryPhoto` renderizaba `full` y `thumb` desde la FUENTE con `Promise.all` ⇒ la foto se decodificaba
 * dos veces A LA VEZ; con el tope de 40 MP eso son ~2 × 160 MB (RGBA) de pico por subida. Ahora la fuente se decodifica
 * UNA vez (para `full`, 1200 px) y la miniatura sale de `full` (ya cuadrada: misma geometría, 1200² en vez de 40 MP).
 *
 * Se mide envolviendo `sharp`: cuántas tuberías sobre el buffer FUENTE llegan a `toBuffer()` (decodificación completa;
 * `metadata()` solo lee la cabecera y no cuenta).
 */
const decodes: unknown[] = [];
jest.mock('sharp', () => {
  const real = jest.requireActual('sharp');
  const wrapped = (input: unknown, opts: unknown) => {
    const inst = real(input, opts);
    const orig = inst.toBuffer.bind(inst);
    inst.toBuffer = (...a: unknown[]) => {
      decodes.push(input);
      return orig(...a);
    };
    return inst;
  };
  return Object.assign(wrapped, real);
});

import sharp from 'sharp';
import { processAccessoryPhoto, PHOTO_FULL_PX, PHOTO_THUMB_PX } from '../src/modules/accessories/accessory-photo';

describe('foto de accesorio: la fuente se decodifica UNA vez (pico de memoria, menor de QA)', () => {
  it.each([true, false])('alfa=%s ⇒ una sola decodificación de la fuente; full 1200² y thumb 400² WebP', async (alpha) => {
    const src = await sharp({ create: { width: 900, height: 500, channels: alpha ? 4 : 3, background: alpha ? { r: 10, g: 20, b: 30, alpha: 0.5 } : { r: 10, g: 20, b: 30 } } })
      .png()
      .toBuffer();
    decodes.length = 0;
    const out = await processAccessoryPhoto(src);
    expect(decodes.filter((d) => d === src)).toHaveLength(1);
    const mf = await sharp(out.fullWebp).metadata();
    const mt = await sharp(out.thumbWebp).metadata();
    expect([mf.format, mf.width, mf.height]).toEqual(['webp', PHOTO_FULL_PX, PHOTO_FULL_PX]);
    expect([mt.format, mt.width, mt.height]).toEqual(['webp', PHOTO_THUMB_PX, PHOTO_THUMB_PX]);
    expect(mt.hasAlpha === true).toBe(alpha);
  });
});
