import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithIntl } from '@/test/render';
import { AuthForm } from './AuthForm';
import * as api from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';

/**
 * **El 429 del login** (`C7`, `DESIGN_SYSTEM §37.13` v4.9.1, errata de contrato v1.80.8.1). El aviso se elige por
 * `error.code`, ⛔ nunca por el status solo: `TOO_MANY_PASSWORD_ATTEMPTS` (por correo, solo login) ⇒ «…con este
 * correo…» + enlace real a restablecer; `RATE_LIMITED` (por IP) o cualquier otro 429 ⇒ «Demasiados intentos
 * seguidos…», ⛔ sin enlace y ⛔ sin «correo». Candado `PS-UI-13`: sin cifra usable el banner ⛔ no contiene
 * ningún número; con `details.retryAfterSeconds: 600` dice «10 minutos». El botón no se apaga.
 */

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('./GoogleSignInButton', () => ({ GoogleSignInButton: () => null }));

beforeEach(() => {
  vi.restoreAllMocks();
});

function submit() {
  fireEvent.change(screen.getByLabelText('Correo o usuario'), { target: { value: 'ash@example.com' } });
  fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'pikachu-123' } });
  fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
}

const TMPA = 'TOO_MANY_PASSWORD_ATTEMPTS';

describe('PS-UI-13 · login 429', () => {
  it('`TOO_MANY_PASSWORD_ATTEMPTS` sin cifra: «Espera unos minutos», sin números, con enlace real a restablecer y el botón encendido', async () => {
    vi.spyOn(api, 'login').mockRejectedValue(new ApiClientError(429, { code: TMPA, message: 'too many' }));
    renderWithIntl(<AuthForm mode="login" />, 'es');
    submit();

    const banner = await screen.findByTestId('auth-rate-limited');
    expect(banner).toHaveTextContent('Demasiados intentos con este correo. Espera unos minutos y vuelve a intentarlo, o restablece tu contraseña.');
    expect(banner.textContent).not.toMatch(/\d/);
    expect(banner).toHaveFocus();
    const link = screen.getByRole('link', { name: 'Restablecer contraseña' });
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('href', '/forgot-password');
    expect(screen.getByRole('button', { name: 'Entrar' })).toBeEnabled();
    // ⛔ No se pinta además el banner genérico de error.
    expect(screen.queryByText(/inesperado|INTERNAL/i)).not.toBeInTheDocument();
  });

  it('`TOO_MANY_PASSWORD_ATTEMPTS` con `details.retryAfterSeconds: 600` ⇒ «10 minutos»', async () => {
    vi.spyOn(api, 'login').mockRejectedValue(new ApiClientError(429, { code: TMPA, message: 'too many', details: { retryAfterSeconds: 600 } }));
    renderWithIntl(<AuthForm mode="login" />, 'es');
    submit();

    const banner = await screen.findByTestId('auth-rate-limited');
    expect(banner).toHaveTextContent('Demasiados intentos con este correo. Vuelve a intentarlo en 10 minutos, o restablece tu contraseña.');
  });

  it('`RATE_LIMITED` sin cifra: texto por IP, sin números, sin enlace, foco y botón encendido', async () => {
    vi.spyOn(api, 'login').mockRejectedValue(new ApiClientError(429, { code: 'RATE_LIMITED', message: 'too many' }));
    renderWithIntl(<AuthForm mode="login" />, 'es');
    submit();

    const banner = await screen.findByTestId('auth-rate-limited');
    expect(banner).toHaveTextContent('Demasiados intentos seguidos. Espera un momento y vuelve a intentarlo.');
    expect(banner.textContent).not.toMatch(/\d/);
    expect(banner).toHaveFocus();
    expect(screen.queryByRole('link', { name: 'Restablecer contraseña' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Entrar' })).toBeEnabled();
  });

  it('`RATE_LIMITED` con `details.retryAfterSeconds: 600` ⇒ «10 minutos», sin enlace', async () => {
    vi.spyOn(api, 'login').mockRejectedValue(new ApiClientError(429, { code: 'RATE_LIMITED', message: 'too many', details: { retryAfterSeconds: 600 } }));
    renderWithIntl(<AuthForm mode="login" />, 'es');
    submit();

    const banner = await screen.findByTestId('auth-rate-limited');
    expect(banner).toHaveTextContent('Demasiados intentos seguidos. Vuelve a intentarlo en 10 minutos.');
    expect(within(banner).queryByRole('link')).not.toBeInTheDocument();
  });

  it('registro: `RATE_LIMITED` ⇒ texto por IP, sin «correo» y sin restablecer', async () => {
    vi.spyOn(api, 'register').mockRejectedValue(new ApiClientError(429, { code: 'RATE_LIMITED', message: 'too many' }));
    renderWithIntl(<AuthForm mode="register" />, 'es');
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Ash' } });
    fireEvent.change(screen.getByLabelText('Correo'), { target: { value: 'ash@example.com' } });
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'pikachu-123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear cuenta' }));

    const banner = await screen.findByTestId('auth-rate-limited');
    expect(banner).toHaveTextContent('Demasiados intentos seguidos. Espera un momento y vuelve a intentarlo.');
    expect(banner.textContent).not.toMatch(/correo/i);
    expect(screen.queryByRole('link', { name: 'Restablecer contraseña' })).not.toBeInTheDocument();
  });

  it('un 429 viejo se retira al reintentar (no se acumulan banners)', async () => {
    const login = vi.spyOn(api, 'login').mockRejectedValueOnce(new ApiClientError(429, { code: 'RATE_LIMITED', message: 'x' })).mockRejectedValueOnce(new ApiClientError(401, { code: 'INVALID_CREDENTIALS', message: 'bad' }));
    renderWithIntl(<AuthForm mode="login" />, 'es');
    submit();
    await screen.findByTestId('auth-rate-limited');
    submit();
    await waitFor(() => expect(login).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByTestId('auth-rate-limited')).not.toBeInTheDocument());
  });
});

