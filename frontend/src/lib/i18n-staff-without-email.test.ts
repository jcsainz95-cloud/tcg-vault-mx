import { describe, it, expect } from 'vitest';
import es from '../../messages/es.json';
import en from '../../messages/en.json';

/**
 * **UX-15 · paridad de las claves de `DESIGN_SYSTEM §42`** (equipo sin correo, v4.14). La paridad general
 * (`i18n-parity.test.ts`) compara los dos catálogos entre sí; esta lista fija además que CADA clave de §42 exista
 * en los dos, no vacía y con las mismas variables ICU — así borrar una en los dos catálogos a la vez también
 * se ve. Canario: borrar una en `en.json`.
 */
const KEYS = [
  'auth.emailOrUsername',
  'auth.lockedAskAdmin',
  'auth.lockedAskAdminRetryIn',
  'auth.invalidCredentialsUsername',
  'admin.m6.create.kind',
  'admin.m6.create.kindCustomer',
  'admin.m6.create.kindStaff',
  'admin.m6.create.kindStaffNote',
  'admin.m6.create.username',
  'admin.m6.create.usernameRule',
  'admin.m6.create.usernamePreview',
  'admin.m6.create.usernameError.required',
  'admin.m6.create.usernameError.length',
  'admin.m6.create.usernameError.charset',
  'admin.m6.create.usernameError.start',
  'admin.m6.create.errorUsernameTaken',
  'admin.m6.create.errorValidationStaff',
  'admin.m6.create.passwordHintStaff',
  'admin.m6.create.successBodyStaff',
  'admin.m6.create.providedPasswordNoteStaff',
  'admin.m6.resetHint',
  'admin.m6.table.identifier',
  'admin.m6.searchLabel',
  'admin.m6.usernameLine',
  'admin.m6.lockMark',
  'admin.m6.lockHint',
  'admin.m6.lockUnavailable',
  'admin.m6.auditAction.auth_password_lock',
  'admin.m6.auditAction.user_reset_password',
  'admin.m6.auditAction.user_create',
  'admin.lockNotice.title',
  'admin.lockNotice.body',
  'admin.lockNotice.changeLink',
  'admin.lockNotice.dismiss',
  'admin.lockNotice.dismissError',
  'error.ACCOUNT_WITHOUT_EMAIL',
  'account.usernameLine',
  'account.username.title',
  'account.username.note',
] as const;

function lookup(catalog: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((node, k) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[k] : undefined), catalog);
}

/** Nombres de variables ICU de primer nivel (`{minutes, plural, …}` ⇒ `minutes`; `#` no cuenta). */
function icuVars(s: string): string[] {
  return Array.from(s.matchAll(/\{\s*([a-zA-Z_][\w]*)\s*[,}]/g), (m) => m[1]).filter((v, i, a) => a.indexOf(v) === i).sort();
}

describe('UX-15 · claves de §42 en los dos catálogos', () => {
  it.each(KEYS)('%s existe en es y en, no vacía, con las mismas variables', (key) => {
    const vEs = lookup(es, key);
    const vEn = lookup(en, key);
    expect(typeof vEs).toBe('string');
    expect(typeof vEn).toBe('string');
    expect((vEs as string).trim()).not.toBe('');
    expect((vEn as string).trim()).not.toBe('');
    expect(icuVars(vEn as string)).toEqual(icuVars(vEs as string));
  });

  it('las claves que NO cambian siguen como estaban (regla dura 1 y criterio 270)', () => {
    expect(lookup(es, 'auth.email')).toBe('Correo');
    expect(lookup(es, 'error.INVALID_CREDENTIALS')).toBe('Correo o contraseña incorrectos.');
    expect(lookup(es, 'auth.rateLimitedByIp')).toBe('Demasiados intentos seguidos. Espera un momento y vuelve a intentarlo.');
  });
});
