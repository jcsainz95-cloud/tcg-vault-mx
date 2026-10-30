import { RouteMessages } from '@/components/i18n/RouteMessages';

/**
 * §DYN.6.7 (c1): el ámbito `storefront` del comodín. Su página solo llama a `notFound()`; el `RouteMessages` vive aquí
 * para que toda `page.tsx` de `[locale]` fuera de `(admin)` tenga exactamente uno entre ella y la raíz (DYN-F10 c).
 */
export default function CatchAllLayout({ children }: { children: React.ReactNode }) {
  return <RouteMessages scope="storefront">{children}</RouteMessages>;
}
