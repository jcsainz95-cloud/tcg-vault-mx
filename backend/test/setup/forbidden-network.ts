/**
 * forbidden-network.ts — la clase de error y el predicado del veto de PS-99 (c), SIN efectos al importarse.
 *
 * ⚠️ Vive aparte de `forbid-skydropx-network.ts` a propósito: el canario importa la CLASE para asertar con
 * `toBeInstanceOf`; si la importara del fichero que instala el veto, el propio import lo instalaría y el canario
 * seguiría verde aunque alguien quitara el fichero de `setupFiles` (medido: la mutación «quitar setupFiles» salía
 * con solo el rojo estático, no el de conducta).
 */
export class ForbiddenTestNetworkError extends Error {
  constructor(readonly target: string) {
    super(`PS-99 (c): red a Skydropx vetada en pruebas (${target}). Usa el FakeShippingProvider o un transporte grabador.`);
    this.name = 'ForbiddenTestNetworkError';
  }
}

const FORBIDDEN_SUFFIX = 'skydropx.com';

export function isForbiddenHost(hostname: string | null | undefined): boolean {
  if (!hostname) return false;
  const h = hostname.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
  return h === FORBIDDEN_SUFFIX || h.endsWith(`.${FORBIDDEN_SUFFIX}`);
}

