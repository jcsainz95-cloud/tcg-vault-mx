import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { isLogoutInProgress, markIntentionalLogout, resetIntentionalLogoutForTests, setStoredUser } from './session';
import { logout } from './api';
import { setToken } from './api-client';

/**
 * QA2-1 (FE-34 extendida a `/account`): la señal de «logout intencional» que hace que los guards no
 * impongan `/login?next=<ruta recién cerrada>`. Aquí se mide la señal misma: quién la enciende
 * (`logout()`), cuánto dura (ventana de 10 s, no consumo) y que un vaciado sin logout NO la enciende.
 */
describe('session · señal de logout intencional (QA2-1)', () => {
  beforeEach(() => {
    resetIntentionalLogoutForTests();
    window.localStorage.clear();
  });
  afterEach(() => vi.useRealTimers());

  it('sin marcar: no hay logout en curso', () => {
    expect(isLogoutInProgress()).toBe(false);
  });

  it('marcada: dura 10 s (no se consume al leerla) y luego caduca', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    markIntentionalLogout();
    expect(isLogoutInProgress()).toBe(true);
    expect(isLogoutInProgress()).toBe(true); // segunda lectura: sigue (el efecto del guard puede correr dos veces)
    expect(isLogoutInProgress(1_000_000 + 9_999)).toBe(true);
    expect(isLogoutInProgress(1_000_000 + 10_000)).toBe(false);
  });

  it('logout() (rama mock) enciende la señal ANTES de vaciar la sesión', async () => {
    setToken('t');
    setStoredUser({ id: 'u', email: 'a@b.c', name: 'A', role: 'customer', locale: 'es' });
    await logout();
    expect(isLogoutInProgress()).toBe(true);
    expect(window.localStorage.getItem('tcg.user')).toBeNull();
  });

  it('vaciar la sesión SIN logout (p. ej. refresh muerto) no enciende la señal', () => {
    setStoredUser({ id: 'u', email: 'a@b.c', name: 'A', role: 'customer', locale: 'es' });
    setStoredUser(null);
    expect(isLogoutInProgress()).toBe(false);
  });
});
