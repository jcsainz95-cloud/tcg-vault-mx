import type { Metadata } from 'next';
import { WishlistMailActionPage } from './WishlistMailActionPage';
import { RouteMessages } from '@/components/i18n/RouteMessages';

/**
 * `/{locale}/lista-de-deseos/aviso?a=&id=&t=` — enlace del correo de la lista de deseos (API_CONTRACT §WSH.6,
 * DESIGN_SYSTEM §WSH-UX.6). Pública (fuera de `/account`): se abre SIN sesión.
 *  - `noindex`: la URL lleva un token.
 *  - `Referrer-Policy: no-referrer`: que el token no viaje en el `Referer` (imágenes de catálogo remotas incluidas).
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
};

export default function WishlistMailActionRoute() {
  // §DYN.6.7 (c1): el ámbito `storefront` de esta página (`RouteMessages`; la raíz manda solo `SHELL`).
  return (
    <RouteMessages scope="storefront">
      <WishlistMailActionPage />
    </RouteMessages>
  );
}
