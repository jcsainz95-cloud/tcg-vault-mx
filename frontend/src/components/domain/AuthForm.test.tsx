import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithIntl } from '@/test/render';
import { AuthForm } from './AuthForm';
import { config } from '@/lib/config';
import type { AuthResponse, Role } from '@/types/contract';

// AuthForm y GoogleSignInButton usan next-intl navigation; capturamos push.
const push = vi.fn();
const replace = vi.fn();
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push, replace }),
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

function authResponse(role: Role, over: Partial<AuthResponse['user']> = {}): AuthResponse {
  return {
    user: { id: 'u-1', email: 'x@x.com', name: 'X', role, locale: 'es', ...over },
    accessToken: 'a',
    refreshToken: 'r',
  };
}

function submitLogin(container: HTMLElement) {
  const email = container.querySelector('input[name="email"]') as HTMLInputElement;
  const password = container.querySelector('input[name="password"]') as HTMLInputElement;
  fireEvent.change(email, { target: { value: 'a@b.com' } });
  fireEvent.change(password, { target: { value: 'secret123' } });
  fireEvent.submit(email.closest('form') as HTMLFormElement);
}

/**
 * v1.67 — contraseña temporal BLOQUEANTE (decisión del dueño; contrato §1 «Contraseña temporal
 * OBLIGATORIA»; DESIGN_SYSTEM §33.8 pasos 1 y 2). Con `user.mustChangePassword: true` el login
 * NO pinta banner ni «Continuar»: navega DIRECTO (replace) a la página de contraseña del rol y
 * REENVÍA `?next=` sin consumirlo. Mutación que este bloque debe cazar: quitar el redirect por
 * `mustChangePassword` en `AuthForm.redirectAfterAuth` ⇒ `push('/')` en vez de `replace(...)`.
 */
describe('AuthForm — contraseña temporal bloquea (v1.67, §33.8)', () => {
  beforeEach(() => {
    push.mockClear();
    replace.mockClear();
    login.mockReset();
    loginWithGoogle.mockReset();
  });

  it('customer con mustChangePassword → replace a /account/password, sin push ni «Continuar»', async () => {
    login.mockResolvedValue(authResponse('customer', { mustChangePassword: true }));
    const { container } = renderWithIntl(<AuthForm mode="login" />, 'es');
    submitLogin(container);
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith({ pathname: '/account/password', query: {} }),
    );
    expect(push).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Continuar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('staff con mustChangePassword y ?next → replace a /admin/account/password REENVIANDO next', async () => {
    login.mockResolvedValue(authResponse('vault_operator', { mustChangePassword: true }));
    const { container } = renderWithIntl(<AuthForm mode="login" next="/admin/m4" />, 'es');
    submitLogin(container);
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith({
        pathname: '/admin/account/password',
        query: { next: '/admin/m4' },
      }),
    );
    expect(push).not.toHaveBeenCalled();
  });

  it('un ?next externo (open redirect) NO se reenvía a la página de contraseña', async () => {
    login.mockResolvedValue(authResponse('customer', { mustChangePassword: true }));
    const { container } = renderWithIntl(<AuthForm mode="login" next="https://evil.example" />, 'es');
    submitLogin(container);
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith({ pathname: '/account/password', query: {} }),
    );
  });

  it('sin la bandera el login sigue yendo al home del rol (push), nunca a /password', async () => {
    login.mockResolvedValue(authResponse('customer', { mustChangePassword: false }));
    const { container } = renderWithIntl(<AuthForm mode="login" />, 'es');
    submitLogin(container);
    await waitFor(() => expect(push).toHaveBeenCalledWith('/'));
    expect(replace).not.toHaveBeenCalled();
  });

  it('login con Google de una cuenta reseteada por el admin → mismo replace (§33.8 paso 2)', async () => {
    loginWithGoogle.mockResolvedValue(authResponse('customer', { mustChangePassword: true }));
    renderWithIntl(<AuthForm mode="login" next="/vault" />, 'es');
    fireEvent.click(screen.getByRole('button', { name: /Continuar con Google/ }));
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith({ pathname: '/account/password', query: { next: '/vault' } }),
    );
    expect(push).not.toHaveBeenCalled();
  });
});

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
