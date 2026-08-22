/**
 * sealed-image-host.ts (v1.36-sealed-alta, M-37, P-35 · ARCHITECTURE §4.32c) — allowlist de HOST para
 * las URLs de imagen/producto del SELLADO que llegan por el alta (`BatchInventoryItemInput.sealedImageUrl`).
 *
 * Motivo (anti stored-XSS / URL arbitraria): `sealedImageUrl` se PERSISTE y luego se RENDERIZA como
 * `<img src>` en Compra/bóveda/M1. Un operador (o un request manipulado) podría inyectar
 * `javascript:…`, `data:…` o una URL a un host cualquiera. La imagen legítima proviene SIEMPRE de la
 * lista que el propio servidor sirvió desde TCGCSV (`SealedCatalogProductDTO.imageUrl`), cuyo host es
 * el CDN de imágenes de TCGplayer/TCGCSV. Se valida el host contra un allowlist ANTES de persistir;
 * cualquier otra cosa ⇒ se descarta (⇒ `null`, el display cae a la `Card` ancla). Money-safe: estas
 * columnas son display-only y jamás fijan precio.
 *
 * Regla: solo `https:` y host EXACTO o subdominio de un dominio de la allowlist. Nada de userinfo
 * (`user:pass@`), nada de `http:`/`data:`/`javascript:`.
 */

/** Dominios raíz permitidos para las imágenes del sellado (host EXACTO o subdominio de estos). */
export const SEALED_IMAGE_HOST_ALLOWLIST: readonly string[] = [
  'tcgplayer.com', // p. ej. tcgplayer-cdn.tcgplayer.com, product-images.tcgplayer.com
  'tcgcsv.com',
];

/** true si `host` es exactamente `domain` o un subdominio suyo (`*.domain`). */
function hostMatchesDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/**
 * Devuelve la URL TAL CUAL si es una imagen `https:` de un host confiable de la allowlist; en
 * cualquier otro caso (URL inválida, esquema no-https, host fuera de la lista, userinfo presente)
 * devuelve `null`. `undefined`/`null`/vacío ⇒ `null` (fallback a la `Card` ancla).
 */
export function sanitizeSealedImageUrl(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const value = raw.trim();
  if (value === '') return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  // Sin credenciales embebidas (`https://evil@tcgplayer.com/...` no debe pasar por confusión de host).
  if (url.username !== '' || url.password !== '') return null;
  const host = url.hostname.toLowerCase();
  const ok = SEALED_IMAGE_HOST_ALLOWLIST.some((d) => hostMatchesDomain(host, d));
  return ok ? value : null;
}
