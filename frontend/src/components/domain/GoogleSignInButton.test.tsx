import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, screen, fireEvent, waitFor, within } from '@testing-library/react';
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
 * D-1 / D-2 / D-3 (defecto de producción, 2026-09-05) y los bloqueantes B-1…B-8 del
 * rechazo de QA/techlead sobre ese pase (2026-09-06).
 *
 * Síntoma original: el dueño picaba «Continuar con Google» y no pasaba NADA. La consola de
 * producción mostraba `FedCM get() rejects with NetworkError` + el aviso de GIS de que
 * los métodos de estado del prompt de One Tap dejan de funcionar con FedCM, y en
 * pantalla no aparecía ni un mensaje. Estas pruebas fijan las curas:
 *
 *  D-1  un clic SIEMPRE produce respuesta visible (ventana de Google, o mensaje nuestro).
 *  D-2  se usa `renderButton()` (flujo de botón), no `prompt()` (One Tap) ni moment listeners.
 *  D-3  el script y `initialize()` ocurren UNA vez por página, no por instancia montada.
 *  B-1  la credencial NUNCA se entrega a una instancia desmontada.
 *  B-2  con GIS cargado que no dibuja, hay botón propio y mensaje: nunca cero.
 *  B-3  un `renderButton` que LANZA no deja la página en blanco.
 *  B-4  un fallo de RED no se reporta como token inválido.
 *  B-6  una credencial sin flujo activo produce UN canje, no uno por instancia.
 *  B-7  el clic de una instancia apaga el vigilante de la otra (no miente a los 6 s).
 *  B-8  la carga se memoiza POR client id y no acumula listeners en el reintento.
 *
 * Y el defecto que venía de antes: si la librería de Google no cargó, JAMÁS se manda
 * `mock-google-id-token` al backend real.
 */
type GsiSpies = {
  initialize: ReturnType<typeof vi.fn>;
  renderButton: ReturnType<typeof vi.fn>;
  /** B-5: el doble SÍ expone `prompt`, para que «no se usa One Tap» pueda fallar. */
  prompt: ReturnType<typeof vi.fn>;
  /** Dispara la credencial como lo haría GIS. */
  emit: (credential?: string) => void;
  /** Dispara el `click_listener` del botón dibujado por Google (índice de instancia). */
  click: (index?: number) => void;
  /** Cuántos `click_listener` se engancharon (uno por render de botón). */
  clickListeners: () => number;
};

/**
 * Doble de GIS. `draw` decide qué hace `renderButton`:
 *  - `button`  (default): mete un <button> en el contenedor, como GIS sano.
 *  - `nothing`: carga bien pero NO dibuja — origen JavaScript no autorizado / CSP (B-2).
 *  - `throw`  : lanza, como hace GIS ante un origen no autorizado (B-3).
 */
function installFakeGis(opts: { draw?: 'button' | 'nothing' | 'throw' } = {}): GsiSpies {
  const draw = opts.draw ?? 'button';
  let callback: ((r: { credential?: string }) => void) | undefined;
  const clickListeners: Array<(() => void) | undefined> = [];
  const initialize = vi.fn((o: { client_id: string; callback: (r: { credential?: string }) => void }) => {
    callback = o.callback;
  });
  const prompt = vi.fn();
  const renderButton = vi.fn((parent: HTMLElement, o: { click_listener?: () => void }) => {
    clickListeners.push(o.click_listener);
    if (draw === 'throw') throw new Error('The given origin is not allowed for the given client ID');
    if (draw === 'nothing') return;
    const b = document.createElement('button');
    b.textContent = 'google-rendered-button';
    parent.appendChild(b);
  });
  (window as { google?: unknown }).google = { accounts: { id: { initialize, renderButton, prompt } } };
  return {
    initialize,
    renderButton,
    prompt,
    emit: (credential?: string) => act(() => callback?.({ credential })),
    click: (index = -1) =>
      act(() => {
        const l = index < 0 ? clickListeners[clickListeners.length + index] : clickListeners[index];
        l?.();
      }),
    clickListeners: () => clickListeners.length,
  };
}

