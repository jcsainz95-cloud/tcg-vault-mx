'use client';

import { useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { usePathname, useRouter } from '@/i18n/navigation';
import { useSession } from '@/lib/session';
import { config } from '@/lib/config';
import { buildPasswordChangeRedirect, isPasswordRoute } from '@/lib/account-routes';

/**
 * Rutas privadas del storefront: requieren sesión. El link ya se oculta sin sesión
 * (StorefrontHeader P-13), pero el acceso directo por URL renderizaba la vista y solo
 * al pegarle al backend salía un banner 401 críptico.
 */
/*
 * `/checkout` NO está aquí a propósito (v1.21-guest-checkout, autorizado por el orquestador):
 * PROJECT §J criterio 45 exige que un visitante SIN cuenta llegue al checkout y pague, y el
 * contrato §4-G hace `@Public()` los endpoints `/checkout/guest/*`. Es requisito de producto,
 * no una relajación de seguridad: este guard es una conveniencia de CLIENTE y el backend sigue
 * siendo la autoridad (toda llamada privilegiada responde 401). El flujo con cuenta no cambia.
 * Si alguien vuelve a meter '/checkout' aquí, rompe el guest checkout: lo ancla el test
 * `app/[locale]/(storefront)/checkout/checkout-public-route.test.tsx` (modo REAL, no mock).
 */
// v1.67 (Stream A): `/account` y `/account/password` son privadas (contrato §4.47.7).
const PRIVATE_PREFIXES = ['/vault', '/orders', '/shipments', '/account'];

function isPrivatePath(pathname: string): boolean {
  return PRIVATE_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Guard CLIENTE de rutas privadas del storefront. El access token vive en localStorage
 * (no cookie), así que el guard es de cliente, no middleware server. Espeja el efecto de
 * AdminShell: en modo real, si la ruta es privada y `ready && !isAuthenticated`, redirige
 * a `/login?next=<ruta>` en vez de renderizar contenido que dará 401. En modo mock/demo es
 * INERTE (mismo criterio `requireAuth = !config.useMocks` que AdminShell: se puede navegar
 * el storefront sin backend). El backend sigue siendo la autoridad.
 */
export function PrivateRouteGuard({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated, ready } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations('common');

  const requireAuth = !config.useMocks;
  const guarded = requireAuth && isPrivatePath(pathname);

  /**
   * v1.67 — contraseña temporal BLOQUEANTE (contrato §1; DESIGN_SYSTEM §33.8 paso 3). Con sesión y
   * `user.mustChangePassword === true`, TODO el storefront (público o privado: este guard envuelve
   * `children` del layout) rebota a `/account/password?next=<ruta>&reason=required`, salvo la
   * propia página de contraseña. Aplica también en modo mock: la bandera viene de la sesión local,
   * no del backend, y es lo que permite recorrer el bloqueo en los E2E de fixtures.
   */
  const mustChange = ready && isAuthenticated && user?.mustChangePassword === true;
  const blocked = mustChange && !isPasswordRoute(pathname);
  // El `next` del rebote conserva el query string (`/vault?tab=retiros` vuelve a la pestaña): la
  // construcción es la MISMA que usa el interceptor global (`buildPasswordChangeRedirect`, F2-3).
  // `useSearchParams` puede ser `null` fuera del App Router (tests): se tolera.
  const searchParams = useSearchParams();
  const search = searchParams?.toString() ?? '';
  const fullPath = search ? `${pathname}?${search}` : pathname;

  useEffect(() => {
    if (blocked) {
      const target = buildPasswordChangeRedirect(user?.role, fullPath);
      if (target) router.replace(target);
      return;
    }
    if (!guarded) return;
    if (ready && !isAuthenticated) {
      router.replace({ pathname: '/login', query: { next: pathname } });
    }
  }, [blocked, guarded, ready, isAuthenticated, router, pathname, fullPath, user?.role]);

  // En ruta privada sin sesión (o mientras se resuelve), o bloqueado por temporal, mostramos carga,
  // NUNCA la vista (evita el flash de contenido privado + el banner 401 / el 403 del guard).
  if (blocked || (guarded && (!ready || !isAuthenticated))) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center" aria-busy="true">
        <span className="inline-flex items-center gap-2 font-mono text-sm text-muted">
          <Loader2 size={16} className="animate-spin" aria-hidden />
          {t('loading')}
        </span>
      </div>
    );
  }

  return <>{children}</>;
}
