import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/render';
import { ApiClientError } from '@/lib/api-client';
import { getStoredUser } from '@/lib/session';
import { PrivacyLinkProvider } from '@/components/legal/PrivacyNoticeLink';
import { InlineAuthPanel } from './InlineAuthPanel';

// Aislamos las llamadas de red del panel (mismo patrón que AuthForm.test).
const login = vi.fn();
const registerEmailOnly = vi.fn();
const register = vi.fn();
const forgotPassword = vi.fn();
const loginWithGoogle = vi.fn();
vi.mock('@/lib/api', () => ({
  login: (...a: unknown[]) => login(...a),
  registerEmailOnly: (...a: unknown[]) => registerEmailOnly(...a),
  register: (...a: unknown[]) => register(...a),
  forgotPassword: (...a: unknown[]) => forgotPassword(...a),
  loginWithGoogle: (...a: unknown[]) => loginWithGoogle(...a),
}));

const TAKEN = 'Ese correo ya tiene una cuenta. Entra con tu contraseña y sigue con tu compra: tu carrito no cambia.';

function emailTaken() {
  return new ApiClientError(409, { code: 'EMAIL_TAKEN', message: 'taken' });
}

function cartSnapshot() {
  return window.localStorage.getItem('tcg.cart');
}

beforeEach(() => {
  login.mockReset();
  registerEmailOnly.mockReset();
  register.mockReset();
  forgotPassword.mockReset();
  window.localStorage.clear();
  window.localStorage.setItem('tcg.cart', JSON.stringify({ ids: ['inv-1', 'inv-2'], updatedAt: 1 }));
});

/**
 * CTA-F1 (API_CONTRACT §CTA.9, criterio 969): «Crear cuenta» del carrito y del upsell pide UN campo (correo) y la
 * leyenda del 504 con sus dos enlaces; ningún campo de contraseña, nombre o celular; envía `registerEmailOnly`.
 * Mutación: el formulario viejo (nombre + correo + contraseña con `register`).
 */
