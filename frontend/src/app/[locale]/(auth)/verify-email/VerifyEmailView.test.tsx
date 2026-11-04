import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { screen, waitFor, fireEvent, act } from '@testing-library/react';
import { renderWithIntl } from '@/test/render';
import { ApiClientError } from '@/lib/api-client';
import { setStoredUser } from '@/lib/session';
import es from '../../../../../messages/es.json';
import en from '../../../../../messages/en.json';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

const verifyEmail = vi.fn();
const resendVerificationEmail = vi.fn();
const forgotPassword = vi.fn();
vi.mock('@/lib/api', () => ({
  verifyEmail: (...a: unknown[]) => verifyEmail(...a),
  resendVerificationEmail: (...a: unknown[]) => resendVerificationEmail(...a),
  forgotPassword: (...a: unknown[]) => forgotPassword(...a),
}));

import { VerifyEmailView } from './VerifyEmailView';

const T = es.verifyEmailPage;
const TOKEN = 'tok-verifica-123';

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => {
  vi.clearAllMocks();
});

/** Deja correr efectos y microtareas pendientes (un canje al montar se dispararía aquí). */
async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

function typePasswordAndSubmit(pw = 'mi-clave-123') {
  fireEvent.change(screen.getByLabelText(T.password), { target: { value: pw } });
  fireEvent.click(screen.getByRole('button', { name: T.submit }));
}

function toNewPasswordMode() {
  fireEvent.click(screen.getByRole('button', { name: T.toNewPassword }));
}

/**
 * CTA-F9 (API_CONTRACT §CTA.9, v1.117.2; §1 «Verificación de correo»; D-CTA-12; DESIGN_SYSTEM §CTA-UX.3b).
 * Mutaciones del contrato: «canjear al cargar» y «mandar `{token}` solo».
 */
