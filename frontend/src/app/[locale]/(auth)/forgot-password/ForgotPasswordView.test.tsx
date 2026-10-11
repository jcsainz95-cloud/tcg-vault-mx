import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { renderWithIntl } from '@/test/render';
import { ForgotPasswordView } from './ForgotPasswordView';
import { ApiClientError } from '@/lib/api-client';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const forgotPassword = vi.fn();
vi.mock('@/lib/api', () => ({
  forgotPassword: (...a: unknown[]) => forgotPassword(...a),
}));

afterEach(() => vi.clearAllMocks());

function submitEmail(value: string) {
  fireEvent.change(screen.getByLabelText('Correo'), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: /Enviar instrucciones/ }));
}

describe('ForgotPasswordView (anti-enumeración)', () => {
  it('shows the SAME generic message on success', async () => {
    forgotPassword.mockResolvedValueOnce({ ok: true });
    renderWithIntl(<ForgotPasswordView />);
    submitEmail('exists@example.com');
    await waitFor(() =>
      expect(screen.getByText(/Si el correo existe/)).toBeInTheDocument(),
    );
    expect(forgotPassword).toHaveBeenCalledWith('exists@example.com');
  });

  it('shows the SAME generic message even on a non-rate-limit error (no signal leak)', async () => {
    forgotPassword.mockRejectedValueOnce(
      new ApiClientError(500, { code: 'INTERNAL', message: 'x' }),
    );
    renderWithIntl(<ForgotPasswordView />);
    submitEmail('unknown@example.com');
    await waitFor(() =>
      expect(screen.getByText(/Si el correo existe/)).toBeInTheDocument(),
    );
  });

  it('surfaces rate-limit distinctly', async () => {
    forgotPassword.mockRejectedValueOnce(
      new ApiClientError(429, { code: 'RATE_LIMITED', message: 'x' }),
    );
    renderWithIntl(<ForgotPasswordView />);
    submitEmail('spam@example.com');
    await waitFor(() =>
      expect(screen.getByText(/demasiadas solicitudes/i)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/Si el correo existe/)).toBeNull();
  });
});

/**
 * **UX-5** (`DESIGN_SYSTEM §42.2`, criterio 262, nota N-1): con un USUARIO tecleado la pantalla se comporta
 * EXACTAMENTE como con un correo inexistente — el envío llega a `forgotPassword('ana')` y pinta el mismo
 * «Si el correo existe…». Con `type="email"` el navegador lo frenaría con su propio mensaje (señal distinta).
 * Canario: devolver `type="email"`.
 */
describe('UX-5 · «olvidé» no rechaza un usuario en el navegador', () => {
  it('el campo es `type="text"` (con teclado de correo) y conserva la etiqueta «Correo»', () => {
    renderWithIntl(<ForgotPasswordView />);
    const input = screen.getByLabelText('Correo');
    expect(input).toHaveAttribute('type', 'text');
    expect(input).toHaveAttribute('inputmode', 'email');
    expect(input).toHaveAttribute('autocomplete', 'email');
    // ⛔ La pantalla no menciona usuarios ni al administrador.
    expect(document.body.textContent).not.toMatch(/usuario|administrador/i);
  });

  it('«ana» y «nadie@x.com» llegan al servidor y pintan el MISMO resultado', async () => {
    forgotPassword.mockResolvedValue({ ok: true });
    const a = renderWithIntl(<ForgotPasswordView />);
    submitEmail('ana');
    await screen.findByText(/Si el correo existe/);
    expect(forgotPassword).toHaveBeenLastCalledWith('ana');
    const withUsername = a.container.innerHTML;
    a.unmount();

    const b = renderWithIntl(<ForgotPasswordView />);
    submitEmail('nadie@x.com');
    await screen.findByText(/Si el correo existe/);
    expect(forgotPassword).toHaveBeenLastCalledWith('nadie@x.com');
    expect(b.container.innerHTML).toBe(withUsername);
  });
});
