import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithIntl } from '@/test/render';
import { AuthForm } from './AuthForm';
import * as api from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import type { AuthResponse } from '@/types/contract';

/**
 * **Equipo sin correo en la MISMA pantalla de login** (`PROJECT §U`, criterios 258/259/262/264/270; HECHOS
 * 2026-10-04 (c); `API_CONTRACT §M6-U.10`; `DESIGN_SYSTEM §42.1`). Candados UX-1 (= STF-9), UX-2 (= STF-16),
 * UX-3 (= STF-22) y UX-4 (C-4, N-5).
 *
 * Regla que vigilan todas: lo que cambia en pantalla depende SOLO de la forma de lo tecleado (con o sin `@`)
 * y de `error.code`, ⛔ nunca de otro dato de la respuesta ⇒ no es oráculo de existencia (criterio 259).
 * ⛔ La rama `RATE_LIMITED` (HECHOS.md:40) la vigila `AuthForm.rateLimited.test.tsx`; aquí solo se re-asevera
 * que con un usuario tecleado sigue siendo la misma.
 */

const push = vi.fn();
const replace = vi.fn();
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push, replace }),
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
// Google se pinta como un marcador con nombre para poder medir el ORDEN de los enlaces/alternativas.
vi.mock('./GoogleSignInButton', () => ({
  GoogleSignInButton: () => (
    <button type="button" data-testid="google-alt">
      Google
    </button>
  ),
}));

beforeEach(() => {
  vi.restoreAllMocks();
  push.mockClear();
  replace.mockClear();
});

const TMPA = 'TOO_MANY_PASSWORD_ATTEMPTS';

function idField(): HTMLInputElement {
  return document.querySelector('input[name="email"]') as HTMLInputElement;
}

function typeAndSubmit(identifier: string) {
  fireEvent.change(idField(), { target: { value: identifier } });
  fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'pikachu-123' } });
  fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
}

/** Firma de las alternativas de la pantalla: enlaces (href + texto) y el botón de Google, en orden de DOM. */
function alternativesSignature(): string[] {
  const form = idField().closest('form') as HTMLFormElement;
  return Array.from(form.querySelectorAll('a, [data-testid="google-alt"]'))
    .filter((el) => !el.closest('[data-testid="auth-rate-limited"]'))
    .map((el) => (el.tagName === 'A' ? `a:${el.getAttribute('href')}:${el.textContent}` : 'google'));
}

describe('UX-1 = STF-9 · el campo de login acepta correo o usuario', () => {
  it('login: `type="text"`, `autoComplete="username"`, etiqueta «Correo o usuario», sin autocorrección', () => {
    renderWithIntl(<AuthForm mode="login" />, 'es');
    const input = screen.getByLabelText('Correo o usuario');
    expect(input).toBe(idField());
    expect(input).toHaveAttribute('type', 'text');
    expect(input).toHaveAttribute('autocomplete', 'username');
    expect(input).toHaveAttribute('inputmode', 'email');
    expect(input).toHaveAttribute('autocapitalize', 'none');
    expect(input).toHaveAttribute('autocorrect', 'off');
    expect(input).toHaveAttribute('spellcheck', 'false');
    // ⛔ La pantalla no anuncia usuarios: sin placeholder ni texto de ayuda.
    expect(input).not.toHaveAttribute('placeholder');
    expect(input).not.toHaveAttribute('aria-describedby');
  });

  it('en inglés la etiqueta es «Email or username»', () => {
    renderWithIntl(<AuthForm mode="login" />, 'en');
    expect(screen.getByLabelText('Email or username')).toHaveAttribute('type', 'text');
  });

  it('registro: el campo sigue siendo `type="email"` con etiqueta «Correo» (criterio 270)', () => {
    renderWithIntl(<AuthForm mode="register" />, 'es');
    const input = screen.getByLabelText('Correo');
    expect(input).toHaveAttribute('type', 'email');
    expect(input).toHaveAttribute('autocomplete', 'email');
    expect(screen.queryByLabelText('Correo o usuario')).not.toBeInTheDocument();
  });

  it('login con un usuario manda `{ email: "ana" }` (misma llave del contrato) y un staff va a /admin', async () => {
    const res: AuthResponse = {
      user: { id: 'u-op2', email: null, username: 'ana', name: 'Ana', role: 'vault_operator', locale: 'es', mustChangePassword: false },
      accessToken: 'a',
      refreshToken: 'r',
    };
    const login = vi.spyOn(api, 'login').mockResolvedValue(res);
    renderWithIntl(<AuthForm mode="login" />, 'es');
    typeAndSubmit('ana');
    await waitFor(() => expect(push).toHaveBeenCalledWith('/admin'));
    expect(login).toHaveBeenCalledWith({ email: 'ana', password: 'pikachu-123' });
  });
});

