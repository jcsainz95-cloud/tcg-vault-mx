import { describe, it, expect, afterEach, vi } from 'vitest';
import es from '../../../../../messages/es.json';
import en from '../../../../../messages/en.json';
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

  it('a validation 4xx still shows the SAME generic message (no signal leak; §CTA-UX.3b: 4xx sin cambio)', async () => {
    forgotPassword.mockRejectedValueOnce(new ApiClientError(400, { code: 'VALIDATION_ERROR', message: 'x' }));
    renderWithIntl(<ForgotPasswordView />);
    submitEmail('unknown@example.com');
    await waitFor(() => expect(screen.getByText(/Si el correo existe/)).toBeInTheDocument());
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

/**
 * TL-CTA-9 (DESIGN_SYSTEM §CTA-UX.3b): un 5xx o un fallo de red NO es «enviado». El backend responde `{ok:true}` antes
 * de buscar la cuenta (`auth.service.ts` `forgotPassword`), así que el 5xx no depende de si el correo existe (no es
 * oráculo). ⇒ `Banner danger` `role=alert`, el correo se queda en el campo y se puede reintentar.
 * Mutación: volver a tratar el 5xx como enviado ⇒ rojo.
 */
describe('TL-CTA-9 · 5xx o red ⇒ error, no «enviado»', () => {
  it.each([
    ['500', () => new ApiClientError(500, { code: 'INTERNAL', message: 'x' })],
    ['503', () => new ApiClientError(503, { code: 'INTERNAL', message: 'x' })],
    ['red caída', () => new TypeError('Failed to fetch')],
  ])('%s ⇒ Banner danger role=alert, correo conservado, sin «enviado»; reintentar envía', async (_l, mkErr) => {
    forgotPassword.mockRejectedValueOnce(mkErr());
    renderWithIntl(<ForgotPasswordView />);
    submitEmail('ana@x.mx');
    const banner = (await screen.findByText(es.forgotPassword.sendError)).closest('[data-variant]')!;
    expect(banner).toHaveAttribute('data-variant', 'danger');
    expect(banner).toHaveAttribute('role', 'alert');
    expect(screen.queryByText(/Si el correo existe/)).toBeNull();
    expect(screen.queryByText(es.forgotPassword.sentTitle)).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByLabelText('Correo')).toHaveValue('ana@x.mx');
    // Reintento: el mismo correo, y esta vez sí «enviado» (y el error se va).
    forgotPassword.mockResolvedValueOnce({ ok: true });
    fireEvent.click(screen.getByRole('button', { name: /Enviar instrucciones/ }));
    await screen.findByText(/Si el correo existe/);
    expect(forgotPassword).toHaveBeenLastCalledWith('ana@x.mx');
    expect(forgotPassword).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(es.forgotPassword.sendError)).toBeNull();
  });

  it('EN: el mismo error con su copy', async () => {
    forgotPassword.mockRejectedValueOnce(new ApiClientError(500, { code: 'INTERNAL', message: 'x' }));
    renderWithIntl(<ForgotPasswordView />, 'en');
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ana@x.mx' } });
    fireEvent.click(screen.getByRole('button', { name: /Send instructions/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(en.forgotPassword.sendError);
    expect(screen.queryByText(en.forgotPassword.sentBody)).toBeNull();
  });
});
