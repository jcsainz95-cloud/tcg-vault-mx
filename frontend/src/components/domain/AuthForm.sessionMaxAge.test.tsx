import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithIntl } from '@/test/render';
import { AuthForm } from './AuthForm';
import LoginPage from '@/app/[locale]/(auth)/login/page';
import { ApiClientError } from '@/lib/api-client';
import { markSessionMaxAgeLogout, resetSessionMaxAgeLogoutForTests, consumeSessionMaxAgeLogout } from '@/lib/session';
import es from '../../../messages/es.json';
import en from '../../../messages/en.json';

/**
 * LIVE-2 pantalla — DESIGN_SYSTEM v4.16 §81 (F-1, F-2, F-3 lado login, F-4) y candados UX-SMA-1…6.
 * Contrato v1.84 §14.2 «Frontend» + v1.84.2 §14.15 E2-4.
 *
 * El mecanismo (FRONTEND_NOTES §103): el interceptor deja una marca de un solo uso al ver el `401`
 * del refresh con `reason:'session_max_age'`; los guards de hoy (`PrivateRouteGuard`, `AdminShell`)
 * redirigen como siempre a `/login?next=<ruta>`, y es el LOGIN quien consume la marca y reescribe su
 * URL a `?next=<ruta>&reason=session_max_age` (estado en el URL, como inactividad, §81.2.5).
 */

const push = vi.fn();
const replace = vi.fn();
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push, replace }),
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

const login = vi.fn();
const register = vi.fn();
const loginWithGoogle = vi.fn();
vi.mock('@/lib/api', () => ({
  login: (...a: unknown[]) => login(...a),
  register: (...a: unknown[]) => register(...a),
  loginWithGoogle: (...a: unknown[]) => loginWithGoogle(...a),
}));

// UX-SMA-5: `warning` y `danger` comparten clases en `Banner` (dirección 5a), así que la variante solo
// se ve en las props. Se envuelve el Banner REAL y se registran sus props.
const bannerProps: Array<{ variant?: string; role?: string; text: string }> = [];
vi.mock('@/components/ui/Banner', async () => {
  const actual = await vi.importActual<typeof import('@/components/ui/Banner')>('@/components/ui/Banner');
  const { renderToStaticMarkup } = await vi.importActual<typeof import('react-dom/server')>('react-dom/server');
  return {
    Banner: (p: Parameters<typeof actual.Banner>[0]) => {
      bannerProps.push({ variant: p.variant, role: p.role, text: renderToStaticMarkup(<>{p.children}</>) });
      return actual.Banner(p);
    },
  };
});

const ES = 'Tu sesión caducó por seguridad. Vuelve a entrar.';
const EN = 'Your session expired for security reasons. Log in again.';

function submitLogin(container: HTMLElement) {
  const email = container.querySelector('input[name="email"]') as HTMLInputElement;
  const password = container.querySelector('input[name="password"]') as HTMLInputElement;
  fireEvent.change(email, { target: { value: 'a@b.com' } });
  fireEvent.change(password, { target: { value: 'secret123' } });
  fireEvent.submit(email.closest('form') as HTMLFormElement);
}

beforeEach(() => {
  push.mockClear();
  replace.mockClear();
  login.mockReset();
  loginWithGoogle.mockReset();
  resetSessionMaxAgeLogoutForTests();
});

describe('UX-SMA-6 · textos ES/EN exactos (§81.3)', () => {
  it('la clave existe en los dos idiomas con el texto fijado', () => {
    expect((es as { auth: Record<string, unknown> }).auth.sessionMaxAgeLogout).toBe(ES);
    expect((en as { auth: Record<string, unknown> }).auth.sessionMaxAgeLogout).toBe(EN);
  });
});

