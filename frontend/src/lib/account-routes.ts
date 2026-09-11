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
 * URL COMPLETA (con locale) de la página de contraseña del rol, reenviando la ruta actual como
 * `?next=` y marcando `reason=required` (DESIGN_SYSTEM §33.8 paso 4). Si ya estamos en una página
 * de contraseña devuelve `null`: no hay a dónde rebotar.
 */
export function buildPasswordChangeRedirect(
  role: Role | undefined,
  currentFullPath: string,
): string | null {
  const { locale, path } = splitLocale(currentFullPath);
  const pathOnly = path.split('?')[0];
  if (isPasswordRoute(pathOnly)) return null;
  const target = passwordRouteForRole(role);
  const query = new URLSearchParams();
  const next = safeNext(path);
  if (next && next !== '/') query.set('next', next);
  query.set('reason', 'required');
  return `${locale ? `/${locale}` : ''}${target}?${query.toString()}`;
}
