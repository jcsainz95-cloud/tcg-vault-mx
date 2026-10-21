// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://www.tcghunt.mx/es/catalog"}
/**
 * (https: jsdom, como el navegador, no guarda una cookie `Secure` en un origen http no local.)
 *
 * DESIGN_SYSTEM MKT2-UX.15 — candados de unidad del banner y la segunda capa (lo que jsdom puede
 * medir). Las alturas, el «no tapa COMPRAR» y el zoom (C-F11, C-F12, C-F19) y la red real (C-F3,
 * C-F5) los mide Playwright en `e2e/measurement-on.spec.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithIntl } from '@/test/render';
import { PrivacyLinkProvider } from '@/components/legal/PrivacyNoticeLink';
import { MeasurementProvider } from './MeasurementProvider';
import { ConsentBannerSlot } from './ConsentBanner';
import { CookiePreferencesLink } from './CookiePreferencesLink';
import { setRuntimeConsent } from '@/lib/measurement/track';

let mockPath = '/es/catalog';
vi.mock('next/navigation', async (orig) => ({
  ...(await orig<typeof import('next/navigation')>()),
  usePathname: () => mockPath,
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

let fetchSpy: ReturnType<typeof vi.spyOn>;

function clearCookies() {
  for (const c of document.cookie.split(';')) {
    const name = c.split('=')[0]?.trim();
    if (!name) continue;
    document.cookie = `${name}=; Max-Age=0; Path=/`;
    document.cookie = `${name}=; Max-Age=0; Path=/; Domain=tcghunt.mx`;
  }
}

function consentCookie(): Record<string, unknown> | null {
  const raw = document.cookie
    .split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith('th_consent='));
  return raw ? JSON.parse(decodeURIComponent(raw.slice('th_consent='.length))) : null;
}

function bannerCalls(): unknown[] {
  const calls = fetchSpy.mock.calls as unknown as Array<[unknown, RequestInit | undefined]>;
  return calls
    .filter(([url]) => String(url).includes('/measurement/banner-response'))
    .map(([, init]) => JSON.parse(String(init?.body)));
}

function setup() {
  return renderWithIntl(
    <PrivacyLinkProvider linked>
      <MeasurementProvider>
        <a href="#main" data-testid="skip">
          skip
        </a>
        <ConsentBannerSlot />
        <main id="main">contenido</main>
        <footer>
          <CookiePreferencesLink variant="nav" />
        </footer>
      </MeasurementProvider>
    </PrivacyLinkProvider>,
  );
}

beforeEach(() => {
  mockPath = '/es/catalog';
  window.history.replaceState(null, '', '/es/catalog');
  clearCookies();
  vi.stubEnv('NEXT_PUBLIC_MEASUREMENT_MODE', 'on');
  vi.stubEnv('NEXT_PUBLIC_GA4_MEASUREMENT_ID', 'G-TEST1234');
  vi.stubEnv('NEXT_PUBLIC_META_PIXEL_ID', '1234567890123');
  vi.stubEnv('NEXT_PUBLIC_MEASUREMENT_E2E_NOTICE_VERSION', 'e2e-1');
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
  window.sessionStorage.clear();
  // Next 15 publica `window.next.router` al cargar el módulo del router; aquí se simula (D4: sin él, no hay etiquetas).
  (window as unknown as { next?: unknown }).next = { router: { push: vi.fn(), replace: vi.fn() } };
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  clearCookies();
  setRuntimeConsent(null);
  const w = window as unknown as Record<string, unknown>;
  delete w.gtag;
  delete w.fbq;
  delete w._fbq;
  delete w.dataLayer;
  delete w.next;
  document.querySelectorAll('script[data-th-measurement]').forEach((s) => s.remove());
});

describe('CK-1 / C-F14 · con off o sin etiqueta válida no existe nada', () => {
  it('off: ni banner, ni enlace, ni cookie, ni banner-response', async () => {
    vi.stubEnv('NEXT_PUBLIC_MEASUREMENT_MODE', 'off');
    setup();
    await act(async () => {});
    expect(screen.queryByTestId('consent-banner')).toBeNull();
    expect(screen.queryByTestId('cookie-preferences-nav')).toBeNull();
    expect(document.cookie).not.toContain('th_consent');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('on sin ningún ID válido: ni banner ni enlace', async () => {
    vi.stubEnv('NEXT_PUBLIC_GA4_MEASUREMENT_ID', 'UA-123');
    vi.stubEnv('NEXT_PUBLIC_META_PIXEL_ID', 'x');
    setup();
    await act(async () => {});
    expect(screen.queryByTestId('consent-banner')).toBeNull();
    expect(screen.queryByTestId('cookie-preferences-nav')).toBeNull();
  });

  it('on sin aviso que declare la medición (ni versión de E2E): inactivo', async () => {
    vi.stubEnv('NEXT_PUBLIC_MEASUREMENT_E2E_NOTICE_VERSION', '');
    setup();
    await act(async () => {});
    expect(screen.queryByTestId('consent-banner')).toBeNull();
  });

  it('on en ruta fuera de la lista blanca: sin banner, pero el enlace del pie sí', async () => {
    mockPath = '/es/account';
    setup();
    await act(async () => {});
    expect(screen.queryByTestId('consent-banner')).toBeNull();
    expect(screen.getByTestId('cookie-preferences-nav')).toBeInTheDocument();
  });
});

describe('C-F8 · banner accesible y sin muro', () => {
  it('role=region con nombre, sin dialog ni aria-modal, no roba el foco', async () => {
    setup();
    const banner = await screen.findByRole('region', { name: 'Aviso de cookies' });
    expect(banner.getAttribute('aria-modal')).toBeNull();
    expect(banner.closest('[role="dialog"]')).toBeNull();
    expect(banner.contains(document.activeElement)).toBe(false);
    expect(document.body.style.overflow).not.toBe('hidden');
  });

  it('orden de Tab tras el skip-link: aviso → Aceptar → Solo lo necesario → Configurar', async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByTestId('consent-banner');
    screen.getByTestId('skip').focus();
    await user.tab();
    expect(document.activeElement).toHaveAccessibleName(/Aviso de privacidad/);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Aceptar' }));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Solo lo necesario' }));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Configurar' }));
  });

  it('Esc no es una respuesta: ni cookie ni banner-response, y el banner sigue', async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByTestId('consent-banner');
    screen.getByRole('button', { name: 'Aceptar' }).focus();
    await user.keyboard('{Escape}');
    expect(consentCookie()).toBeNull();
    expect(bannerCalls()).toEqual([]);
    expect(screen.getByTestId('consent-banner')).toBeInTheDocument();
  });
});

describe('C-F9 · sin patrones oscuros', () => {
  it('Aceptar y Solo lo necesario son <button> reales en la primera capa, misma letra', async () => {
    setup();
    const banner = await screen.findByTestId('consent-banner');
    const accept = within(banner).getByRole('button', { name: 'Aceptar' });
    const necessary = within(banner).getByRole('button', { name: 'Solo lo necesario' });
    expect(accept.tagName).toBe('BUTTON');
    expect(necessary.tagName).toBe('BUTTON');
    expect(accept.className).toContain('text-[13px]');
    expect(necessary.className).toContain('text-[13px]');
    expect(necessary.className).toContain('h-11');
    expect(accept.className).toContain('min-h-[48px]');
  });

  it('en la segunda capa los dos interruptores nacen apagados', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(await screen.findByRole('button', { name: 'Configurar' }));
    const dialog = screen.getByRole('dialog', { name: 'Preferencias de cookies' });
    const switches = within(dialog).getAllByRole('switch');
    expect(switches).toHaveLength(2);
    for (const s of switches) expect(s).toHaveAttribute('aria-checked', 'false');
    expect(within(dialog).queryByRole('button', { name: 'Aceptar' })).toBeNull();
  });
});

describe('C-F18 · tras responder: foco a #main y anuncio', () => {
  it.each([
    ['Aceptar', { v: 1, a: 1, m: 1 }, 'accept'],
    ['Solo lo necesario', { v: 1, a: 0, m: 0 }, 'necessary_only'],
  ])('%s ⇒ th_consent, banner-response, sin banner, foco en #main, «Tu elección se guardó.»', async (label, cookie, response) => {
    const user = userEvent.setup();
    setup();
    await user.click(await screen.findByRole('button', { name: label }));
    await waitFor(() => expect(screen.queryByTestId('consent-banner')).toBeNull());
    expect(consentCookie()).toMatchObject({ ...cookie, n: 'e2e-1' });
    expect(bannerCalls()).toEqual([{ response }]);
    await waitFor(() => expect(document.activeElement).toBe(document.getElementById('main')));
    await waitFor(() => expect(screen.getByTestId('consent-status')).toHaveTextContent('Tu elección se guardó.'));
  });

  it('«Solo lo necesario» no carga etiquetas', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(await screen.findByRole('button', { name: 'Solo lo necesario' }));
    await act(async () => {});
    expect(document.querySelector('script[data-th-measurement]')).toBeNull();
    expect((window as unknown as { gtag?: unknown }).gtag).toBeUndefined();
  });
});

describe('C-F13 · segunda capa', () => {
  it('Esc y Cancelar cierran SIN cookie ni banner-response y el foco vuelve a Configurar', async () => {
    const user = userEvent.setup();
    setup();
    const customize = await screen.findByRole('button', { name: 'Configurar' });
    await user.click(customize);
    await user.click(within(screen.getByRole('dialog')).getAllByRole('switch')[0]);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(customize));
    await user.click(customize);
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(consentCookie()).toBeNull();
    expect(bannerCalls()).toEqual([]);
    expect(screen.getByTestId('consent-banner')).toBeInTheDocument();
  });

  it('el foco queda atrapado en el diálogo', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(await screen.findByRole('button', { name: 'Configurar' }));
    const dialog = screen.getByRole('dialog');
    for (let i = 0; i < 8; i++) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  it('Guardar con solo Analítica ⇒ th_consent {a:1,m:0} y banner-response custom', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(await screen.findByRole('button', { name: 'Configurar' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('switch', { name: 'Analítica' }));
    expect(within(dialog).getByRole('switch', { name: 'Analítica' })).toHaveAttribute('aria-checked', 'true');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar mi elección' }));
    expect(consentCookie()).toMatchObject({ a: 1, m: 0 });
    expect(bannerCalls()).toEqual([{ response: 'custom' }]);
    await waitFor(() => expect(document.querySelector('script[data-th-measurement="ga4"]')).not.toBeNull());
    expect(document.querySelector('script[data-th-measurement="meta"]')).toBeNull();
  });

  it('desde el enlace del pie, Guardar NO llama a banner-response y abre con lo guardado', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(await screen.findByRole('button', { name: 'Aceptar' }));
    fetchSpy.mockClear();
    await user.click(screen.getByTestId('cookie-preferences-nav'));
    const dialog = screen.getByRole('dialog');
    for (const s of within(dialog).getAllByRole('switch')) expect(s).toHaveAttribute('aria-checked', 'true');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar mi elección' }));
    expect(bannerCalls()).toEqual([]);
  });

  // QA M2 (2026-10-19, sobre a1ba4d2e): la PRIMERA elección cuenta venga de donde venga si el banner seguía visible.
  it('primera elección desde el pie con el banner visible ⇒ cuenta UNA vez (por resultado) y ya no hay no_response', async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByTestId('consent-banner');
    await user.click(screen.getByTestId('cookie-preferences-nav'));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('switch', { name: 'Analítica' }));
    await user.click(within(dialog).getByRole('button', { name: 'Guardar mi elección' }));
    expect(bannerCalls()).toEqual([{ response: 'custom' }]);
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    expect(bannerCalls()).toEqual([{ response: 'custom' }]);
  });

  it('primera elección desde el pie en una ruta SIN banner (fuera de la lista blanca) ⇒ no se manda nada', async () => {
    mockPath = '/es/account';
    window.history.replaceState(null, '', '/es/account');
    const user = userEvent.setup();
    setup();
    await user.click(await screen.findByTestId('cookie-preferences-nav'));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Guardar mi elección' }));
    expect(bannerCalls()).toEqual([]);
  });
});

describe('C-F14 · enlace persistente', () => {
  it('con on y elección guardada existe y abre la capa con lo guardado', async () => {
    document.cookie = `th_consent=${encodeURIComponent(JSON.stringify({ v: 1, a: 1, m: 0, n: 'e2e-1', d: '2026-10-19' }))}; Path=/`;
    const user = userEvent.setup();
    setup();
    await act(async () => {});
    expect(screen.queryByTestId('consent-banner')).toBeNull();
    await user.click(screen.getByTestId('cookie-preferences-nav'));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('switch', { name: 'Analítica' })).toHaveAttribute('aria-checked', 'true');
    expect(within(dialog).getByRole('switch', { name: 'Publicidad' })).toHaveAttribute('aria-checked', 'false');
  });

  it('cookie de OTRA versión del aviso ⇒ se vuelve a preguntar', async () => {
    document.cookie = `th_consent=${encodeURIComponent(JSON.stringify({ v: 1, a: 1, m: 1, n: 'vieja', d: '2026-10-19' }))}; Path=/`;
    setup();
    expect(await screen.findByTestId('consent-banner')).toBeInTheDocument();
  });
});

describe('§MKT.H.3 no_response (v1.105: una vez por DOCUMENTO, marca solo en memoria)', () => {
  it('se manda UNA vez al ocultarse si el banner se vio y no se respondió, sin escribir en storage', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    setup();
    await screen.findByTestId('consent-banner');
    const hide = () => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    };
    hide();
    hide();
    expect(bannerCalls()).toEqual([{ response: 'no_response' }]);
    // Antes de elegir no se escribe nada en el dispositivo (MKT.H.13, cierra FE-MKT2-1).
    expect(setItem).not.toHaveBeenCalled();
    expect(window.sessionStorage.length).toBe(0);
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  });
});

describe('§MKT.H.13 · la respuesta del banner es la del RESULTADO (también desde la 2.ª capa)', () => {
  async function saveFromLayer(toggle: string[]) {
    const user = userEvent.setup();
    setup();
    await user.click(await screen.findByRole('button', { name: 'Configurar' }));
    const dialog = screen.getByRole('dialog');
    for (const name of toggle) await user.click(within(dialog).getByRole('switch', { name }));
    await user.click(within(dialog).getByRole('button', { name: 'Guardar mi elección' }));
  }

  it('Guardar con los dos apagados ⇒ necessary_only', async () => {
    await saveFromLayer([]);
    expect(consentCookie()).toMatchObject({ a: 0, m: 0 });
    expect(bannerCalls()).toEqual([{ response: 'necessary_only' }]);
  });

  it('Guardar con los dos encendidos ⇒ accept', async () => {
    await saveFromLayer(['Analítica', 'Publicidad']);
    expect(consentCookie()).toMatchObject({ a: 1, m: 1 });
    expect(bannerCalls()).toEqual([{ response: 'accept' }]);
  });

  it('Guardar con solo Publicidad ⇒ custom', async () => {
    await saveFromLayer(['Publicidad']);
    expect(bannerCalls()).toEqual([{ response: 'custom' }]);
  });
});

/** TL D4 (2026-10-19): el parche del router (C-F5 2/3) es la LLAVE del cargador — falla en cerrado. */
describe('D4 · sin parche del router no se cargan las etiquetas', () => {
  async function acceptAll() {
    const user = userEvent.setup();
    setup();
    await user.click(await screen.findByRole('button', { name: 'Aceptar' }));
    expect(consentCookie()).toMatchObject({ a: 1, m: 1 });
  }
  const scripts = () => document.querySelectorAll('script[data-th-measurement]').length;
  const settle = () => act(() => new Promise((r) => setTimeout(r, 50)));

  it('control: con window.next.router, Aceptar carga Google y Meta', async () => {
    await acceptAll();
    await waitFor(() => expect(scripts()).toBe(2));
  });

  it('sin window.next.router: Aceptar guarda la elección pero no carga nada', async () => {
    delete (window as unknown as { next?: unknown }).next;
    await acceptAll();
    await settle();
    expect(scripts()).toBe(0);
    expect((window as unknown as { gtag?: unknown }).gtag).toBeUndefined();
    expect((window as unknown as { fbq?: unknown }).fbq).toBeUndefined();
  });

  it('router congelado (el parche no se puede escribir): no carga nada y no rompe la página', async () => {
    (window as unknown as { next?: unknown }).next = { router: Object.freeze({ push: vi.fn(), replace: vi.fn() }) };
    await acceptAll();
    await settle();
    expect(scripts()).toBe(0);
    expect(screen.getByText('contenido')).toBeInTheDocument();
  });
});
