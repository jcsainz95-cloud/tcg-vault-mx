import { RouteMessages } from '@/components/i18n/RouteMessages';
import { StaffAccountRedirect } from './StaffAccountRedirect';

/**
 * Layout de `/account/*`. §DYN.6.7 (c1): el ámbito `storefront` de las tres páginas de la cuenta va aquí (un solo
 * `RouteMessages` entre cada página y la raíz); el redirect de staff, en el cliente (`StaffAccountRedirect`).
 */
export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return (
    <RouteMessages scope="storefront">
      <StaffAccountRedirect>{children}</StaffAccountRedirect>
    </RouteMessages>
  );
}
