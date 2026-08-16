import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { renderWithIntl } from '@/test/render';
import { ResetPasswordView } from './ResetPasswordView';
import { ApiClientError } from '@/lib/api-client';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const resetPassword = vi.fn();
vi.mock('@/lib/api', () => ({
  resetPassword: (...a: unknown[]) => resetPassword(...a),
}));

afterEach(() => vi.clearAllMocks());

function fill(pw: string, confirm: string) {
  fireEvent.change(screen.getByLabelText('Nueva contraseña'), { target: { value: pw } });
  fireEvent.change(screen.getByLabelText('Confirmar contraseña'), { target: { value: confirm } });
  fireEvent.click(screen.getByRole('button', { name: /Cambiar contraseña/ }));
}

describe('ResetPasswordView', () => {
  it('renders the invalid-token state when there is no token', () => {
    renderWithIntl(<ResetPasswordView token={undefined} />);
    expect(screen.getByText(/Enlace inválido o expirado/)).toBeInTheDocument();
    expect(screen.getByText(/Solicitar otro enlace/)).toBeInTheDocument();
  });

  it('validates min length (policy) before calling the API', async () => {
    renderWithIntl(<ResetPasswordView token="good-token" />);
    fill('short', 'short');
    await waitFor(() =>
      expect(screen.getByText(/al menos 8 caracteres/)).toBeInTheDocument(),
    );
    expect(resetPassword).not.toHaveBeenCalled();
  });

  it('requires confirmation to match', async () => {
    renderWithIntl(<ResetPasswordView token="good-token" />);
    fill('longenough1', 'different1');
    await waitFor(() => expect(screen.getByText(/no coinciden/)).toBeInTheDocument());
    expect(resetPassword).not.toHaveBeenCalled();
  });

  it('resets and shows success + login link', async () => {
    resetPassword.mockResolvedValueOnce({ ok: true });
    renderWithIntl(<ResetPasswordView token="good-token" />);
    fill('longenough1', 'longenough1');
    await waitFor(() => expect(screen.getByText(/Contraseña actualizada/)).toBeInTheDocument());
    expect(resetPassword).toHaveBeenCalledWith({ token: 'good-token', password: 'longenough1' });
  });

  it('shows invalid-token state on 422 RESET_TOKEN_INVALID with CTA to request another', async () => {
    resetPassword.mockRejectedValueOnce(
      new ApiClientError(422, { code: 'RESET_TOKEN_INVALID', message: 'x' }),
    );
    renderWithIntl(<ResetPasswordView token="expired-token" />);
    fill('longenough1', 'longenough1');
    await waitFor(() => expect(screen.getByText(/Enlace inválido o expirado/)).toBeInTheDocument());
    expect(screen.getByText(/Solicitar otro enlace/)).toBeInTheDocument();
  });
});