describe('UX-2 = STF-16 · los enlaces no dependen de lo tecleado', () => {
  it('con «ana» y con «a@b.com», antes y después de un 401: mismos enlaces, mismo orden, mismos href', async () => {
    vi.spyOn(api, 'login').mockRejectedValue(new ApiClientError(401, { code: 'INVALID_CREDENTIALS', message: 'bad' }));
    renderWithIntl(<AuthForm mode="login" />, 'es');
    const pristine = alternativesSignature();
    expect(pristine).toEqual([
      'a:/forgot-password:¿Olvidaste tu contraseña?',
      'google',
      // LIVE-8 · sitio 2b (DESIGN_SYSTEM §80.2): la leyenda de Google trae «Términos» (pestaña nueva). El
      // enlace al aviso no aparece aquí porque este render no tiene proveedor ⇒ texto sin enlace.
      'a:/terminos:Términos (se abre en otra pestaña)',
      'a:/register:¿No tienes cuenta? Regístrate',
    ]);

    fireEvent.change(idField(), { target: { value: 'ana' } });
    expect(alternativesSignature()).toEqual(pristine);
    fireEvent.change(idField(), { target: { value: 'a@b.com' } });
    expect(alternativesSignature()).toEqual(pristine);

    typeAndSubmit('ana');
    await screen.findByText('Usuario o contraseña incorrectos.');
    expect(alternativesSignature()).toEqual(pristine);

    typeAndSubmit('a@b.com');
    await screen.findByText('Correo o contraseña incorrectos.');
    expect(alternativesSignature()).toEqual(pristine);
  });
});

describe('UX-3 = STF-22 · candado por cuenta con un usuario tecleado', () => {
  it('`429 TOO_MANY_PASSWORD_ATTEMPTS` con «ana» y minutos ⇒ «pídele al administrador», cero enlaces a /forgot-password en el aviso', async () => {
    vi.spyOn(api, 'login').mockRejectedValue(new ApiClientError(429, { code: TMPA, message: 'x', details: { retryAfterSeconds: 600 } }));
    renderWithIntl(<AuthForm mode="login" />, 'es');
    typeAndSubmit('ana');

    const box = await screen.findByTestId('auth-rate-limited');
    expect(box).toHaveTextContent(
      'Demasiados intentos con este usuario. Vuelve a intentarlo en 10 minutos. Si no recuerdas tu contraseña, pídele al administrador que la restablezca.',
    );
    expect(box.querySelectorAll('a[href$="/forgot-password"]')).toHaveLength(0);
    expect(within(box).queryByRole('link')).not.toBeInTheDocument();
    expect(within(box).getByRole('alert')).toBeInTheDocument();
    expect(box).toHaveFocus();
    // El enlace general de la pantalla sigue ahí (UX-2): solo el del aviso desaparece.
    expect(screen.getByRole('link', { name: '¿Olvidaste tu contraseña?' })).toHaveAttribute('href', '/forgot-password');
  });

  it('`429 TOO_MANY_PASSWORD_ATTEMPTS` con «ana» sin cifra usable ⇒ «Espera unos minutos…», sin números ni enlace', async () => {
    vi.spyOn(api, 'login').mockRejectedValue(new ApiClientError(429, { code: TMPA, message: 'x' }));
    renderWithIntl(<AuthForm mode="login" />, 'es');
    typeAndSubmit('ana');

    const box = await screen.findByTestId('auth-rate-limited');
    expect(box).toHaveTextContent(
      'Demasiados intentos con este usuario. Espera unos minutos y vuelve a intentarlo. Si no recuerdas tu contraseña, pídele al administrador que la restablezca.',
    );
    expect(box.textContent).not.toMatch(/\d/);
    expect(box.querySelectorAll('a')).toHaveLength(0);
  });

  it('`429 TOO_MANY_PASSWORD_ATTEMPTS` con «a@b.com» ⇒ el aviso de hoy, CON enlace a restablecer', async () => {
    vi.spyOn(api, 'login').mockRejectedValue(new ApiClientError(429, { code: TMPA, message: 'x', details: { retryAfterSeconds: 90 } }));
    renderWithIntl(<AuthForm mode="login" />, 'es');
    typeAndSubmit('a@b.com');

    const box = await screen.findByTestId('auth-rate-limited');
    expect(box).toHaveTextContent('Demasiados intentos con este correo. Vuelve a intentarlo en 2 minutos, o restablece tu contraseña.');
    expect(box.querySelectorAll('a[href$="/forgot-password"]')).toHaveLength(1);
  });

  it.each(['ana', 'a@b.com'])('`429 RATE_LIMITED` con «%s» ⇒ el aviso por IP de hoy, idéntico en los dos', async (typed) => {
    vi.spyOn(api, 'login').mockRejectedValue(new ApiClientError(429, { code: 'RATE_LIMITED', message: 'x', details: { retryAfterSeconds: 600 } }));
    renderWithIntl(<AuthForm mode="login" />, 'es');
    typeAndSubmit(typed);

    const box = await screen.findByTestId('auth-rate-limited');
    expect(box).toHaveTextContent('Demasiados intentos seguidos. Vuelve a intentarlo en 10 minutos.');
    expect(box.textContent).not.toMatch(/usuario|administrador|correo/i);
    expect(box.querySelectorAll('a')).toHaveLength(0);
  });

  it('el texto se fija con el tecleo del submit: editar el campo después no cambia el aviso', async () => {
    vi.spyOn(api, 'login').mockRejectedValue(new ApiClientError(429, { code: TMPA, message: 'x' }));
    renderWithIntl(<AuthForm mode="login" />, 'es');
    typeAndSubmit('ana');
    const box = await screen.findByTestId('auth-rate-limited');
    fireEvent.change(idField(), { target: { value: 'ana@example.com' } });
    expect(box).toHaveTextContent('Demasiados intentos con este usuario.');
    expect(box.querySelectorAll('a')).toHaveLength(0);
  });
});

