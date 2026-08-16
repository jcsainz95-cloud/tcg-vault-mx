import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { renderWithIntl } from '@/test/render';
import { VerifyEmailView } from './VerifyEmailView';
import { ApiClientError } from '@/lib/api-client';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const verifyEmail = vi.fn();
const resendVerificationEmail = vi.fn();
vi.mock('@/lib/api', () => ({
  verifyEmail: (...a: unknown[]) => verifyEmail(...a),
  resendVerificationEmail: (...a: unknown[]) => resendVerificationEmail(...a),
}));

let sessionValue = { user: null as unknown, isAuthenticated: false, ready: true };
vi.mock('@/lib/session', () => ({
  useSession: () => sessionValue,
}));

afterEach(() => {
  vi.clearAllMocks();
  sessionValue = { user: null, isAuthenticated: false, ready: true };
});

describe('VerifyEmailView', () => {
  it('verifies on mount and shows success', async () => {
    verifyEmail.mockResolvedValueOnce({ verified: true });
    renderWithIntl(<VerifyEmailView token="good-token" />);
    await waitFor(() => expect(screen.getByText(/Correo verificado/)).toBeInTheDocument());
    expect(verifyEmail).toHaveBeenCalledWith('good-token');
  });

  it('shows invalid state and offers resend when authenticated', async () => {
    verifyEmail.mockRejectedValueOnce(
      new ApiClientError(422, { code: 'EMAIL_VERIFY_TOKEN_INVALID', message: 'x' }),
    );
    resendVerificationEmail.mockResolvedValueOnce({ ok: true });
    sessionValue = { user: { id: 'u' }, isAuthenticated: true, ready: true };
    renderWithIntl(<VerifyEmailView token="bad-token" />);
    await waitFor(() =>
      expect(screen.getByText(/enlace es inválido o expiró/)).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('button', { name: /Reenviar correo/ }));
    await waitFor(() =>
      expect(screen.getByText(/nuevo correo de verificación/)).toBeInTheDocument(),
    );
  });

  it('invalid state without session prompts to log in (resend is authenticated)', async () => {
    verifyEmail.mockRejectedValueOnce(
      new ApiClientError(422, { code: 'EMAIL_VERIFY_TOKEN_INVALID', message: 'x' }),
    );
    renderWithIntl(<VerifyEmailView token="bad-token" />);
    await waitFor(() =>
      expect(screen.getByText(/Inicia sesión para reenviarte/)).toBeInTheDocument(),
    );
    expect(screen.queryByRole('button', { name: /Reenviar correo/ })).toBeNull();
  });

  it('does not call verify when there is no token', () => {
    renderWithIntl(<VerifyEmailView token={undefined} />);
    expect(verifyEmail).not.toHaveBeenCalled();
    expect(screen.getByText(/Falta el enlace de verificación/)).toBeInTheDocument();
  });
});