describe('CTA-F9 · /verify-email no canjea al cargar y prueba o fija la credencial', () => {
  it.each([
    ['sin sesión', false],
    ['con sesión', true],
  ])('cero llamadas a POST /auth/verify-email al cargar (%s)', async (_label, withSession) => {
    if (withSession) {
      setStoredUser({ id: 'u', email: 'ana@x.mx', name: 'ana', role: 'customer', locale: 'es', emailVerified: false });
    }
    renderWithIntl(<VerifyEmailView token={TOKEN} />);
    await settle();
    await settle();
    expect(verifyEmail).not.toHaveBeenCalled();
    expect(resendVerificationEmail).not.toHaveBeenCalled();
    expect(forgotPassword).not.toHaveBeenCalled();
    // Pinta el formulario de contraseña (modo por defecto).
    expect(screen.getByRole('heading', { name: T.title })).toBeInTheDocument();
    expect(screen.getByText(T.passwordLead)).toBeInTheDocument();
    expect(screen.getByLabelText(T.password)).toHaveAttribute('autocomplete', 'current-password');
  });

  it('modo contraseña ⇒ envía EXACTAMENTE {token, password} (nunca {token} solo)', async () => {
    verifyEmail.mockResolvedValue({ verified: true });
    renderWithIntl(<VerifyEmailView token={TOKEN} />);
    typePasswordAndSubmit('mi-clave-123');
    await waitFor(() => expect(verifyEmail).toHaveBeenCalledTimes(1));
    const [body] = verifyEmail.mock.calls[0];
    expect(body).toEqual({ token: TOKEN, password: 'mi-clave-123' });
    expect(Object.keys(body).sort()).toEqual(['password', 'token']);
  });

  it('contraseña vacía ⇒ no envía (el botón no deja)', async () => {
    renderWithIntl(<VerifyEmailView token={TOKEN} />);
    fireEvent.click(screen.getByRole('button', { name: T.submit }));
    await settle();
    expect(verifyEmail).not.toHaveBeenCalled();
  });

  it('«¿No creaste esta cuenta…?» ⇒ modo nueva: envía EXACTAMENTE {token, newPassword}', async () => {
    verifyEmail.mockResolvedValue({ verified: true, deviceToken: 'd' });
    renderWithIntl(<VerifyEmailView token={TOKEN} />);
    toNewPasswordMode();
    expect(verifyEmail).not.toHaveBeenCalled(); // cambiar de modo no envía
    expect(screen.getByText(T.newPasswordLead)).toBeInTheDocument();
    expect(screen.queryByLabelText(T.password)).toBeNull();
    fireEvent.change(screen.getByLabelText(T.newPassword), { target: { value: 'nueva-clave-1' } });
    fireEvent.change(screen.getByLabelText(T.confirm), { target: { value: 'nueva-clave-1' } });
    fireEvent.click(screen.getByRole('button', { name: T.submitNew }));
    await waitFor(() => expect(verifyEmail).toHaveBeenCalledTimes(1));
    const [body] = verifyEmail.mock.calls[0];
    expect(body).toEqual({ token: TOKEN, newPassword: 'nueva-clave-1' });
    expect(Object.keys(body).sort()).toEqual(['newPassword', 'token']);
    // «Listo, entra»
    expect(await screen.findByText(T.successNewPassword)).toBeInTheDocument();
    const signIn = screen.getByRole('link', { name: T.signIn });
    expect(signIn).toHaveAttribute('href', '/login');
  });

  it('modo nueva valida antes de enviar (no gasta el enlace): corta o distinta ⇒ sin petición', async () => {
    renderWithIntl(<VerifyEmailView token={TOKEN} />);
    toNewPasswordMode();
    fireEvent.change(screen.getByLabelText(T.newPassword), { target: { value: 'corta' } });
    fireEvent.change(screen.getByLabelText(T.confirm), { target: { value: 'corta' } });
    fireEvent.click(screen.getByRole('button', { name: T.submitNew }));
    expect(await screen.findByText(T.weak)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(T.newPassword), { target: { value: 'larga-clave-1' } });
    fireEvent.change(screen.getByLabelText(T.confirm), { target: { value: 'larga-clave-2' } });
    fireEvent.click(screen.getByRole('button', { name: T.submitNew }));
    expect(await screen.findByText(T.mismatch)).toBeInTheDocument();
    expect(verifyEmail).not.toHaveBeenCalled();
  });

  it('paso de modo: no navega ni envía, limpia lo tecleado, y «Recordé mi contraseña» vuelve; foco al primer campo nuevo', async () => {
    renderWithIntl(<VerifyEmailView token={TOKEN} />);
    fireEvent.change(screen.getByLabelText(T.password), { target: { value: 'algo' } });
    toNewPasswordMode();
    expect(screen.getByLabelText(T.newPassword)).toHaveFocus();
    fireEvent.change(screen.getByLabelText(T.newPassword), { target: { value: 'xyz' } });
    fireEvent.click(screen.getByRole('button', { name: T.toPassword }));
    const pw = screen.getByLabelText(T.password) as HTMLInputElement;
    expect(pw.value).toBe('');
    expect(pw).toHaveFocus();
    toNewPasswordMode();
    expect((screen.getByLabelText(T.newPassword) as HTMLInputElement).value).toBe('');
    expect(verifyEmail).not.toHaveBeenCalled();
  });

  it('401 ⇒ Banner danger sobre el campo, campo vaciado con aria-invalid y foco; el token sigue (reintento lo manda) y el paso de modo sigue visible', async () => {
    verifyEmail
      .mockRejectedValueOnce(new ApiClientError(401, { code: 'INVALID_CREDENTIALS', message: 'x' }))
      .mockResolvedValueOnce({ verified: true });
    renderWithIntl(<VerifyEmailView token={TOKEN} />);
    typePasswordAndSubmit('mala-clave');
    const title = await screen.findByText(T.wrongPasswordTitle);
    const banner = title.closest('[data-variant]')!;
    expect(banner).toHaveAttribute('data-variant', 'danger');
    expect(banner).toHaveAttribute('role', 'alert');
    expect(screen.getByText(T.wrongPasswordBody)).toBeInTheDocument();
    const pw = screen.getByLabelText(T.password) as HTMLInputElement;
    expect(pw.value).toBe('');
    expect(pw).toHaveAttribute('aria-invalid', 'true');
    expect(pw.getAttribute('aria-describedby')).toBeTruthy();
    expect(document.getElementById(pw.getAttribute('aria-describedby')!.split(' ')[0])).not.toBeNull();
    expect(pw).toHaveFocus();
    expect(screen.getByRole('button', { name: T.toNewPassword })).toBeInTheDocument();
    // sin perder el token: el segundo intento lo vuelve a mandar
    typePasswordAndSubmit('buena-clave');
    await waitFor(() => expect(verifyEmail).toHaveBeenCalledTimes(2));
    expect(verifyEmail.mock.calls[1][0]).toEqual({ token: TOKEN, password: 'buena-clave' });
    expect(await screen.findByText(T.successPassword)).toBeInTheDocument();
  });

  it.each(['TOO_MANY_PASSWORD_ATTEMPTS', 'RATE_LIMITED'])('429 %s ⇒ Banner warning «Demasiados intentos…»', async (code) => {
    verifyEmail.mockRejectedValue(new ApiClientError(429, { code, message: 'x', details: { retryAfterSeconds: 60 } }));
    renderWithIntl(<VerifyEmailView token={TOKEN} />);
    typePasswordAndSubmit();
    const banner = (await screen.findByText(T.tooManyAttempts)).closest('[data-variant]')!;
    expect(banner).toHaveAttribute('data-variant', 'warning');
    expect(screen.getByLabelText(T.password)).toBeInTheDocument();
  });

  it.each([
    ['modo contraseña', false],
    ['modo nueva', true],
  ])('422 ⇒ «El enlace ya se usó o caducó» + «Mandar otro», sin formulario (%s)', async (_l, newMode) => {
    verifyEmail.mockRejectedValue(new ApiClientError(422, { code: 'EMAIL_VERIFY_TOKEN_INVALID', message: 'x' }));
    forgotPassword.mockResolvedValue({ ok: true });
    renderWithIntl(<VerifyEmailView token={TOKEN} />);
    if (newMode) {
      toNewPasswordMode();
      fireEvent.change(screen.getByLabelText(T.newPassword), { target: { value: 'nueva-clave-1' } });
      fireEvent.change(screen.getByLabelText(T.confirm), { target: { value: 'nueva-clave-1' } });
      fireEvent.click(screen.getByRole('button', { name: T.submitNew }));
    } else typePasswordAndSubmit();
    expect(await screen.findByText(es.accountSetup.invalidTitle)).toBeInTheDocument();
    expect(screen.queryByLabelText(T.password)).toBeNull();
    expect(screen.queryByLabelText(T.newPassword)).toBeNull();
    // Sin sesión: correo + forgot-password (como §CTA-UX.3)
    fireEvent.change(await screen.findByLabelText(es.accountSetup.email), { target: { value: 'ana@x.mx' } });
    fireEvent.click(screen.getByRole('button', { name: es.accountSetup.sendAnother }));
    await waitFor(() => expect(forgotPassword).toHaveBeenCalledWith('ana@x.mx'));
  });

  it('422 con sesión ⇒ «Mandar otro» usa verify-email/resend', async () => {
    setStoredUser({ id: 'u', email: 'ana@x.mx', name: 'ana', role: 'customer', locale: 'es', emailVerified: false });
    verifyEmail.mockRejectedValue(new ApiClientError(422, { code: 'EMAIL_VERIFY_TOKEN_INVALID', message: 'x' }));
    resendVerificationEmail.mockResolvedValue({ ok: true });
    renderWithIntl(<VerifyEmailView token={TOKEN} />);
    typePasswordAndSubmit();
    fireEvent.click(await screen.findByRole('button', { name: es.accountSetup.sendAnother }));
    await waitFor(() => expect(resendVerificationEmail).toHaveBeenCalledTimes(1));
    expect(forgotPassword).not.toHaveBeenCalled();
  });

  /**
   * M-1 (QA sobre `36f93c98`): con sesión de una cuenta YA verificada, `verify-email/resend` es un no-op que responde
   * `{ok:true}` (backend `auth.service.ts` `resendVerification`: `if (u.emailVerified) return null`). «Mandar otro»
   * pintaría «enviado» sin que salga ningún correo. Mutación: quitar la rama `emailVerified` de `TokenLinkInvalid`.
   */
  it.each([
    ['es', es, '/account'],
    ['en', en, '/account'],
  ] as const)(
    'M-1 · enlace usado con sesión de cuenta YA verificada (%s) ⇒ sin «Mandar otro»: dice que ya está confirmado e «Ir a mi cuenta»',
    async (locale, M, href) => {
      setStoredUser({ id: 'u', email: 'ana@x.mx', name: 'ana', role: 'customer', locale, emailVerified: true });
      verifyEmail.mockRejectedValue(new ApiClientError(422, { code: 'EMAIL_VERIFY_TOKEN_INVALID', message: 'x' }));
      resendVerificationEmail.mockResolvedValue({ ok: true });
      renderWithIntl(<VerifyEmailView token={TOKEN} />, locale);
      fireEvent.change(screen.getByLabelText(M.verifyEmailPage.password), { target: { value: 'mi-clave-123' } });
      fireEvent.click(screen.getByRole('button', { name: M.verifyEmailPage.submit }));
      const banner = (await screen.findByText(M.accountSetup.alreadyVerified)).closest('[data-variant]')!;
      expect(banner).toHaveAttribute('role', 'status');
      expect(screen.getByRole('link', { name: M.verifyEmailPage.goToAccount })).toHaveAttribute('href', href);
      expect(screen.queryByRole('button', { name: M.accountSetup.sendAnother })).toBeNull();
      expect(screen.queryByText(M.accountSetup.sent)).toBeNull();
      expect(resendVerificationEmail).not.toHaveBeenCalled();
      expect(forgotPassword).not.toHaveBeenCalled();
    },
  );

  it('M-1 · sin token y con sesión de cuenta YA verificada ⇒ tampoco ofrece «Mandar otro»', async () => {
    setStoredUser({ id: 'u', email: 'ana@x.mx', name: 'ana', role: 'customer', locale: 'es', emailVerified: true });
    renderWithIntl(<VerifyEmailView token={undefined} />);
    expect(await screen.findByText(es.accountSetup.alreadyVerified)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: es.accountSetup.sendAnother })).toBeNull();
  });

  it('sin token ⇒ directo al estado de enlace vencido, sin formulario ni petición', async () => {
    renderWithIntl(<VerifyEmailView token={undefined} />);
    await settle();
    expect(screen.getByText(es.accountSetup.invalidTitle)).toBeInTheDocument();
    expect(screen.queryByLabelText(T.password)).toBeNull();
    expect(verifyEmail).not.toHaveBeenCalled();
  });

  it('«Listo» en modo contraseña sin sesión ⇒ «Entrar» → /login, con estilo de Button primary y foco', async () => {
    verifyEmail.mockResolvedValue({ verified: true });
    renderWithIntl(<VerifyEmailView token={TOKEN} />);
    typePasswordAndSubmit();
    const banner = (await screen.findByText(T.successPassword)).closest('[data-variant]')!;
    expect(banner).toHaveAttribute('data-variant', 'success');
    expect(banner).toHaveAttribute('role', 'status');
    const a = screen.getByRole('link', { name: T.signIn });
    expect(a).toHaveAttribute('href', '/login');
    expect(a).toHaveClass('bg-primary', 'uppercase', 'min-h-[44px]');
    expect(a.className).not.toMatch(/\brounded/);
    expect(a).toHaveFocus();
  });

  it('«Listo» en modo contraseña con sesión ⇒ «Ir a mi cuenta» → /account', async () => {
    setStoredUser({ id: 'u', email: 'ana@x.mx', name: 'ana', role: 'customer', locale: 'es', emailVerified: false });
    verifyEmail.mockResolvedValue({ verified: true });
    renderWithIntl(<VerifyEmailView token={TOKEN} />);
    typePasswordAndSubmit();
    const a = await screen.findByRole('link', { name: T.goToAccount });
    expect(a).toHaveAttribute('href', '/account');
  });

  it('«Listo» en modo nueva CON sesión ⇒ «Entrar» → /login (la sesión se revocó; nunca «Ir a mi cuenta»)', async () => {
    setStoredUser({ id: 'u', email: 'ana@x.mx', name: 'ana', role: 'customer', locale: 'es', emailVerified: false });
    verifyEmail.mockResolvedValue({ verified: true, deviceToken: 'd' });
    renderWithIntl(<VerifyEmailView token={TOKEN} />);
    toNewPasswordMode();
    fireEvent.change(screen.getByLabelText(T.newPassword), { target: { value: 'nueva-clave-1' } });
    fireEvent.change(screen.getByLabelText(T.confirm), { target: { value: 'nueva-clave-1' } });
    fireEvent.click(screen.getByRole('button', { name: T.submitNew }));
    expect(await screen.findByRole('link', { name: T.signIn })).toHaveAttribute('href', '/login');
    expect(screen.queryByRole('link', { name: T.goToAccount })).toBeNull();
  });

  it('403 USER_BLOCKED ⇒ aviso de cuenta bloqueada; error desconocido ⇒ genérico', async () => {
    verifyEmail
      .mockRejectedValueOnce(new ApiClientError(403, { code: 'USER_BLOCKED', message: 'x' }))
      .mockRejectedValueOnce(new ApiClientError(500, { code: 'INTERNAL', message: 'x' }));
    renderWithIntl(<VerifyEmailView token={TOKEN} />);
    typePasswordAndSubmit();
    expect(await screen.findByText(T.blocked)).toBeInTheDocument();
    typePasswordAndSubmit();
    expect(await screen.findByText(T.genericError)).toBeInTheDocument();
  });

  it('EN: título, modo nueva y «Sign in»', async () => {
    verifyEmail.mockResolvedValue({ verified: true });
    renderWithIntl(<VerifyEmailView token={TOKEN} />, 'en');
    expect(screen.getByRole('heading', { name: en.verifyEmailPage.title })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(en.verifyEmailPage.password), { target: { value: 'x-password' } });
    fireEvent.click(screen.getByRole('button', { name: en.verifyEmailPage.submit }));
    expect(await screen.findByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
  });
});

