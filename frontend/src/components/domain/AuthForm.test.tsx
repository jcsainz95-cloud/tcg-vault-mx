import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithIntl } from '@/test/render';
import { AuthForm } from './AuthForm';
import { config } from '@/lib/config';
import type { AuthResponse, Role } from '@/types/contract';

// AuthForm y GoogleSignInButton usan next-intl navigation; capturamos push.
const push = vi.fn();
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push }),
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

// Aislamos las llamadas de red del formulario.
const login = vi.fn();
const register = vi.fn();
const loginWithGoogle = vi.fn();
vi.mock('@/lib/api', () => ({
  login: (...a: unknown[]) => login(...a),
  register: (...a: unknown[]) => register(...a),
  loginWithGoogle: (...a: unknown[]) => loginWithGoogle(...a),
}));

const mockNoticeEs =
  'Autenticación pendiente de backend: el envío simula el flujo y guarda una sesión local.';

function authResponse(role: Role): AuthResponse {
  return {
    user: { id: 'u-1', email: 'x@x.com', name: 'X', role, locale: 'es' },
    accessToken: 'a',
    refreshToken: 'r',
  };
}

describe('AuthForm — aviso de mock', () => {
  const original = config.useMocks;
  afterEach(() => {
    config.useMocks = original;
  });

  it('con mocks activos muestra el banner de sesión simulada', () => {
    config.useMocks = true;
    renderWithIntl(<AuthForm mode="login" />, 'es');
    expect(screen.getByText(mockNoticeEs)).toBeInTheDocument();
  });

  it('con backend real (useMocks=false) NO muestra el banner', () => {
    config.useMocks = false;
    renderWithIntl(<AuthForm mode="login" />, 'es');
    expect(screen.queryByText(mockNoticeEs)).not.toBeInTheDocument();
  });
});

describe('AuthForm — aviso de cierre por inactividad', () => {
  it('muestra el aviso cuando notice="inactivity"', () => {
    renderWithIntl(<AuthForm mode="login" notice="inactivity" />, 'es');
    expect(screen.getByText('Tu sesión se cerró por inactividad.')).toBeInTheDocument();
  });

  it('no lo muestra sin el flag', () => {
    renderWithIntl(<AuthForm mode="login" />, 'es');
    expect(screen.queryByText('Tu sesión se cerró por inactividad.')).not.toBeInTheDocument();
  });
});

describe('AuthForm — redirección post-login según rol', () => {
  beforeEach(() => {
    push.mockClear();
    login.mockReset();
  });

  function submit(container: HTMLElement) {
    const email = container.querySelector('input[name="email"]') as HTMLInputElement;
    const password = container.querySelector('input[name="password"]') as HTMLInputElement;
    fireEvent.change(email, { target: { value: 'a@b.com' } });
    fireEvent.change(password, { target: { value: 'secret123' } });
    fireEvent.submit(email.closest('form') as HTMLFormElement);
  }

  it('login como super_admin redirige a /admin', async () => {
    login.mockResolvedValue(authResponse('super_admin'));
    const { container } = renderWithIntl(<AuthForm mode="login" />, 'es');
    submit(container);
    await waitFor(() => expect(push).toHaveBeenCalledWith('/admin'));
  });

  it('login como vault_operator redirige a /admin', async () => {
    login.mockResolvedValue(authResponse('vault_operator'));
    const { container } = renderWithIntl(<AuthForm mode="login" />, 'es');
    submit(container);
    await waitFor(() => expect(push).toHaveBeenCalledWith('/admin'));
  });

  it('login como customer redirige a la tienda (/)', async () => {
    login.mockResolvedValue(authResponse('customer'));
    const { container } = renderWithIntl(<AuthForm mode="login" />, 'es');
    submit(container);
    await waitFor(() => expect(push).toHaveBeenCalledWith('/'));
  });

  it('con ?next interno lo honra por encima del rol', async () => {
    login.mockResolvedValue(authResponse('super_admin'));
    const { container } = renderWithIntl(<AuthForm mode="login" next="/admin/m6" />, 'es');
    submit(container);
    await waitFor(() => expect(push).toHaveBeenCalledWith('/admin/m6'));
  });
});