describe('UX-4 · credenciales incorrectas con un usuario tecleado (C-4, N-5)', () => {
  it('`401 INVALID_CREDENTIALS` con «ana» ⇒ «Usuario o contraseña incorrectos.»', async () => {
    vi.spyOn(api, 'login').mockRejectedValue(new ApiClientError(401, { code: 'INVALID_CREDENTIALS', message: 'bad' }));
    renderWithIntl(<AuthForm mode="login" />, 'es');
    typeAndSubmit('ana');
    expect(await screen.findByRole('alert')).toHaveTextContent('Usuario o contraseña incorrectos.');
    expect(screen.queryByText('Correo o contraseña incorrectos.')).not.toBeInTheDocument();
  });

  it('`401 INVALID_CREDENTIALS` con «a@b.com» ⇒ «Correo o contraseña incorrectos.» (como hoy)', async () => {
    vi.spyOn(api, 'login').mockRejectedValue(new ApiClientError(401, { code: 'INVALID_CREDENTIALS', message: 'bad' }));
    renderWithIntl(<AuthForm mode="login" />, 'es');
    typeAndSubmit('a@b.com');
    expect(await screen.findByRole('alert')).toHaveTextContent('Correo o contraseña incorrectos.');
  });

  it('el texto se toma del submit que produjo el error, no del campo vivo', async () => {
    vi.spyOn(api, 'login').mockRejectedValue(new ApiClientError(401, { code: 'INVALID_CREDENTIALS', message: 'bad' }));
    renderWithIntl(<AuthForm mode="login" />, 'es');
    typeAndSubmit('ana');
    const alert = await screen.findByRole('alert');
    fireEvent.change(idField(), { target: { value: 'ana@example.com' } });
    expect(alert).toHaveTextContent('Usuario o contraseña incorrectos.');
  });

  it('otro código con «ana» (`USER_BLOCKED`) ⇒ su texto de siempre, sin «Usuario o contraseña»', async () => {
    vi.spyOn(api, 'login').mockRejectedValue(new ApiClientError(403, { code: 'USER_BLOCKED', message: 'blocked' }));
    renderWithIntl(<AuthForm mode="login" />, 'es');
    typeAndSubmit('ana');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).not.toMatch(/Usuario o contraseña/);
  });

  it('la respuesta no decide nada: el mismo 401 con detalles distintos pinta lo mismo (cero oráculo)', async () => {
    const login = vi
      .spyOn(api, 'login')
      .mockRejectedValueOnce(new ApiClientError(401, { code: 'INVALID_CREDENTIALS', message: 'bad' }))
      .mockRejectedValueOnce(new ApiClientError(401, { code: 'INVALID_CREDENTIALS', message: 'other', details: { exists: true } }));
    renderWithIntl(<AuthForm mode="login" />, 'es');
    typeAndSubmit('ana');
    const first = (await screen.findByRole('alert')).outerHTML;
    typeAndSubmit('ana');
    await waitFor(() => expect(login).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole('alert').outerHTML).toBe(first));
  });
});
