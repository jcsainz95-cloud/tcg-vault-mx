import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { GoogleSignInButton } from './GoogleSignInButton';
import { ApiClientError, getToken, setToken } from '@/lib/api-client';
import * as api from '@/lib/api';
import { config } from '@/lib/config';

describe('GoogleSignInButton (§6.7, rama mock)', () => {
  beforeEach(() => setToken(null));

  it('muestra el CTA "Continuar con Google"', () => {
    renderWithProviders(<GoogleSignInButton onSuccess={() => {}} />, 'es');
    expect(screen.getByRole('button', { name: /Continuar con Google/ })).toBeInTheDocument();
  });

  it('al hacer clic (mock, cuenta Google existente) canjea el idToken, deja sesión y llama onSuccess', async () => {
    window.localStorage.setItem('tcg.mock.googleExisting', '1');
    const onSuccess = vi.fn();
    renderWithProviders(<GoogleSignInButton onSuccess={onSuccess} />, 'es');

    fireEvent.click(screen.getByRole('button', { name: /Continuar con Google/ }));
    // Estado de carga: label "Conectando…"
    expect(screen.getByText('Conectando…')).toBeInTheDocument();

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(getToken()).toBe('mock.session.token');
    window.localStorage.removeItem('tcg.mock.googleExisting');
  });
});

// Modo real (GIS): el clic del usuario cae SIEMPRE en el botón oficial de GIS (renderButton),
// superpuesto al de marca desde el primer render; One Tap ya no es necesario.
describe('GoogleSignInButton (§6.7, rama real GIS — botón oficial superpuesto)', () => {
  const original = { useMocks: config.useMocks, googleClientId: config.googleClientId };
  type Cb = (r: { credential?: string }) => void;

  beforeEach(() => {
    setToken(null);
    config.useMocks = false;
    config.googleClientId = 'test-client-id';
  });
  afterEach(() => {
    config.useMocks = original.useMocks;
    config.googleClientId = original.googleClientId;
    delete (window as { google?: unknown }).google;
    vi.restoreAllMocks();
  });

  function installGis(withRender = true) {
    const h: { cb?: Cb; renderButton: ReturnType<typeof vi.fn>; prompt: ReturnType<typeof vi.fn> } = {
      renderButton: vi.fn(),
      prompt: vi.fn(),
    };
    (window as { google?: unknown }).google = {
      accounts: {
        id: {
          initialize: vi.fn((o: { callback: Cb }) => {
            h.cb = o.callback;
          }),
          prompt: h.prompt,
          ...(withRender ? { renderButton: h.renderButton } : {}),
        },
      },
    };
    return h;
  }

  it('hay UN solo botón "Continuar con Google" y el oficial se pinta superpuesto desde el primer render', async () => {
    const h = installGis();
    renderWithProviders(<GoogleSignInButton onSuccess={() => {}} />, 'es');
    await waitFor(() => expect(h.renderButton).toHaveBeenCalledTimes(1));
    expect(screen.getAllByRole('button', { name: /Continuar con Google/ })).toHaveLength(1);
    expect(screen.getByTestId('google-overlay')).toBeInTheDocument();
  });

  it('la credencial que entra por el botón oficial canjea y llama onSuccess; un callback repetido no reenvía', async () => {
    const h = installGis();
    const spy = vi.spyOn(api, 'loginWithGoogle').mockResolvedValue({
      user: { role: 'customer' },
    } as unknown as Awaited<ReturnType<typeof api.loginWithGoogle>>);
    const onSuccess = vi.fn();
    renderWithProviders(<GoogleSignInButton onSuccess={onSuccess} />, 'es');
    await waitFor(() => expect(h.cb).toBeDefined());

    act(() => {
      h.cb?.({ credential: 'tok' });
      h.cb?.({ credential: 'tok' });
    });
    expect(screen.getByText('Conectando…')).toBeInTheDocument();
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(spy).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByText('Conectando…')).not.toBeInTheDocument());
  });

  it('un callback sin credential muestra error y no deja el botón en "Conectando…"', async () => {
    const h = installGis();
    renderWithProviders(<GoogleSignInButton onSuccess={() => {}} />, 'es');
    await waitFor(() => expect(h.cb).toBeDefined());
    act(() => h.cb?.({}));
    expect(screen.queryByText('Conectando…')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Continuar con Google/ })).not.toBeDisabled();
  });

  it('sin renderButton: sin overlay, un solo botón y el clic (teclado) lanza One Tap sin quedar en loading', async () => {
    const h = installGis(false);
    renderWithProviders(<GoogleSignInButton onSuccess={() => {}} />, 'es');
    const btn = screen.getByRole('button', { name: /Continuar con Google/ });
    expect(screen.queryByTestId('google-overlay')).not.toBeInTheDocument();
    fireEvent.click(btn);
    expect(h.prompt).toHaveBeenCalledTimes(1);
    expect(btn).not.toBeDisabled();
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });
});

/**
 * §37.13 v4.9.1 · contrato v1.80.8.1: `/auth/google` solo emite `429 RATE_LIMITED` (por IP) ⇒ se pinta con
 * `auth.rateLimitedByIp*`, ⛔ sin enlace a restablecer y ⛔ sin «correo»; no el genérico `error.RATE_LIMITED`.
 */
describe('GoogleSignInButton · 429 RATE_LIMITED (errata v1.80.8.1)', () => {
  beforeEach(() => setToken(null));
  afterEach(() => vi.restoreAllMocks());

  it.each([
    [undefined, 'Demasiados intentos seguidos. Espera un momento y vuelve a intentarlo.'],
    [{ retryAfterSeconds: 61 }, 'Demasiados intentos seguidos. Vuelve a intentarlo en 2 minutos.'],
  ])('details=%o ⇒ texto por IP, sin enlace y sin «correo»', async (details, text) => {
    vi.spyOn(api, 'loginWithGoogle').mockRejectedValue(new ApiClientError(429, { code: 'RATE_LIMITED', message: 'x', details }));
    const onSuccess = vi.fn();
    renderWithProviders(<GoogleSignInButton onSuccess={onSuccess} />, 'es');
    fireEvent.click(screen.getByRole('button', { name: /Continuar con Google/ }));

    const box = await screen.findByTestId('google-rate-limited');
    expect(box).toHaveTextContent(text);
    expect(box.textContent).not.toMatch(/correo|restablece/i);
    expect(box.querySelector('a')).toBeNull();
    expect(screen.getByRole('alert')).toBe(box.firstElementChild);
    expect(onSuccess).not.toHaveBeenCalled();
    // Sale del «Conectando…»: el botón vuelve a estar disponible.
    expect(screen.getByRole('button', { name: /Continuar con Google/ })).toBeEnabled();
  });
});