describe('UX-SMA-1 · /login?reason=session_max_age pinta el aviso', () => {
  it('la página pasa notice="sessionMaxAge" con ese reason y conserva next', async () => {
    const el = await LoginPage({ searchParams: Promise.resolve({ reason: 'session_max_age', next: '/vault' }) });
    expect(el.props.notice).toBe('sessionMaxAge');
    expect(el.props.next).toBe('/vault');
  });

  it('inactivity sigue igual; sin reason u otro valor ⇒ sin aviso', async () => {
    expect((await LoginPage({ searchParams: Promise.resolve({ reason: 'inactivity' }) })).props.notice).toBe('inactivity');
    expect((await LoginPage({ searchParams: Promise.resolve({}) })).props.notice).toBeUndefined();
    expect((await LoginPage({ searchParams: Promise.resolve({ reason: 'otra' }) })).props.notice).toBeUndefined();
  });

  it('AuthForm pinta role="status" con el texto exacto (ES y EN)', () => {
    const { unmount } = renderWithIntl(<AuthForm mode="login" notice="sessionMaxAge" />, 'es');
    expect(screen.getByText(ES).closest('[role]')?.getAttribute('role')).toBe('status');
    unmount();
    renderWithIntl(<AuthForm mode="login" notice="sessionMaxAge" />, 'en');
    expect(screen.getByText(EN).closest('[role]')?.getAttribute('role')).toBe('status');
  });

  it('UX-SMA-5 · Banner warning + role status; nunca danger ni alert', () => {
    bannerProps.length = 0;
    renderWithIntl(<AuthForm mode="login" notice="sessionMaxAge" />, 'es');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText(ES).closest('[role]')?.getAttribute('role')).toBe('status');
    const mine = bannerProps.filter((b) => b.text.includes(ES));
    expect(mine.length).toBeGreaterThan(0);
    for (const b of mine) expect(b).toMatchObject({ variant: 'warning', role: 'status' });
  });

  it('el registro no lo pinta aunque le llegue el aviso (§81.1 «Solo en»)', () => {
    renderWithIntl(<AuthForm mode="register" notice="sessionMaxAge" />, 'es');
    expect(screen.queryByText(ES)).not.toBeInTheDocument();
  });
});

describe('UX-SMA-4 · desaparece al primer intento (§81.2.4)', () => {
  it('al enviar el formulario se va, y no vuelve aunque el intento falle', async () => {
    login.mockRejectedValue(new ApiClientError(401, { code: 'INVALID_CREDENTIALS', message: 'x' }));
    const { container } = renderWithIntl(<AuthForm mode="login" notice="sessionMaxAge" />, 'es');
    expect(screen.getByText(ES)).toBeInTheDocument();
    submitLogin(container);
    expect(screen.queryByText(ES)).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.queryByText(ES)).not.toBeInTheDocument();
  });

  it('al pulsar «Continuar con Google» se va', () => {
    loginWithGoogle.mockReturnValue(new Promise(() => {}));
    renderWithIntl(<AuthForm mode="login" notice="sessionMaxAge" />, 'es');
    expect(screen.getByText(ES)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: es.auth.google.cta }));
    expect(screen.queryByText(ES)).not.toBeInTheDocument();
  });

  it('§81.2.7 (recomendado): el de inactividad también se va al enviar', () => {
    login.mockReturnValue(new Promise(() => {}));
    const { container } = renderWithIntl(<AuthForm mode="login" notice="inactivity" />, 'es');
    expect(screen.getByText(es.auth.inactivityLogout)).toBeInTheDocument();
    submitLogin(container);
    expect(screen.queryByText(es.auth.inactivityLogout)).not.toBeInTheDocument();
  });
});

describe('UX-SMA-2/3 · lado login: la marca del interceptor termina en ?reason=session_max_age', () => {
  it('tienda: marca + next=/account ⇒ replace conservando next y aviso visible', async () => {
    markSessionMaxAgeLogout();
    renderWithIntl(<AuthForm mode="login" next="/account" />, 'es');
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith({ pathname: '/login', query: { next: '/account', reason: 'session_max_age' } }),
    );
    expect(screen.getByText(ES).closest('[role]')?.getAttribute('role')).toBe('status');
    // Consumida: otra visita al login no la hereda.
    expect(consumeSessionMaxAgeLogout()).toBe(false);
  });

  it('panel: marca + next=/admin ⇒ igual', async () => {
    markSessionMaxAgeLogout();
    renderWithIntl(<AuthForm mode="login" next="/admin" />, 'es');
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith({ pathname: '/login', query: { next: '/admin', reason: 'session_max_age' } }),
    );
  });

  it('marca sin next ⇒ solo reason', async () => {
    markSessionMaxAgeLogout();
    renderWithIntl(<AuthForm mode="login" />, 'es');
    await waitFor(() => expect(replace).toHaveBeenCalledWith({ pathname: '/login', query: { reason: 'session_max_age' } }));
  });

  it('UX-SMA-3 · sin marca ⇒ ni replace ni aviso (el login de hoy)', async () => {
    renderWithIntl(<AuthForm mode="login" next="/account" />, 'es');
    await new Promise((r) => setTimeout(r, 0));
    expect(replace).not.toHaveBeenCalled();
    expect(screen.queryByText(ES)).not.toBeInTheDocument();
  });

  it('el registro no consume la marca', async () => {
    markSessionMaxAgeLogout();
    renderWithIntl(<AuthForm mode="register" />, 'es');
    await new Promise((r) => setTimeout(r, 0));
    expect(replace).not.toHaveBeenCalled();
    expect(consumeSessionMaxAgeLogout()).toBe(true);
  });
});
