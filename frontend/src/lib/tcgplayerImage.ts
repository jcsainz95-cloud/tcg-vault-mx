/**
 * Espejo de display de `upgradeSealedImageUrl` (backend): la celda del binder solo trae `imageSmallUrl`, y para
 * productos de TCGplayer (`<id>_200w.jpg`) la miniatura de 200 px se ve borrosa a >=165 px CSS x DPR 2. Se sube a
 * `_in_1000x1000` (misma CDN, mismo archivo, sin pasar por el optimizador). Pura e idempotente; otros hosts intactos.
 */
const SUFFIX = /^(\/product\/\d+)_(?:\d+w|in_\d+x\d+)(\.[A-Za-z0-9]+)$/;

export function upgradeTcgplayerThumb<T extends string | null | undefined>(url: T): T {
  if (typeof url !== 'string' || url === '') return url;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  if (u.protocol !== 'https:' || u.hostname.toLowerCase() !== 'tcgplayer-cdn.tcgplayer.com') return url;
  const m = SUFFIX.exec(u.pathname);
  if (!m) return url;
  u.pathname = `${m[1]}_in_1000x1000${m[2]}`;
  return u.toString() as T;
}
