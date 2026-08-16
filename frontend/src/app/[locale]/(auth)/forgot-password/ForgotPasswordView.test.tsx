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
