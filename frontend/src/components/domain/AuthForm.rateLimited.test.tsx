import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithIntl } from '@/test/render';
import { AuthForm } from './AuthForm';
import * as api from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';

/**
 * **El 429 del login** (`C7`, `DESIGN_SYSTEM §37.13`). Candado `PS-UI-13`: sin `Retry-After` el banner dice «Espera
 * unos minutos» y ⛔ no contiene ningún número; con `details.retryAfterSeconds: 600` dice «10 minutos». El botón no
 * se apaga (el servidor es la puerta) y el enlace de restablecer es un `<a>` real.
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
  fireEvent.change(screen.getByLabelText('Correo'), { target: { value: 'ash@example.com' } });
  fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'pikachu-123' } });
  fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
}

describe('PS-UI-13 · login 429', () => {
  it('sin `Retry-After`: «Espera unos minutos», sin números, con enlace real a restablecer y el botón encendido', async () => {
    vi.spyOn(api, 'login').mockRejectedValue(new ApiClientError(429, { code: 'RATE_LIMITED', message: 'too many' }));
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

  it('con `details.retryAfterSeconds: 600` ⇒ «10 minutos»', async () => {
    vi.spyOn(api, 'login').mockRejectedValue(new ApiClientError(429, { code: 'RATE_LIMITED', message: 'too many', details: { retryAfterSeconds: 600 } }));
    renderWithIntl(<AuthForm mode="login" />, 'es');
    submit();

    const banner = await screen.findByTestId('auth-rate-limited');
    expect(banner).toHaveTextContent('Vuelve a intentarlo en 10 minutos');
  });

  it('registro: la misma pareja sin la salida de «restablecer»', async () => {
    vi.spyOn(api, 'register').mockRejectedValue(new ApiClientError(429, { code: 'RATE_LIMITED', message: 'too many' }));
    renderWithIntl(<AuthForm mode="register" />, 'es');
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Ash' } });
    fireEvent.change(screen.getByLabelText('Correo'), { target: { value: 'ash@example.com' } });
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'pikachu-123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear cuenta' }));

    const banner = await screen.findByTestId('auth-rate-limited');
    expect(banner).toHaveTextContent('Demasiados intentos con este correo. Espera unos minutos y vuelve a intentarlo.');
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
