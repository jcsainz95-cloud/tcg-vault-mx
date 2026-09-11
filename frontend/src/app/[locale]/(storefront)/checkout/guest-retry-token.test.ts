import { describe, it, expect, beforeEach } from 'vitest';
import { GUEST_RETRY_TOKEN_KEY, clearGuestRetryToken, readGuestRetryToken, saveGuestRetryToken } from './guest-retry-token';

/**
 * §4-R.3: el `checkoutToken` del invitado vive en `sessionStorage` (pestaña), caduca con
 * `checkoutTokenExpiresAt` y nunca toca `localStorage`.
 */
describe('guest-retry-token', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    window.localStorage.clear();
  });

  it('guarda en sessionStorage y NUNCA en localStorage', () => {
    saveGuestRetryToken('tok', new Date(Date.now() + 60_000).toISOString());
    expect(window.sessionStorage.getItem(GUEST_RETRY_TOKEN_KEY)).not.toBeNull();
    expect(window.localStorage.getItem(GUEST_RETRY_TOKEN_KEY)).toBeNull();
    expect(readGuestRetryToken()).toBe('tok');
  });

  it('un token vencido no se manda y se purga', () => {
    saveGuestRetryToken('tok', new Date(Date.now() - 1000).toISOString());
    expect(readGuestRetryToken()).toBeNull();
    expect(window.sessionStorage.getItem(GUEST_RETRY_TOKEN_KEY)).toBeNull();
  });

  it('malformado ⇒ null y se purga; vacío no se guarda; clear borra', () => {
    window.sessionStorage.setItem(GUEST_RETRY_TOKEN_KEY, '{not json');
    expect(readGuestRetryToken()).toBeNull();
    expect(window.sessionStorage.getItem(GUEST_RETRY_TOKEN_KEY)).toBeNull();
    saveGuestRetryToken('', new Date(Date.now() + 60_000).toISOString());
    expect(readGuestRetryToken()).toBeNull();
    saveGuestRetryToken('tok', new Date(Date.now() + 60_000).toISOString());
    clearGuestRetryToken();
    expect(readGuestRetryToken()).toBeNull();
  });
});
