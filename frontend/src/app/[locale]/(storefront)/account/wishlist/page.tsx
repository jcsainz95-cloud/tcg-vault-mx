import { WishlistView } from './WishlistView';

/**
 * «Mi lista de deseos» del cliente (DESIGN_SYSTEM §WSH-UX.3 · API_CONTRACT §WSH.4). Privada por el prefijo `/account`
 * (`PrivateRouteGuard`) y con el redirect de staff de `account/layout.tsx` (Q-WSH-UX-6: el equipo no tiene lista).
 */
export default function WishlistPage() {
  return <WishlistView />;
}
