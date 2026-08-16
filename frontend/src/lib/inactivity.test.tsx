import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render } from '@testing-library/react';
import { InactivityProvider, INACTIVITY_LOGOUT_MS } from './inactivity';
import { setStoredUser } from '@/lib/session';
import type { UserDTO } from '@/types/contract';

const replace = vi.fn();
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ replace }),
  usePathname: () => '/',
}));

const logout = vi.fn(() => Promise.resolve());
vi.mock('@/lib/api', () => ({ logout: () => logout() }));

const user: UserDTO = {
  id: 'u-1',
  email: 'ash@example.com',
  name: 'Ash',
  role: 'customer',
  locale: 'es',
};

describe('InactivityProvider — auto-logout por inactividad', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    replace.mockClear();
    logout.mockClear();
    setStoredUser(null);
    window.localStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('con sesión: dispara logout + redirige tras el umbral de inactividad', async () => {
    setStoredUser(user);
    render(
      <InactivityProvider>
        <div>app</div>
      </InactivityProvider>,
    );

    // Antes del umbral no cierra sesión.
    act(() => {
      vi.advanceTimersByTime(INACTIVITY_LOGOUT_MS - 1000);
    });
    expect(logout).not.toHaveBeenCalled();

    // Al cruzar el umbral se cierra la sesión.
    await act(async () => {
      vi.advanceTimersByTime(2000);
      await Promise.resolve();
    });
    expect(logout).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith({
      pathname: '/login',
      query: { reason: 'inactivity' },
    });
  });

  it('la actividad reinicia el temporizador (no cierra sesión antes de tiempo)', async () => {
    setStoredUser(user);
    render(
      <InactivityProvider>
        <div>app</div>
      </InactivityProvider>,
    );

    // Casi al umbral, hay actividad: se reinicia el contador.
    act(() => {
      vi.advanceTimersByTime(INACTIVITY_LOGOUT_MS - 1000);
      window.dispatchEvent(new Event('mousemove'));
    });
    // Otro tramo casi completo: sigue sin cerrar porque se reinició.
    act(() => {
      vi.advanceTimersByTime(INACTIVITY_LOGOUT_MS - 1000);
    });
    expect(logout).not.toHaveBeenCalled();

    // Ahora sí, sin actividad, se cruza el umbral.
    await act(async () => {
      vi.advanceTimersByTime(2000);
      await Promise.resolve();
    });
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it('sin sesión: nunca dispara logout', () => {
    setStoredUser(null);
    render(
      <InactivityProvider>
        <div>app</div>
      </InactivityProvider>,
    );

    act(() => {
      vi.advanceTimersByTime(INACTIVITY_LOGOUT_MS * 3);
    });
    expect(logout).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });
});
