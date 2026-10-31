import { createRequire } from 'node:module';
import nextConfig from '../../next.config.mjs';

/**
 * §DYN.6.6 — la configuración de imágenes de `next.config.mjs` aplicada a `getImageProps()` en la suite unitaria.
 *
 * En el build, Next hornea `images` en `process.env.__NEXT_IMAGE_OPTS` (DefinePlugin) y `getImageProps()` lo lee de
 * ahí. En vitest ese literal no existe (el `next/image` de `node_modules` no pasa por webpack) y `getImageProps()`
 * cae a `imageConfigDefault` (16…3840 px, sin `qualities`): una prueba de anchos mediría la config por defecto, no
 * la nuestra. Esto copia los campos de `next.config.mjs` sobre ese objeto por defecto (el MISMO módulo CJS que
 * lee `get-img-props.js`) y devuelve cómo deshacerlo. Fuente única: el `images` del config real, no una copia.
 */
type ImageConf = Record<string, unknown>;

export function applyNextImageConfig(): () => void {
  const require = createRequire(import.meta.url);
  const mod = require('next/dist/shared/lib/image-config.js') as { imageConfigDefault: ImageConf };
  const target = mod.imageConfigDefault;
  const images = (nextConfig as { images?: ImageConf }).images ?? {};
  const before: ImageConf = {};
  for (const k of Object.keys(images)) before[k] = target[k];
  Object.assign(target, structuredClone(images));
  return () => {
    for (const k of Object.keys(before)) {
      if (before[k] === undefined) delete target[k];
      else target[k] = before[k];
    }
  };
}
