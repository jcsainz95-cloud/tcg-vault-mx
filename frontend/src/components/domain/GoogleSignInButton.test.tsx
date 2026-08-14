import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { GoogleSignInButton } from './GoogleSignInButton';
import { getToken, setToken } from '@/lib/api-client';

describe('GoogleSignInButton (§6.7, rama mock)', () => {
  beforeEach(() => setToken(null));

  it('muestra el CTA "Continuar con Google"', () => {
    renderWithProviders(<GoogleSignInButton onSuccess={() => {}} />, 'es');
    expect(screen.getByRole('button', { name: /Continuar con Google/ })).toBeInTheDocument();
  });

  it('al hacer clic (mock) canjea el idToken, deja sesión y llama onSuccess', async () => {
    const onSuccess = vi.fn();
    renderWithProviders(<GoogleSignInButton onSuccess={onSuccess} />, 'es');

    fireEvent.click(screen.getByRole('button', { name: /Continuar con Google/ }));
    // Estado de carga: label "Conectando…"
    expect(screen.getByText('Conectando…')).toBeInTheDocument();

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(getToken()).toBe('mock.session.token');
  });
});