/**
 * **F-C7-4** (errata v1.80.8.1): la rama la decide `error.code`. Con el status solo (`status === 429`) el
 * `RATE_LIMITED` ofrecería restablecer —un remedio que no remedia el tope por IP— y diría «correo» de un tope
 * que no depende del correo. Mutación que esta prueba tiene que tumbar: ramificar el enlace/texto por el status.
 */
describe('F-C7-4 · el aviso del 429 se elige por `error.code`', () => {
  it.each([
    ['sin `retryAfterSeconds`', undefined],
    ['con `retryAfterSeconds: 90`', { retryAfterSeconds: 90 }],
  ])('login `429 RATE_LIMITED` %s ⇒ sin enlace a /forgot-password y sin «correo»', async (_n, details) => {
    vi.spyOn(api, 'login').mockRejectedValue(new ApiClientError(429, { code: 'RATE_LIMITED', message: 'x', details }));
    renderWithIntl(<AuthForm mode="login" />, 'es');
    submit();

    const banner = await screen.findByTestId('auth-rate-limited');
    expect(banner.textContent).not.toMatch(/correo|contraseña|restablece/i);
    expect(banner.querySelector('a[href="/forgot-password"]')).toBeNull();
    if (details) expect(banner).toHaveTextContent('Vuelve a intentarlo en 2 minutos.');
  });

  it('login `429` de código desconocido ⇒ igual que `RATE_LIMITED` (ante la duda, sin remedio)', async () => {
    vi.spyOn(api, 'login').mockRejectedValue(new ApiClientError(429, { code: 'SOMETHING_NEW', message: 'x' }));
    renderWithIntl(<AuthForm mode="login" />, 'es');
    submit();

    const banner = await screen.findByTestId('auth-rate-limited');
    expect(banner).toHaveTextContent('Demasiados intentos seguidos. Espera un momento y vuelve a intentarlo.');
    expect(banner.querySelector('a[href="/forgot-password"]')).toBeNull();
  });

  it('login `429 TOO_MANY_PASSWORD_ATTEMPTS` ⇒ con enlace a /forgot-password dentro del banner', async () => {
    vi.spyOn(api, 'login').mockRejectedValue(new ApiClientError(429, { code: TMPA, message: 'x', details: { retryAfterSeconds: 90 } }));
    renderWithIntl(<AuthForm mode="login" />, 'es');
    submit();

    const banner = await screen.findByTestId('auth-rate-limited');
    expect(banner).toHaveTextContent('Demasiados intentos con este correo. Vuelve a intentarlo en 2 minutos, o restablece tu contraseña.');
    expect(banner.querySelector('a[href="/forgot-password"]')).not.toBeNull();
  });
});
