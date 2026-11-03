import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { setStoredUser } from '@/lib/session';
import { ApiClientError } from '@/lib/api-client';
import type { UserDTO } from '@/types/contract';

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/account/password',
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const getMe = vi.fn();
const changePassword = vi.fn();
const setPassword = vi.fn();
const forgotPassword = vi.fn();
const updateMyEmail = vi.fn();
const resendVerificationEmail = vi.fn();
vi.mock('@/lib/api', () => ({
  getMe: () => getMe(),
  changePassword: (...a: unknown[]) => changePassword(...a),
  setPassword: (...a: unknown[]) => setPassword(...a),
  forgotPassword: (...a: unknown[]) => forgotPassword(...a),
  updateMyEmail: (...a: unknown[]) => updateMyEmail(...a),
  resendVerificationEmail: (...a: unknown[]) => resendVerificationEmail(...a),
  logout: vi.fn(),
}));

import { PasswordPage } from './PasswordPage';
import { PasswordSection } from './PasswordSection';
import { EmailSection } from './EmailSection';

/** La cuenta del alta con solo el correo, tal como la da `GET /users/me` (§CTA.4). */
const pending: UserDTO = {
  id: 'u-eo',
  email: 'ana@x.mx',
  name: 'ana',
  role: 'customer',
  locale: 'es',
  authProvider: 'local',
  emailVerified: false,
  hasPassword: false,
  mustChangePassword: false,
  nameSource: 'derived',
  accountSetupPending: true,
};
const withPassword: UserDTO = { ...pending, hasPassword: true, accountSetupPending: false, emailVerified: true, nameSource: 'user' };
const google: UserDTO = { ...pending, authProvider: 'google', hasPassword: false, accountSetupPending: false, emailVerified: true };

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
});

/**
 * CTA-F5 (API_CONTRACT §CTA.9, criterio 972): «Mi cuenta» con `accountSetupPending=true` ⇒ «Ponle contraseña a tu
 * cuenta» SIN campo de la actual (llama a `set-password`, que reemplaza los dos tokens) y el correo editable; con
 * `hasPassword=true` ⇒ cambiar pide la actual; Google sin contraseña ⇒ «Crear contraseña» por correo.
 * Mutación: mostrar el modo sin la actual con `hasPassword=true`.
 */
