import type { Role } from '@/types/contract';

/**
 * Rutas de «Mi cuenta» por rol (contrato v1.67 · ARCHITECTURE §4.47.7 · DESIGN_SYSTEM §33.5).
 *
 * Dos rutas, un juego de componentes: el cliente vive bajo `(storefront)` y el staff bajo
 * `(admin)`. ⭐ Las dos URL `/password` son CONTRATO con el login (`AuthForm`) y con el
 * interceptor global del `api-client` (`403 PASSWORD_CHANGE_REQUIRED`): no se renombran.
 *
 * Todo lo que necesite decidir «a dónde va este rol» pasa por aquí — un `if role` en un sitio,
 * no en cinco.
 */

export const STAFF_ROLES: readonly Role[] = ['vault_operator', 'super_admin'];

export function isStaffRole(role?: Role | null): boolean {
  return !!role && STAFF_ROLES.includes(role);
}

/** Destino tras un login exitoso: staff → back-office, el resto → tienda. */
export function homeForRole(role?: Role | null): '/admin' | '/' {
  return isStaffRole(role) ? '/admin' : '/';
}

/** «Mi cuenta» del rol. */
export function accountRouteForRole(role?: Role | null): '/admin/account' | '/account' {
  return isStaffRole(role) ? '/admin/account' : '/account';
}

/** Página de contraseña del rol — la MISMA sirve de bloqueo con temporal (§33.8). */
export function passwordRouteForRole(
  role?: Role | null,
): '/admin/account/password' | '/account/password' {
  return isStaffRole(role) ? '/admin/account/password' : '/account/password';
}

/**
 * `true` si `pathname` (SIN prefijo de locale) es la página de contraseña de CUALQUIER rol.
 * El bloqueo por temporal no rebota desde aquí: es la única pantalla operable.
 */
export function isPasswordRoute(pathname: string): boolean {
  return pathname === '/account/password' || pathname === '/admin/account/password';
}

/**
 * Solo se honra un `next` INTERNO (empieza con una sola `/`) para evitar open redirects
 * (`//evil.com` es protocol-relative y también se rechaza). Es la misma regla que `AuthForm`
 * aplicaba a `?next=`; vive aquí para que la página de contraseña la reutilice al «Listo».
 */
export function safeNext(next?: string | null): string | undefined {
  if (!next) return undefined;
  if (!next.startsWith('/') || next.startsWith('//')) return undefined;
  return next;
}

/** Locales de la app tal como aparecen como primer segmento de la URL. */
const LOCALE_SEGMENTS = new Set(['es', 'en']);

/**
 * Separa el prefijo de locale de un `pathname` completo del navegador (`/es/vault?x=1` →
 * `{ locale: 'es', path: '/vault?x=1' }`). Lo usa el interceptor global, que corre fuera de
 * React y no tiene `useLocale()`.
 */
export function splitLocale(fullPath: string): { locale: string | null; path: string } {
  const m = /^\/([a-z]{2})(?=\/|$|\?)/.exec(fullPath);
  if (m && LOCALE_SEGMENTS.has(m[1])) {
    const rest = fullPath.slice(m[0].length);
    return { locale: m[1], path: rest.startsWith('/') || rest.startsWith('?') ? rest || '/' : `/${rest}` };
  }
  return { locale: null, path: fullPath || '/' };
}

/**
 * Destino de contraseña del rol, reenviando la ruta actual (CON su query string) como `?next=` y
 * marcando `reason=required` (DESIGN_SYSTEM §33.8 pasos 3/4). Si ya estamos en una página de
 * contraseña devuelve `null`: no hay a dónde rebotar.
 *
 * Una sola construcción para los CUATRO sitios que rebotan (techlead F2-3, 2026-09-11): el
 * interceptor global del `api-client` (fuera de React: le llega `location.pathname + search`, CON
 * locale, y lo devuelve con locale), `PrivateRouteGuard`, `AdminShell` (les llega el `pathname`
 * SIN locale de `@/i18n/navigation` + `useSearchParams`, y el router de next-intl vuelve a poner el
 * locale) y `AuthForm` (`reason: null`: tras el login se navega DIRECTO, sin banner — §33.8 paso 1 —
 * y el `?next=` que traía el login se reenvía tal cual).
 */
export function buildPasswordChangeRedirect(
  role: Role | undefined,
  currentFullPath: string,
  opts: { reason?: 'required' | null } = {},
): string | null {
  const reason = opts.reason === undefined ? 'required' : opts.reason;
  const { locale, path } = splitLocale(currentFullPath);
  const pathOnly = path.split('?')[0];
  if (isPasswordRoute(pathOnly)) return null;
  const target = passwordRouteForRole(role);
  const query = new URLSearchParams();
  const next = safeNext(path);
  if (next && next !== '/') query.set('next', next);
  if (reason) query.set('reason', reason);
  const qs = query.toString();
  return `${locale ? `/${locale}` : ''}${target}${qs ? `?${qs}` : ''}`;
}
