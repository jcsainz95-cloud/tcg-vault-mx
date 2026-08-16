import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { renderWithIntl } from '@/test/render';
import { VerifyEmailBanner } from './VerifyEmailBanner';
import type { UserDTO } from '@/types/contract';

const resendVerificationEmail = vi.fn();
vi.mock('@/lib/api', () => ({
  resendVerificationEmail: (...a: unknown[]) => resendVerificationEmail(...a),
}));

let sessionValue: { user: UserDTO | null; isAuthenticated: boolean; ready: boolean };
vi.mock('@/lib/session', () => ({
  useSession: () => sessionValue,
}));

function user(over: Partial<UserDTO> = {}): UserDTO {
  return { id: 'u', email: 'a@a.com', name: 'A', role: 'customer', locale: 'es', ...over };
}

afterEach(() => vi.clearAllMocks());

describe('VerifyEmailBanner', () => {
  it('shows when the logged-in user is not verified and resends', async () => {
    resendVerificationEmail.mockResolvedValueOnce({ ok: true });
    sessionValue = { user: user({ emailVerified: false }), isAuthenticated: true, ready: true };
    renderWithIntl(<VerifyEmailBanner />);
    expect(screen.getByText('Verifica tu correo')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Reenviar correo/ }));
    await waitFor(() =>
      expect(screen.getByText(/nuevo correo de verificación/)).toBeInTheDocument(),
    );
    expect(resendVerificationEmail).toHaveBeenCalled();
  });

  it('is hidden when the user is verified', () => {
    sessionValue = { user: user({ emailVerified: true }), isAuthenticated: true, ready: true };
    const { container } = renderWithIntl(<VerifyEmailBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('is hidden when there is no session', () => {
    sessionValue = { user: null, isAuthenticated: false, ready: true };
    const { container } = renderWithIntl(<VerifyEmailBanner />);
    expect(container).toBeEmptyDOMElement();
  });
});
