import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { GoogleSignInButton, __resetGoogleIdentityForTests } from './GoogleSignInButton';
import { getToken, setToken } from '@/lib/api-client';
import { config } from '@/lib/config';
import * as api from '@/lib/api';

describe('GoogleSignInButton (§6.7, rama mock explícita)', () => {
  beforeEach(() => {
    setToken(null);
    __resetGoogleIdentityForTests();
  });

  it('muestra el CTA "Continuar con Google"', () => {
    renderWithProviders(<GoogleSignInButton onSuccess={() => {}} />, 'es');
    expect(screen.getByRole('button', { name: /Continuar con Google/ })).toBeInTheDocument();
  });

  it('al hacer clic (mock) canjea el idToken, deja sesión y llama onSuccess', async () => {
    const onSuccess = vi.fn();
    renderWithProviders(<GoogleSignInButton onSuccess={onSuccess} />, 'es');

    fireEvent.click(screen.getByRole('button', { name: /Continuar con Google/ }));
    // Estado de carga: label "Conectando…"
    expect(screen.getByText('Conectando…', { selector: 'span' })).toBeInTheDocument();

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(getToken()).toBe('mock.session.token');
  });
});

/*
 * D-1 / D-2 / D-3 (defecto de producción, 2026-09-05).
 *
 * Síntoma: el dueño picaba «Continuar con Google» y no pasaba NADA. La consola de
 * producción mostraba `FedCM get() rejects with NetworkError` + el aviso de GIS de que
 * los métodos de estado del prompt de One Tap dejan de funcionar con FedCM, y en
 * pantalla no aparecía ni un mensaje. Estas pruebas fijan las tres curas:
 *
 *  D-1  un clic SIEMPRE produce respuesta visible (ventana de Google, o mensaje nuestro).
 *  D-2  se usa `renderButton()` (flujo de botón), no `prompt()` (One Tap) ni moment listeners.
 *  D-3  el script y `initialize()` ocurren UNA vez por página, no por instancia montada.
 *
 * Y el defecto que venía de antes: si la librería de Google no cargó, JAMÁS se manda
 * `mock-google-id-token` al backend real.
 */
type GsiSpies = {
  initialize: ReturnType<typeof vi.fn>;
  renderButton: ReturnType<typeof vi.fn>;
  /** Dispara la credencial como lo haría GIS. */
  emit: (credential?: string) => void;
  /** Dispara el `click_listener` del botón dibujado por Google. */
  click: () => void;
};

function installFakeGis(): GsiSpies {
  let callback: ((r: { credential?: string }) => void) | undefined;
  let clickListener: (() => void) | undefined;
  const initialize = vi.fn((opts: { callback: (r: { credential?: string }) => void }) => {
    callback = opts.callback;
  });
  const renderButton = vi.fn((parent: HTMLElement, opts: { click_listener?: () => void }) => {
    clickListener = opts.click_listener;
    const b = document.createElement('button');
    b.textContent = 'google-rendered-button';
    parent.appendChild(b);
  });
  (window as { google?: unknown }).google = { accounts: { id: { initialize, renderButton } } };
  return {
    initialize,
    renderButton,
    emit: (credential?: string) => act(() => callback?.({ credential })),
    click: () => act(() => clickListener?.()),
  };
}

