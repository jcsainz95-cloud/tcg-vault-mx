import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { GoogleSignInButton } from './GoogleSignInButton';
import { getToken, setToken } from '@/lib/api-client';
import { config } from '@/lib/config';

describe('GoogleSignInButton (§6.7, rama mock)', () => {
  beforeEach(() => setToken(null));

  it('muestra el CTA "Continuar con Google"', () => {
    renderWithProviders(<GoogleSignInButton onSuccess={() => {}} />, 'es');
    expect(screen.getByRole('button', { name: /Continuar con Google/ })).toBeInTheDocument();
  });

  it('al hacer clic (mock) canjea el idToken, deja sesión y llama onSuccess', async () => {
    const onSuccess = vi.fn();
    renderWithProviders(<GoogleSignInButton onSuccess={onSuccess} />, 'es');

    fireEvent.click(screen.getByRole('button', { name: /Continuar con Google/ }));
    // Estado de carga: label "Conectando…"
    expect(screen.getByText('Conectando…')).toBeInTheDocument();

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(getToken()).toBe('mock.session.token');
  });
});

// D6: en modo real (GIS), si el usuario descarta/omite el prompt, el `callback` del
// credential nunca corre; el botón NO debe quedar atascado en "Conectando…".
describe('GoogleSignInButton (§6.7, rama real GIS — descarte del prompt)', () => {
  const original = { useMocks: config.useMocks, googleClientId: config.googleClientId };

  beforeEach(() => {
    setToken(null);
    config.useMocks = false;
    config.googleClientId = 'test-client-id';
  });
  afterEach(() => {
    config.useMocks = original.useMocks;
    config.googleClientId = original.googleClientId;
    delete (window as { google?: unknown }).google;
  });

  function notification(over: Record<string, () => boolean>) {
    return {
      isDisplayMoment: () => false,
      isNotDisplayed: () => false,
      isSkippedMoment: () => false,
      isDismissedMoment: () => false,
      ...over,
    };
  }

  it('al descartar el prompt (isDismissedMoment) sale del estado "connecting"', async () => {
    let momentListener: ((n: ReturnType<typeof notification>) => void) | undefined;
    (window as { google?: unknown }).google = {
      accounts: {
        id: {
          initialize: vi.fn(),
          prompt: vi.fn((cb?: (n: ReturnType<typeof notification>) => void) => {
            momentListener = cb;
          }),
        },
      },
    };
    const onSuccess = vi.fn();
    renderWithProviders(<GoogleSignInButton onSuccess={onSuccess} />, 'es');
    const btn = screen.getByRole('button', { name: /Continuar con Google/ });

    fireEvent.click(btn);
    expect(screen.getByText('Conectando…')).toBeInTheDocument();
    expect(btn).toBeDisabled();

    // El usuario cierra el One Tap sin autenticarse.
    act(() => momentListener?.(notification({ isDismissedMoment: () => true })));

    await waitFor(() => expect(screen.queryByText('Conectando…')).not.toBeInTheDocument());
    expect(btn).not.toBeDisabled();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(getToken()).toBeNull();
  });

  it('si el prompt no se puede mostrar (isNotDisplayed) tampoco queda en loading', async () => {
    let momentListener: ((n: ReturnType<typeof notification>) => void) | undefined;
    (window as { google?: unknown }).google = {
      accounts: {
        id: {
          initialize: vi.fn(),
          prompt: vi.fn((cb?: (n: ReturnType<typeof notification>) => void) => {
            momentListener = cb;
          }),
        },
      },
    };
    renderWithProviders(<GoogleSignInButton onSuccess={() => {}} />, 'es');
    const btn = screen.getByRole('button', { name: /Continuar con Google/ });

    fireEvent.click(btn);
    expect(btn).toBeDisabled();

    act(() => momentListener?.(notification({ isNotDisplayed: () => true })));

    await waitFor(() => expect(btn).not.toBeDisabled());
  });
});