describe('CTA-F5 · «Mi cuenta» de la cuenta con solo el correo', () => {
  it('pendiente: la sección dice «Ponle contraseña a tu cuenta»', () => {
    renderWithProviders(<PasswordSection user={pending} />, 'es');
    expect(screen.getByRole('link', { name: 'Ponle contraseña a tu cuenta' })).toHaveAttribute('href', '/account/password');
  });

  it('pendiente: la página pide nombre y contraseña SIN la actual y llama a set-password', async () => {
    setStoredUser(pending);
    getMe.mockResolvedValue(pending);
    setPassword.mockResolvedValue({ ok: true, accessToken: 'a2', refreshToken: 'r2' });
    renderWithProviders(<PasswordPage surface="storefront" />, 'es');
    expect(await screen.findByRole('heading', { level: 1, name: 'Ponle contraseña a tu cuenta' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Contraseña actual')).toBeNull();
    fireEvent.change(screen.getByLabelText('Nombre (opcional)'), { target: { value: 'Ana López' } });
    fireEvent.change(screen.getByLabelText('Contraseña nueva'), { target: { value: 'longenough1' } });
    fireEvent.change(screen.getByLabelText('Confirmar contraseña nueva'), { target: { value: 'longenough1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar contraseña' }));
    await waitFor(() => expect(setPassword).toHaveBeenCalledWith({ newPassword: 'longenough1', name: 'Ana López' }));
    expect(changePassword).not.toHaveBeenCalled();
    expect(forgotPassword).not.toHaveBeenCalled();
  });

  it('con contraseña (hasPassword=true): cambiar pide la actual, nunca el modo sin ella', async () => {
    // Aun si una sesión vieja dijera `accountSetupPending: true`, `hasPassword` manda.
    const stale = { ...withPassword, accountSetupPending: true };
    setStoredUser(stale);
    getMe.mockResolvedValue(stale);
    renderWithProviders(<PasswordPage surface="storefront" />, 'es');
    expect(await screen.findByLabelText('Contraseña actual')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Ponle contraseña a tu cuenta' })).toBeNull();
  });

  it('Google sin contraseña (no pendiente): «Crear contraseña» por correo, sin formulario', async () => {
    setStoredUser(google);
    getMe.mockResolvedValue(google);
    renderWithProviders(<PasswordPage surface="storefront" />, 'es');
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByLabelText('Contraseña nueva')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Ponle contraseña a tu cuenta' })).toBeNull();
    expect(screen.getByRole('button', { name: /enlace/i })).toBeInTheDocument();
  });

  it('pendiente: el correo se corrige con PATCH /users/me/email', async () => {
    updateMyEmail.mockResolvedValue({ ...pending, email: 'bien@x.mx' });
    renderWithProviders(<EmailSection user={pending} canResend />, 'es');
    fireEvent.click(screen.getByRole('button', { name: 'Corregir mi correo' }));
    const form = screen.getByTestId('email-correction');
    fireEvent.change(within(form).getByLabelText('Correo correcto'), { target: { value: 'bien@x.mx' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Guardar correo' }));
    await waitFor(() => expect(updateMyEmail).toHaveBeenCalledWith('bien@x.mx'));
    expect(await screen.findByText('Correo actualizado. Te mandamos el enlace al correo nuevo.')).toBeInTheDocument();
  });

  it('pendiente: correo tomado ⇒ «Ese correo ya tiene una cuenta.»', async () => {
    updateMyEmail.mockRejectedValue(new ApiClientError(409, { code: 'EMAIL_TAKEN', message: 'x' }));
    renderWithProviders(<EmailSection user={pending} canResend />, 'es');
    fireEvent.click(screen.getByRole('button', { name: 'Corregir mi correo' }));
    fireEvent.change(screen.getByLabelText('Correo correcto'), { target: { value: 'otro@x.mx' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar correo' }));
    expect(await screen.findByText('Ese correo ya tiene una cuenta.')).toBeInTheDocument();
  });

  it('con contraseña o verificado: el correo NO se edita', () => {
    renderWithProviders(<EmailSection user={withPassword} canResend />, 'es');
    expect(screen.queryByRole('button', { name: 'Corregir mi correo' })).toBeNull();
  });
});

/**
 * DESIGN_SYSTEM §CTA-UX.4 (vCTA-1, petición 4) — foco de «Corregir mi correo»: al abrir, al campo; al cancelar o al
 * guardar, de vuelta al enlace (antes el formulario y el enlace se desmontaban y el foco caía al `body`). EN: «Correct
 * my email». Mutaciones: quitar el foco al abrir; quitar el regreso del foco (cancelar / guardar).
 */
describe('CTA-UX.4 · foco de «Corregir mi correo»', () => {
  it('al abrir, el foco va al campo «Correo correcto»', async () => {
    renderWithProviders(<EmailSection user={pending} canResend />, 'es');
    fireEvent.click(screen.getByRole('button', { name: 'Corregir mi correo' }));
    await waitFor(() => expect(screen.getByLabelText('Correo correcto')).toHaveFocus());
  });

  it('al cancelar, el foco vuelve a «Corregir mi correo»', async () => {
    renderWithProviders(<EmailSection user={pending} canResend />, 'es');
    fireEvent.click(screen.getByRole('button', { name: 'Corregir mi correo' }));
    await waitFor(() => expect(screen.getByLabelText('Correo correcto')).toHaveFocus());
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Corregir mi correo' })).toHaveFocus());
  });

  it('al guardar, el foco vuelve a «Corregir mi correo» y el aviso de éxito se anuncia', async () => {
    updateMyEmail.mockResolvedValue({ ...pending, email: 'bien@x.mx' });
    renderWithProviders(<EmailSection user={pending} canResend />, 'es');
    fireEvent.click(screen.getByRole('button', { name: 'Corregir mi correo' }));
    fireEvent.change(screen.getByLabelText('Correo correcto'), { target: { value: 'bien@x.mx' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar correo' }));
    expect(await screen.findByText('Correo actualizado. Te mandamos el enlace al correo nuevo.')).toHaveAttribute('role', 'status');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Corregir mi correo' })).toHaveFocus());
  });

  it('EN: «Correct my email»', () => {
    renderWithProviders(<EmailSection user={pending} canResend />, 'en');
    expect(screen.getByRole('button', { name: 'Correct my email' })).toBeInTheDocument();
  });
});

/**
 * DESIGN_SYSTEM §CTA-UX.6 petición 9 — en «Mi cuenta» el reenvío dice el correo que sale (contrato §CTA.5
 * `verify-email/resend`: con `setupPending` emite «Termina tu cuenta»). Mutación: etiqueta fija «Reenviar correo de
 * verificación».
 */
describe('CTA-UX.6 (9) · reenvío en «Mi cuenta» según el estado de la cuenta', () => {
  it('pendiente (sin contraseña) ⇒ «Reenviar enlace para terminar tu cuenta» y «otro enlace» al enviar', async () => {
    resendVerificationEmail.mockResolvedValue({ ok: true });
    renderWithProviders(<EmailSection user={pending} canResend />, 'es');
    expect(screen.queryByRole('button', { name: 'Reenviar correo de verificación' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Reenviar enlace para terminar tu cuenta' }));
    await waitFor(() => expect(resendVerificationEmail).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Te mandamos otro enlace. Revisa tu correo.')).toBeInTheDocument();
  });

  it('con contraseña y sin verificar ⇒ «Reenviar correo de verificación» (aunque una bandera vieja diga pendiente)', () => {
    const unverifiedWithPw: UserDTO = { ...withPassword, emailVerified: false, accountSetupPending: true };
    renderWithProviders(<EmailSection user={unverifiedWithPw} canResend />, 'es');
    expect(screen.getByRole('button', { name: 'Reenviar correo de verificación' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reenviar enlace para terminar tu cuenta' })).toBeNull();
  });

  it('EN: «Resend the link to finish your account»', () => {
    renderWithProviders(<EmailSection user={pending} canResend />, 'en');
    expect(screen.getByRole('button', { name: 'Resend the link to finish your account' })).toBeInTheDocument();
  });
});