describe('CTA-F1 · alta con solo el correo', () => {
  it('un solo campo (correo), leyenda del 504 con Términos y Aviso, y nada más que teclear', () => {
    renderWithProviders(
      <PrivacyLinkProvider linked>
        <InlineAuthPanel variant="register" defaultEmail="ana@x.mx" onSuccess={vi.fn()} />
      </PrivacyLinkProvider>,
      'es',
    );
    const form = screen.getByRole('button', { name: 'Crear cuenta' }).closest('form')!;
    const fields = form.querySelectorAll('input:not([type="hidden"]), select, textarea');
    expect(fields).toHaveLength(1);
    expect(within(form).getByLabelText('Correo')).toHaveValue('ana@x.mx');
    expect(form.querySelector('input[type="password"]')).toBeNull();
    expect(within(form).queryByLabelText(/Nombre|Celular|Teléfono|Contraseña/)).toBeNull();
    const legend = within(form).getByTestId('privacy-site-register');
    expect(legend).toHaveTextContent(/Al crear tu cuenta aceptas los Términos.*y el Aviso de privacidad/);
    expect(within(legend).getByRole('link', { name: /Términos/ })).toHaveAttribute('href', '/es/terminos');
    expect(within(legend).getByRole('link', { name: /Aviso de privacidad/ })).toHaveAttribute('href', '/es/privacidad');
  });

  it('envía registerEmailOnly({ email }) sin contraseña ni nombre, y continúa el flujo', async () => {
    const user = userEvent.setup();
    registerEmailOnly.mockResolvedValue({ user: { role: 'customer' }, accessToken: 'a', refreshToken: 'r' });
    const onSuccess = vi.fn();
    renderWithProviders(<InlineAuthPanel variant="register" defaultEmail=" ana@x.mx " onSuccess={onSuccess} />, 'es');
    await user.click(screen.getByRole('button', { name: 'Crear cuenta' }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(registerEmailOnly).toHaveBeenCalledTimes(1);
    const body = registerEmailOnly.mock.calls[0][0] as Record<string, unknown>;
    expect(body.email).toBe('ana@x.mx');
    expect(Object.keys(body).sort()).toEqual(['email', 'locale']);
    expect(register).not.toHaveBeenCalled();
  });

  it('en EN también: un solo campo y la leyenda', () => {
    renderWithProviders(<InlineAuthPanel variant="register" onSuccess={vi.fn()} />, 'en');
    const form = screen.getByTestId('privacy-site-register').closest('form')!;
    expect(form.querySelectorAll('input:not([type="hidden"])')).toHaveLength(1);
    expect(registerEmailOnly).not.toHaveBeenCalled();
  });
});

/**
 * CTA-F2 (criterio 970, P-CTA-3 = A): `409 EMAIL_TAKEN` ⇒ copy con «Ingresar a cuenta» (entrada con el correo puesto)
 * y «¿Olvidaste tu contraseña?»; el carrito no cambia; no se guarda sesión. Mutación: guardar sesión o vaciar carrito.
 */
describe('CTA-F2 · correo con cuenta ⇒ «Ingresar a cuenta»', () => {
  it('pinta el aviso con las dos salidas, sin sesión y con el carrito intacto', async () => {
    const user = userEvent.setup();
    registerEmailOnly.mockRejectedValue(emailTaken());
    const before = cartSnapshot();
    const onSuccess = vi.fn();
    renderWithProviders(<InlineAuthPanel variant="register" defaultEmail="juan@dominio.com" onSuccess={onSuccess} />, 'es');
    await user.click(screen.getByRole('button', { name: 'Crear cuenta' }));

    expect(await screen.findByText(TAKEN)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ingresar a cuenta' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '¿Olvidaste tu contraseña?' })).toBeInTheDocument();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(getStoredUser()).toBeNull();
    expect(window.localStorage.getItem('tcg.token')).toBeNull();
    expect(cartSnapshot()).toBe(before);
  });

  it('«Ingresar a cuenta» abre la entrada con el correo ya escrito, enfoca la contraseña y entra con login', async () => {
    const user = userEvent.setup();
    registerEmailOnly.mockRejectedValue(emailTaken());
    login.mockResolvedValue({ user: { role: 'customer' }, accessToken: 'a', refreshToken: 'r' });
    const onSuccess = vi.fn();
    const before = cartSnapshot();
    renderWithProviders(<InlineAuthPanel variant="register" defaultEmail="juan@dominio.com" onSuccess={onSuccess} />, 'es');
    await user.click(screen.getByRole('button', { name: 'Crear cuenta' }));
    await user.click(await screen.findByRole('button', { name: 'Ingresar a cuenta' }));

    expect(screen.getByLabelText('Correo')).toHaveValue('juan@dominio.com');
    expect(screen.queryByText(TAKEN)).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Contraseña')).toHaveFocus());
    await user.type(screen.getByLabelText('Contraseña'), 'secret123');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));
    await waitFor(() => expect(login).toHaveBeenCalledWith({ email: 'juan@dominio.com', password: 'secret123' }));
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(cartSnapshot()).toBe(before);
  });

  it('en el upsell (con onSwitchVariant) «Ingresar a cuenta» delega el cambio de variante al padre', async () => {
    const user = userEvent.setup();
    registerEmailOnly.mockRejectedValue(emailTaken());
    const onSwitchVariant = vi.fn();
    renderWithProviders(
      <InlineAuthPanel
        variant="register"
        defaultEmail="juan@dominio.com"
        onSwitchVariant={onSwitchVariant}
        switchLabel="Ya tengo cuenta"
        onSuccess={vi.fn()}
      />,
      'es',
    );
    await user.click(screen.getByRole('button', { name: 'Crear cuenta' }));
    await user.click(await screen.findByRole('button', { name: 'Ingresar a cuenta' }));
    expect(onSwitchVariant).toHaveBeenCalledTimes(1);
  });

  it('«¿Olvidaste tu contraseña?» llama a forgot-password con ese correo, sin salir', async () => {
    const user = userEvent.setup();
    registerEmailOnly.mockRejectedValue(emailTaken());
    forgotPassword.mockResolvedValue({ ok: true });
    renderWithProviders(<InlineAuthPanel variant="register" defaultEmail="juan@dominio.com" onSuccess={vi.fn()} />, 'es');
    await user.click(screen.getByRole('button', { name: 'Crear cuenta' }));
    await user.click(await screen.findByRole('button', { name: '¿Olvidaste tu contraseña?' }));
    await waitFor(() => expect(forgotPassword).toHaveBeenCalledWith('juan@dominio.com'));
    expect(await screen.findByText('Te mandamos un enlace a ese correo para poner una contraseña nueva.')).toBeInTheDocument();
    expect(getStoredUser()).toBeNull();
  });

  it('en EN: «Log in to account»', async () => {
    const user = userEvent.setup();
    registerEmailOnly.mockRejectedValue(emailTaken());
    renderWithProviders(<InlineAuthPanel variant="register" defaultEmail="j@d.com" onSuccess={vi.fn()} />, 'en');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('button', { name: 'Log in to account' })).toBeInTheDocument();
  });
});