/** Paridad ES/EN del namespace de la página (DESIGN_SYSTEM §CTA-UX.3b, petición 6). */
describe('CTA-UX.3b · claves de verifyEmailPage con paridad', () => {
  it('mismas claves y ninguna vacía', () => {
    expect(Object.keys(en.verifyEmailPage).sort()).toEqual(Object.keys(es.verifyEmailPage).sort());
    for (const v of [...Object.values(es.verifyEmailPage), ...Object.values(en.verifyEmailPage)]) {
      expect(typeof v === 'string' && v.trim().length > 0).toBe(true);
    }
  });
  it('textos de §CTA-UX.3b tal cual', () => {
    expect(es.verifyEmailPage.title).toBe('Confirma tu correo');
    expect(en.verifyEmailPage.title).toBe('Confirm your email');
    expect(es.verifyEmailPage.toNewPassword).toBe('¿No creaste esta cuenta o no recuerdas la contraseña?');
    expect(en.verifyEmailPage.toNewPassword).toBe("Didn't create this account, or don't remember the password?");
    expect(es.verifyEmailPage.wrongPasswordBody).toBe('El enlace sigue sirviendo, pero cada intento fallido cuenta.');
    expect(en.verifyEmailPage.successNewPassword).toBe(
      'We confirmed your email and changed your password. Sign in with the new one.',
    );
  });
});