const okLogin = () =>
  vi
    .spyOn(api, 'loginWithGoogle')
    .mockResolvedValue({ user: { role: 'customer' } } as Awaited<ReturnType<typeof api.loginWithGoogle>>);

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

  it('D-2/B-5: dibuja el botón oficial (renderButton) y NO llama a prompt() ni con el clic', async () => {
    const gis = installFakeGis();
    renderWithProviders(<GoogleSignInButton onSuccess={() => {}} />, 'es');

    await waitFor(() => expect(gis.renderButton).toHaveBeenCalled());
    // El contenedor recibe el botón de Google...
    const parent = gis.renderButton.mock.calls[0][0] as HTMLElement;
    expect(parent).toBe(screen.getByTestId('google-gsi-button'));
    expect(parent.querySelector('button')).not.toBeNull();

    // ...y el componente no toca One Tap. El doble SÍ define `prompt` (antes esta prueba
    // asertaba `prompt === undefined` sobre un fake que nunca lo definía: comprobaba su
    // propio fixture y no podía ponerse roja jamás).
    gis.click();
    expect(gis.prompt).not.toHaveBeenCalled();
    // Tampoco se pasan moment listeners: `initialize` recibe solo client_id + callback.
    expect(Object.keys(gis.initialize.mock.calls[0][0]).sort()).toEqual(['callback', 'client_id']);
  });

  it('D-1a: clic con la librería presente → se invoca el camino real y llega el ID token de Google al backend', async () => {
    const spy = okLogin();
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
    okLogin();
    const gis = installFakeGis();
    const first = vi.fn();
    const second = vi.fn();
    renderWithProviders(
      <>
        <GoogleSignInButton onSuccess={first} />
        <GoogleSignInButton onSuccess={second} />
      </>,
      'es',
    );
    await waitFor(() => expect(gis.renderButton).toHaveBeenCalledTimes(2));

    gis.click(1); // pica la SEGUNDA instancia
    gis.emit('tok');

    await waitFor(() => expect(second).toHaveBeenCalled());
    expect(first).not.toHaveBeenCalled();
  });

  /*
   * B-1 (bloqueante de QA). Escenario real: el usuario pica Google en el panel del
   * checkout, el panel se cierra y Google contesta después. La credencial se entregaba a
   * la instancia MUERTA (login silencioso que no hace nada) porque la limpieza del
   * desmontaje comparaba dos referencias que nunca eran la misma.
   *
   * Mutación que esta prueba tiene que matar: `if (activeInstance === self)` → `if (false)`.
   */
  it('B-1: clic → desmontaje → otra instancia monta → la credencial la recibe la instancia VIVA, no la muerta', async () => {
    const spy = okLogin();
    const gis = installFakeGis();
    const dead = vi.fn();
    const alive = vi.fn();

    const firstMount = renderWithProviders(<GoogleSignInButton onSuccess={dead} />, 'es');
    await waitFor(() => expect(gis.renderButton).toHaveBeenCalledTimes(1));
    gis.click(0); // la instancia que se va a desmontar es la que originó el flujo
    firstMount.unmount();

    renderWithProviders(<GoogleSignInButton onSuccess={alive} />, 'es');
    await waitFor(() => expect(gis.renderButton).toHaveBeenCalledTimes(2));

    // Google contesta tarde, con el panel ya cerrado.
    gis.emit('late.google.id.token');

    await waitFor(() => expect(alive).toHaveBeenCalledWith('customer'));
    expect(dead).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  /*
   * B-2 (bloqueante de QA). `sdk === 'ready'` pero GIS no dibuja nada (origen JavaScript no
   * autorizado en la consola de Google, o CSP): antes quedaban CERO botones, un contenedor
   * vacío de 48px y ningún mensaje. El vigilante de 6 s no podía ayudar: no había qué picar.
   */
  it('B-2: GIS carga pero no dibuja → queda un botón pulsable y un mensaje, nunca cero', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const spy = vi.spyOn(api, 'loginWithGoogle');
    const gis = installFakeGis({ draw: 'nothing' });
    renderWithProviders(<GoogleSignInButton onSuccess={() => {}} />, 'es');

    await waitFor(() => expect(gis.renderButton).toHaveBeenCalled());
    expect(screen.getByTestId('google-gsi-button').childElementCount).toBe(0);

    await act(async () => {
      vi.advanceTimersByTime(1_500);
    });

    // Hay algo pulsable...
    const fallback = screen.getByRole('button', { name: /Continuar con Google/ });
    expect(fallback).toBeEnabled();
    // ...y el mensaje dice la verdad, sin canjear ningún token inventado.
    fireEvent.click(fallback);
    expect(await screen.findByRole('alert')).toHaveTextContent(/no pudo dibujar su botón/i);
    expect(spy).not.toHaveBeenCalled();
    // El hueco vacío se retira del DOM: `hidden` no lo escondía (Tailwind: `.flex` gana).
    expect(screen.queryByTestId('google-gsi-button')).toBeNull();
  });

  /*
   * B-3 (importante). GIS LANZA ante un origen no autorizado. Sin `try/catch`, el throw
   * sale en fase de commit y —no hay ningún error boundary en `frontend/src/`— deja la
   * página de login EN BLANCO. Mutación a matar: quitar el try/catch de `renderButton`.
   */
  it('B-3: si renderButton LANZA, la pantalla sobrevive con botón de respaldo y mensaje', async () => {
    const gis = installFakeGis({ draw: 'throw' });
    renderWithProviders(<GoogleSignInButton onSuccess={() => {}} />, 'es');

    await waitFor(() => expect(gis.renderButton).toHaveBeenCalled());

    const fallback = await screen.findByRole('button', { name: /Continuar con Google/ });
    expect(fallback).toBeEnabled();
    fireEvent.click(fallback);
    expect(await screen.findByRole('alert')).toHaveTextContent(/no pudo dibujar su botón/i);
  });

  /*
   * B-4 (menor). `ApiClientError` solo se lanza para respuestas HTTP; un `fetch` que rechaza
   * por red da `TypeError`. Decirle «no pudimos validar tu sesión de Google» a quien se quedó
   * sin conexión lo manda a diagnosticar la cosa equivocada.
   */
  it('B-4: un fallo de RED se reporta como problema de conexión, no como token inválido', async () => {
    vi.spyOn(api, 'loginWithGoogle').mockRejectedValue(new TypeError('Failed to fetch'));
    const gis = installFakeGis();
    renderWithProviders(<GoogleSignInButton onSuccess={() => {}} />, 'es');
    await waitFor(() => expect(gis.renderButton).toHaveBeenCalled());

    gis.click();
    gis.emit('tok');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/No pudimos conectar con el servidor/i);
    expect(screen.queryByText(/No pudimos validar tu sesión de Google/i)).toBeNull();
  });

  /*
   * B-6 (techlead). Credencial sin flujo activo: el despachador la repartía a TODAS las
   * instancias montadas ⇒ dos `POST /auth/google` en paralelo con el mismo idToken, dos
   * `persistSession` compitiendo y dos `onSuccess` navegando.
   */
  it('B-6: una credencial sin flujo activo produce UN canje, no uno por instancia montada', async () => {
    const spy = okLogin();
    const gis = installFakeGis();
    const first = vi.fn();
    const second = vi.fn();
    renderWithProviders(
      <>
        <GoogleSignInButton onSuccess={first} />
        <GoogleSignInButton onSuccess={second} />
      </>,
      'es',
    );
    await waitFor(() => expect(gis.renderButton).toHaveBeenCalledTimes(2));

    // Nadie picó: la credencial llega sola.
    gis.emit('tok');

    await waitFor(() => expect(second).toHaveBeenCalledTimes(1));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  /*
   * B-7 (menor, techlead). El clic de la segunda instancia no cancelaba el vigilante de la
   * primera: a los 6 s la primera afirmaba «tu navegador está bloqueando…», que es mentira.
   */
  it('B-7: el clic de una instancia apaga el vigilante de la otra (un solo aviso, y del que picó)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const gis = installFakeGis();
    renderWithProviders(
      <>
        <div data-testid="panel-a">
          <GoogleSignInButton onSuccess={() => {}} />
        </div>
        <div data-testid="panel-b">
          <GoogleSignInButton onSuccess={() => {}} />
        </div>
      </>,
      'es',
    );
    await waitFor(() => expect(gis.renderButton).toHaveBeenCalledTimes(2));

    gis.click(0); // arranca el vigilante de A
    gis.click(1); // B toma el flujo: el de A ya no puede afirmar nada
    await act(async () => {
      vi.advanceTimersByTime(6_000);
    });

    expect(await screen.findAllByRole('alert')).toHaveLength(1);
    expect(within(screen.getByTestId('panel-a')).queryByRole('alert')).toBeNull();
    expect(within(screen.getByTestId('panel-b')).getByRole('alert')).toHaveTextContent(
      /bloqueando el inicio de sesión con terceros/i,
    );
  });

  /*
   * B-8a (menor, techlead). La memoización ignoraba el `clientId`: con el id cambiado se
   * devolvía la promesa vieja y el singleton de GIS seguía inicializado con el id anterior.
   */
  it('B-8a: si cambia el client id, se vuelve a initialize() con el nuevo', async () => {
    const gis = installFakeGis();
    const firstMount = renderWithProviders(<GoogleSignInButton onSuccess={() => {}} />, 'es');
    await waitFor(() => expect(gis.initialize).toHaveBeenCalledTimes(1));
    expect(gis.initialize.mock.calls[0][0].client_id).toBe('test-client-id');
    firstMount.unmount();

    config.googleClientId = 'otro-client-id';
    renderWithProviders(<GoogleSignInButton onSuccess={() => {}} />, 'es');

    await waitFor(() => expect(gis.initialize).toHaveBeenCalledTimes(2));
    expect(gis.initialize.mock.calls[1][0].client_id).toBe('otro-client-id');
  });

  /*
   * B-8b (menor, techlead). En el reintento tras el timeout se volvían a enganchar
   * `load`/`error` sobre el MISMO <script> sin soltar los anteriores: los listeners se
   * acumulaban montaje tras montaje.
   */
  it('B-8b: el reintento tras el timeout no acumula listeners en el <script>', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const added: string[] = [];
    const removed: string[] = [];
    vi.spyOn(document.head, 'appendChild').mockImplementation(((node: Node) => {
      const el = Node.prototype.appendChild.call(document.head, node) as Node;
      const script = el as HTMLScriptElement;
      if (script.dataset?.gsiClient === 'true') {
        const add = script.addEventListener.bind(script);
        const remove = script.removeEventListener.bind(script);
        script.addEventListener = ((...args: Parameters<typeof add>) => {
          added.push(String(args[0]));
          return add(...args);
        }) as typeof script.addEventListener;
        script.removeEventListener = ((...args: Parameters<typeof remove>) => {
          removed.push(String(args[0]));
          return remove(...args);
        }) as typeof script.removeEventListener;
      }
      return el;
    }) as typeof document.head.appendChild);

    // Primer intento: se inyecta el script y la librería nunca llega.
    const firstMount = renderWithProviders(<GoogleSignInButton onSuccess={() => {}} />, 'es');
    expect(added).toEqual(['load', 'error']);
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(removed).toEqual(['load', 'error']);
    firstMount.unmount();

    // Reintento sobre el MISMO <script> (ya está en el head): se enganchan otra vez...
    renderWithProviders(<GoogleSignInButton onSuccess={() => {}} />, 'es');
    expect(added).toHaveLength(4);
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    // ...y se sueltan otra vez: nunca queda un listener colgado.
    expect(removed).toHaveLength(4);
    expect(document.querySelectorAll('script[data-gsi-client="true"]')).toHaveLength(1);
  });
});
