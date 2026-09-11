'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from '@/i18n/navigation';
import { useSession } from '@/lib/session';
import { isStaffRole } from '@/lib/account-routes';

/**
 * Layout de `/account/*` (ARCHITECTURE §4.47.7, «un redirect más»): si la sesión es de STAFF, va a
 * `/admin/account` + resto de la ruta (con su query). El operador aterriza en `/admin` y nunca pisa
 * el storefront; su cuenta vive bajo `AdminShell`. El resto de guards (sesión, temporal) los pone
 * `PrivateRouteGuard`, que envuelve este layout.
 */
export default function AccountLayout({ children }: { children: React.ReactNode }) {
  const { user, ready } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const staff = ready && isStaffRole(user?.role);

  useEffect(() => {
    if (!staff) return;
    const rest = pathname.replace(/^\/account/, '');
    const search = typeof window !== 'undefined' ? window.location.search : '';
    router.replace(`/admin/account${rest}${search}`);
  }, [staff, pathname, router]);

  if (staff) return null;
  return <>{children}</>;
}
