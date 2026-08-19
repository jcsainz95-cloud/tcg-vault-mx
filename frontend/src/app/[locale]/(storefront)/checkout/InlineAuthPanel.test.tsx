import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/render';
import { ApiClientError } from '@/lib/api-client';
import { InlineAuthPanel } from './InlineAuthPanel';

// Aislamos las llamadas de red del panel (mismo patrón que AuthForm.test).
const login = vi.fn();
const register = vi.fn();
const loginWithGoogle = vi.fn();
vi.mock('@/lib/api', () => ({
  login: (...a: unknown[]) => login(...a),
  register: (...a: unknown[]) => register(...a),
  loginWithGoogle: (...a: unknown[]) => loginWithGoogle(...a),
}));

const NEUTRAL = 'No se pudo crear la cuenta con ese correo. Puedes iniciar sesión o seguir como invitado.';

function emailTaken() {
  return new ApiClientError(409, { code: 'EMAIL_TAKEN', message: 'taken' });
}

describe('InlineAuthPanel · N-13 · EMAIL_TAKEN ofrece iniciar sesión', () => {
  beforeEach(() => {
    login.mockReset();
    register.mockReset();
    window.localStorage.clear();
  });

  it('registro con EMAIL_TAKEN pinta copy neutro + CTA de iniciar sesión', async () => {
    const user = userEvent.setup();
    register.mockRejectedValue(emailTaken());
    renderWithProviders(
      <InlineAuthPanel
        variant="register"
        defaultEmail="juan@dominio.com"
        defaultName="Juan"
        neutralEmailTaken={NEUTRAL}
        onSuccess={vi.fn()}
      />,
      'es',
    );

    await user.type(screen.getByLabelText('Contraseña'), 'secret123');
    await user.click(screen.getByRole('button', { name: 'Crear cuenta' }));

    expect(await screen.findByText(NEUTRAL)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Iniciar sesión con este correo' })).toBeInTheDocument();
  });

  it('el CTA conmuta a login inline con el correo pre-llenado y enfoca la contraseña', async () => {
    const user = userEvent.setup();
    register.mockRejectedValue(emailTaken());
    login.mockResolvedValue({ user: { role: 'customer' }, accessToken: 'a', refreshToken: 'r' });
    const onSuccess = vi.fn();
    renderWithProviders(
      <InlineAuthPanel
        variant="register"
        defaultEmail="juan@dominio.com"
        defaultName="Juan"
        neutralEmailTaken={NEUTRAL}
        onSuccess={onSuccess}
      />,
      'es',
    );

    const password = screen.getByLabelText('Contraseña');
    await user.type(password, 'secret123');
    await user.click(screen.getByRole('button', { name: 'Crear cuenta' }));
    await screen.findByRole('button', { name: 'Iniciar sesión con este correo' });

    await user.click(screen.getByRole('button', { name: 'Iniciar sesión con este correo' }));

    // Ahora es un formulario de LOGIN: sin campo Nombre, con el correo intacto.
    expect(screen.queryByLabelText('Nombre')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Correo')).toHaveValue('juan@dominio.com');
    // El aviso neutro se limpió al conmutar (no queda un mensaje de registro en un login).
    expect(screen.queryByText(NEUTRAL)).not.toBeInTheDocument();
    // Se enfoca lo único que falta: la contraseña.
    await waitFor(() => expect(screen.getByLabelText('Contraseña')).toHaveFocus());

    // El botón principal pasó a "Entrar" y ejecuta LOGIN, no register.
    await user.click(screen.getByRole('button', { name: 'Entrar' }));
    await waitFor(() =>
      expect(login).toHaveBeenCalledWith({ email: 'juan@dominio.com', password: 'secret123' }),
    );
    expect(onSuccess).toHaveBeenCalled();
  });

  it('en el upsell (con onSwitchVariant) el CTA delega el cambio de variante al padre', async () => {
    const user = userEvent.setup();
    register.mockRejectedValue(emailTaken());
    const onSwitchVariant = vi.fn();
    renderWithProviders(
      <InlineAuthPanel
        variant="register"
        defaultEmail="juan@dominio.com"
        defaultName="Juan"
        neutralEmailTaken={NEUTRAL}
        onSwitchVariant={onSwitchVariant}
        switchLabel="Ya tengo cuenta"
        onSuccess={vi.fn()}
      />,
      'es',
    );

    await user.type(screen.getByLabelText('Contraseña'), 'secret123');
    await user.click(screen.getByRole('button', { name: 'Crear cuenta' }));
    await screen.findByRole('button', { name: 'Iniciar sesión con este correo' });

    await user.click(screen.getByRole('button', { name: 'Iniciar sesión con este correo' }));
    expect(onSwitchVariant).toHaveBeenCalledTimes(1);
  });
});
