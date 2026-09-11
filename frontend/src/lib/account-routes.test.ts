import { describe, it, expect } from 'vitest';
import {
  accountRouteForRole,
  buildPasswordChangeRedirect,
  homeForRole,
  isPasswordRoute,
  isStaffRole,
  passwordRouteForRole,
  safeNext,
  splitLocale,
} from './account-routes';

/** Rutas de cuenta por rol (contrato v1.67 · ARCHITECTURE §4.47.7): un `if role` en un sitio. */
describe('account-routes', () => {
  it('rol → home / cuenta / contraseña', () => {
    expect(isStaffRole('vault_operator')).toBe(true);
    expect(isStaffRole('super_admin')).toBe(true);
    expect(isStaffRole('customer')).toBe(false);
    expect(isStaffRole(undefined)).toBe(false);
    expect(homeForRole('super_admin')).toBe('/admin');
    expect(homeForRole('customer')).toBe('/');
    expect(accountRouteForRole('vault_operator')).toBe('/admin/account');
    expect(accountRouteForRole('customer')).toBe('/account');
    expect(passwordRouteForRole('super_admin')).toBe('/admin/account/password');
    expect(passwordRouteForRole('customer')).toBe('/account/password');
    expect(passwordRouteForRole(undefined)).toBe('/account/password');
  });

  it('isPasswordRoute reconoce las DOS URL de contrato y nada más', () => {
    expect(isPasswordRoute('/account/password')).toBe(true);
    expect(isPasswordRoute('/admin/account/password')).toBe(true);
    expect(isPasswordRoute('/account')).toBe(false);
    expect(isPasswordRoute('/change-password')).toBe(false);
  });

  it('safeNext solo honra rutas internas (sin open redirect ni protocol-relative)', () => {
    expect(safeNext('/vault')).toBe('/vault');
    expect(safeNext('/admin/m4?x=1')).toBe('/admin/m4?x=1');
    expect(safeNext('https://evil.example')).toBeUndefined();
    expect(safeNext('//evil.example')).toBeUndefined();
    expect(safeNext('')).toBeUndefined();
    expect(safeNext(undefined)).toBeUndefined();
  });

  it('splitLocale separa el prefijo de locale de la ruta completa del navegador', () => {
    expect(splitLocale('/es/vault?x=1')).toEqual({ locale: 'es', path: '/vault?x=1' });
    expect(splitLocale('/en')).toEqual({ locale: 'en', path: '/' });
    expect(splitLocale('/vault')).toEqual({ locale: null, path: '/vault' });
    expect(splitLocale('/estudio/x')).toEqual({ locale: null, path: '/estudio/x' });
  });

  it('buildPasswordChangeRedirect reenvía la ruta como next y marca reason=required, por rol y locale', () => {
    expect(buildPasswordChangeRedirect('customer', '/es/vault?tab=retiros')).toBe(
      '/es/account/password?next=%2Fvault%3Ftab%3Dretiros&reason=required',
    );
    expect(buildPasswordChangeRedirect('vault_operator', '/en/admin/m4')).toBe(
      '/en/admin/account/password?next=%2Fadmin%2Fm4&reason=required',
    );
    // En la raíz no hay `next` que valga la pena reenviar.
    expect(buildPasswordChangeRedirect('customer', '/es')).toBe('/es/account/password?reason=required');
  });

  it('buildPasswordChangeRedirect sin locale (pathname de next-intl) devuelve una ruta sin locale y CON el query string en next', () => {
    // Es lo que reciben PrivateRouteGuard / AdminShell: `usePathname()` + `useSearchParams()`.
    expect(buildPasswordChangeRedirect('customer', '/vault?tab=retiros')).toBe(
      '/account/password?next=%2Fvault%3Ftab%3Dretiros&reason=required',
    );
    expect(buildPasswordChangeRedirect('super_admin', '/admin/m4?status=guia')).toBe(
      '/admin/account/password?next=%2Fadmin%2Fm4%3Fstatus%3Dguia&reason=required',
    );
    expect(buildPasswordChangeRedirect('customer', '/')).toBe('/account/password?reason=required');
  });

  it('buildPasswordChangeRedirect con reason:null (login) reenvía solo el next, y sin next no lleva query', () => {
    expect(buildPasswordChangeRedirect('vault_operator', '/admin/m4', { reason: null })).toBe(
      '/admin/account/password?next=%2Fadmin%2Fm4',
    );
    expect(buildPasswordChangeRedirect('customer', '/', { reason: null })).toBe('/account/password');
    // Un next externo (open redirect) no se reenvía.
    expect(buildPasswordChangeRedirect('customer', 'https://evil.example', { reason: null })).toBe('/account/password');
    expect(buildPasswordChangeRedirect('customer', '//evil.example', { reason: null })).toBe('/account/password');
  });

  it('buildPasswordChangeRedirect devuelve null si ya estamos en una página de contraseña (no cicla)', () => {
    expect(buildPasswordChangeRedirect('customer', '/es/account/password?next=%2Fvault')).toBeNull();
    expect(buildPasswordChangeRedirect('super_admin', '/es/admin/account/password')).toBeNull();
  });
});