describe('GoogleSignInButton (§6.7, rama real GIS con renderButton)', () => {
  const original = { useMocks: config.useMocks, googleClientId: config.googleClientId };

  beforeEach(() => {
    setToken(null);
    __resetGoogleIdentityForTests();
    vi.restoreAllMocks();
    config.useMocks = false;
    config.googleClientId = 'test-client-id';
    document.querySelectorAll('script[data-gsi-client="true"]').forEach((s) => s.remove());
  });
  afterEach(() => {
    vi.useRealTimers();
    config.useMocks = original.useMocks;
    config.googleClientId = original.googleClientId;
    delete (window as { google?: unknown }).google;
  });

  it('D-2: dibuja el botón oficial de Google (renderButton) y NO usa prompt/One Tap', async () => {
    const gis = installFakeGis();
    renderWithProviders(<GoogleSignInButton onSuccess={() => {}} />, 'es');

    await waitFor(() => expect(gis.renderButton).toHaveBeenCalled());
    // El contenedor recibe el botón de Google...
    const parent = gis.renderButton.mock.calls[0][0] as HTMLElement;
    expect(parent).toBe(screen.getByTestId('google-gsi-button'));
    expect(parent.querySelector('button')).not.toBeNull();
    // ...y el componente ya no depende de `prompt()` ni de los moment listeners
    // (`isNotDisplayed`/`isSkippedMoment`), que GIS declara en vía de extinción con FedCM.
    const id = (window.google as unknown as Record<string, never>) as unknown as {
      accounts: { id: Record<string, unknown> };
    };
    expect(id.accounts.id.prompt).toBeUndefined();
  });

  it('D-1a: clic con la librería presente → se invoca el camino real y llega el ID token de Google al backend', async () => {
    const spy = vi
      .spyOn(api, 'loginWithGoogle')
      .mockResolvedValue({ user: { role: 'customer' } } as Awaited<ReturnType<typeof api.loginWithGoogle>>);
    const gis = installFakeGis();
    const onSuccess = vi.fn();
    renderWithProviders(<GoogleSignInButton onSuccess={onSuccess} />, 'es');
    await waitFor(() => expect(gis.renderButton).toHaveBeenCalled());

    // El clic da respuesta visible inmediata (estado "Conectando…" anunciado por aria-live).
    gis.click();
    expect(screen.getByRole('status')).toHaveTextContent('Conectando…');

    gis.emit('real.google.id.token');
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith('customer'));
    expect(spy).toHaveBeenCalledWith('real.google.id.token');
    // Jamás el token de mock contra el backend real.
    expect(spy).not.toHaveBeenCalledWith('mock-google-id-token');
  });

  it('D-1b: clic sin que Google abra nada (FedCM rechazado) → mensaje accionable, nunca silencio', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const spy = vi.spyOn(api, 'loginWithGoogle');
    const gis = installFakeGis();
    renderWithProviders(<GoogleSignInButton onSuccess={() => {}} />, 'es');
    await waitFor(() => expect(gis.renderButton).toHaveBeenCalled());

    // GIS rechaza el get() de FedCM: no hay callback ni moment listener. Antes: silencio total.
    gis.click();
    await act(async () => {
      vi.advanceTimersByTime(6_000);
    });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/bloqueando el inicio de sesión con terceros/i);
    expect(alert).toHaveTextContent(/correo y contraseña/i);
    expect(spy).not.toHaveBeenCalled();
    expect(getToken()).toBeNull();
  });

  it('D-1c: si Google responde sin credential, se dice el error (no se queda mudo)', async () => {
    const gis = installFakeGis();
    renderWithProviders(<GoogleSignInButton onSuccess={() => {}} />, 'es');
    await waitFor(() => expect(gis.renderButton).toHaveBeenCalled());

    gis.click();
    gis.emit(undefined);

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('status')).not.toHaveTextContent('Conectando…');
  });

  it('librería ausente (no carga el script) → mensaje propio y NUNCA el token falso', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const spy = vi.spyOn(api, 'loginWithGoogle');
    // Sin `window.google`: el script se inyecta y nunca resuelve (bloqueador/CSP/red).
    renderWithProviders(<GoogleSignInButton onSuccess={() => {}} />, 'es');

    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/No pudimos cargar el inicio de sesión de Google/i);
    // Este es el defecto original: caía al branch de MOCK contra el backend real.
    expect(spy).not.toHaveBeenCalled();

    // Y el clic sobre el botón de respaldo tampoco canjea nada inventado.
    fireEvent.click(screen.getByRole('button', { name: /Continuar con Google/ }));
    expect(spy).not.toHaveBeenCalled();
    expect(getToken()).toBeNull();
    expect(await screen.findByRole('alert')).toHaveTextContent(/No pudimos cargar/i);
  });

  it('sin NEXT_PUBLIC_GOOGLE_CLIENT_ID en producción → mensaje, no modo mock encubierto', async () => {
    const spy = vi.spyOn(api, 'loginWithGoogle');
    config.googleClientId = '';
    renderWithProviders(<GoogleSignInButton onSuccess={() => {}} />, 'es');

    fireEvent.click(screen.getByRole('button', { name: /Continuar con Google/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/No pudimos cargar/i);
    expect(spy).not.toHaveBeenCalled();
    expect(getToken()).toBeNull();
  });

  it('D-3: dos instancias montadas a la vez inyectan UN script y llaman initialize() UNA vez', async () => {
    // Sin `window.google` todavía: se observa la inyección real del <script>.
    renderWithProviders(
      <>
        <GoogleSignInButton onSuccess={() => {}} />
        <GoogleSignInButton onSuccess={() => {}} />
      </>,
      'es',
    );

    const scripts = document.querySelectorAll<HTMLScriptElement>('script[data-gsi-client="true"]');
    expect(scripts).toHaveLength(1);
    expect(scripts[0].src).toBe('https://accounts.google.com/gsi/client');

    // Llega la librería: `initialize()` una sola vez (GIS solo respeta la última llamada),
    // pero cada instancia dibuja su propio botón.
    const gis = installFakeGis();
    await act(async () => {
      scripts[0].dispatchEvent(new Event('load'));
    });

    await waitFor(() => expect(gis.renderButton).toHaveBeenCalledTimes(2));
    expect(gis.initialize).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll('script[data-gsi-client="true"]')).toHaveLength(1);
  });

  it('D-3: con dos instancias, la credencial va a la que originó el flujo', async () => {
    vi.spyOn(api, 'loginWithGoogle').mockResolvedValue({
      user: { role: 'customer' },
    } as Awaited<ReturnType<typeof api.loginWithGoogle>>);
    let clickSecond: (() => void) | undefined;
    let callback: ((r: { credential?: string }) => void) | undefined;
    (window as { google?: unknown }).google = {
      accounts: {
        id: {
          initialize: vi.fn((o: { callback: (r: { credential?: string }) => void }) => {
            callback = o.callback;
          }),
          renderButton: vi.fn((_p: HTMLElement, o: { click_listener?: () => void }) => {
            clickSecond = o.click_listener; // se queda con el del último render
          }),
        },
      },
    };
    const first = vi.fn();
    const second = vi.fn();
    renderWithProviders(
      <>
        <GoogleSignInButton onSuccess={first} />
        <GoogleSignInButton onSuccess={second} />
      </>,
      'es',
    );
    await waitFor(() => expect(clickSecond).toBeDefined());

    act(() => clickSecond?.());
    await act(async () => {
      callback?.({ credential: 'tok' });
    });

    await waitFor(() => expect(second).toHaveBeenCalled());
    expect(first).not.toHaveBeenCalled();
  });
});
