import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { renderWithIntl } from '@/test/render';
import { ApiClientError } from '@/lib/api-client';
import { setStoredUser } from '@/lib/session';
import es from '../../../../messages/es.json';
import en from '../../../../messages/en.json';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

/** Orden de los hechos que importan: quitar el token de la barra y cada petición. */
const events: string[] = [];
const verifyEmail = vi.fn();
const resetPassword = vi.fn();
const accountSetup = vi.fn();
const forgotPassword = vi.fn();
const resendVerificationEmail = vi.fn();
function track(name: string, fn: (...a: unknown[]) => unknown) {
  return (...a: unknown[]) => {
    events.push(`api:${name}`);
    return fn(...a);
  };
}
vi.mock('@/lib/api', () => ({
  verifyEmail: (...a: unknown[]) => track('verifyEmail', verifyEmail)(...a),
  resetPassword: (...a: unknown[]) => track('resetPassword', resetPassword)(...a),
  accountSetup: (...a: unknown[]) => track('accountSetup', accountSetup)(...a),
  forgotPassword: (...a: unknown[]) => track('forgotPassword', forgotPassword)(...a),
  resendVerificationEmail: (...a: unknown[]) => track('resendVerificationEmail', resendVerificationEmail)(...a),
}));

import { AccountSetupView } from './account-setup/AccountSetupView';
import { ResetPasswordView } from './reset-password/ResetPasswordView';
import { VerifyEmailView } from './verify-email/VerifyEmailView';

const TOKEN = 'tok-secreto-123';
let realReplace: History['replaceState'];

beforeEach(() => {
  events.length = 0;
  vi.clearAllMocks();
  window.localStorage.clear();
  realReplace = window.history.replaceState.bind(window.history);
  vi.spyOn(window.history, 'replaceState').mockImplementation((data, unused, url) => {
    events.push(`replaceState:${String(url)}`);
    realReplace(data, unused, url);
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

function openWithToken(page: string, locale = 'es') {
  realReplace(null, '', `/${locale}/${page}?token=${TOKEN}&utm_source=mail#x`);
}

function firstApiIndex(): number {
  return events.findIndex((e) => e.startsWith('api:'));
}
function replaceIndex(): number {
  return events.findIndex((e) => e.startsWith('replaceState:'));
}

/**
 * CTA-F4 (API_CONTRACT §CTA.6 regla D-CTA-10 (1), §CTA.9): en `/account-setup`, `/reset-password` y `/verify-email` el
 * token sale de la URL con `history.replaceState` (misma ruta e idioma, sin `token`) ANTES de la primera petición
 * (orden espiado). Mutación: dejar el token en la URL en cualquiera de las tres, o llamar antes de limpiar.
 */
describe('CTA-F4 · las tres páginas con token lo quitan de la URL antes de cualquier petición', () => {
  it.each(['es', 'en'])('/%s/verify-email: replaceState antes del canje, y el canje (al enviar, CTA-F9) lleva el token', async (locale) => {
    openWithToken('verify-email', locale);
    verifyEmail.mockResolvedValue({ verified: true });
    renderWithIntl(<VerifyEmailView token={TOKEN} />, locale as 'es' | 'en');
    const T = (locale === 'es' ? es : en).verifyEmailPage;
    expect(window.location.href).not.toContain(TOKEN);
    fireEvent.change(screen.getByLabelText(T.password), { target: { value: 'mi-clave-1' } });
    fireEvent.click(screen.getByRole('button', { name: T.submit }));
    await waitFor(() => expect(verifyEmail).toHaveBeenCalledWith({ token: TOKEN, password: 'mi-clave-1' }));
    expect(window.location.pathname).toBe(`/${locale}/verify-email`);
    expect(window.location.search).toBe('?utm_source=mail');
    expect(window.location.href).not.toContain(TOKEN);
    expect(replaceIndex()).toBeGreaterThanOrEqual(0);
    expect(replaceIndex()).toBeLessThan(firstApiIndex());
  });

  it('/reset-password: al abrir ya no está el token en la URL; la petición lleva el de la prop', async () => {
    openWithToken('reset-password');
    resetPassword.mockResolvedValue({ ok: true, deviceToken: 'd' });
    renderWithIntl(<ResetPasswordView token={TOKEN} />);
    expect(window.location.href).not.toContain(TOKEN);
    expect(window.location.pathname).toBe('/es/reset-password');
    fireEvent.change(screen.getByLabelText('Nueva contraseña'), { target: { value: 'longenough1' } });
    fireEvent.change(screen.getByLabelText('Confirmar contraseña'), { target: { value: 'longenough1' } });
    fireEvent.click(screen.getByRole('button', { name: /Cambiar contraseña/ }));
    await waitFor(() => expect(resetPassword).toHaveBeenCalledWith({ token: TOKEN, password: 'longenough1' }));
    expect(replaceIndex()).toBeLessThan(firstApiIndex());
  });

  it('/account-setup: al abrir ya no está el token en la URL; la petición lleva el de la prop', async () => {
    openWithToken('account-setup');
    accountSetup.mockResolvedValue({ ok: true, deviceToken: 'd' });
    renderWithIntl(<AccountSetupView token={TOKEN} />);
    expect(window.location.href).not.toContain(TOKEN);
    expect(window.location.pathname).toBe('/es/account-setup');
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: ' Ana ' } });
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'longenough1' } });
    fireEvent.change(screen.getByLabelText('Confirmar contraseña'), { target: { value: 'longenough1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(accountSetup).toHaveBeenCalledWith({ token: TOKEN, name: 'Ana', password: 'longenough1' }));
    expect(replaceIndex()).toBeLessThan(firstApiIndex());
  });
});

/** CTA-F4 (segunda mitad) · `/account-setup`: `200` ⇒ «Listo» + entrar; `422` ⇒ «Mandar otro». Criterio 971. */
describe('CTA-F4 · «Termina tu cuenta»', () => {
  function submit() {
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Ana' } });
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'longenough1' } });
    fireEvent.change(screen.getByLabelText('Confirmar contraseña'), { target: { value: 'longenough1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
  }

  it('pide nombre y contraseña; 200 ⇒ «Listo» y enlace a entrar, sin sesión', async () => {
    openWithToken('account-setup');
    accountSetup.mockResolvedValue({ ok: true, deviceToken: 'd' });
    renderWithIntl(<AccountSetupView token={TOKEN} />);
    submit();
    expect(await screen.findByText('Listo')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Entrar' })).toHaveAttribute('href', '/login');
  });

  it('valida antes de pedir: contraseña corta no llama al servidor (no quema el enlace)', async () => {
    renderWithIntl(<AccountSetupView token={TOKEN} />);
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Ana' } });
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'corta' } });
    fireEvent.change(screen.getByLabelText('Confirmar contraseña'), { target: { value: 'corta' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByText('La contraseña debe tener al menos 8 caracteres.')).toBeInTheDocument();
    expect(accountSetup).not.toHaveBeenCalled();
  });

  it('422 sin sesión ⇒ «El enlace ya se usó o caducó», pide el correo y llama a forgot-password', async () => {
    accountSetup.mockRejectedValue(new ApiClientError(422, { code: 'ACCOUNT_SETUP_TOKEN_INVALID', message: 'x' }));
    forgotPassword.mockResolvedValue({ ok: true });
    renderWithIntl(<AccountSetupView token={TOKEN} />);
    submit();
    expect(await screen.findByText('El enlace ya se usó o caducó')).toBeInTheDocument();
    fireEvent.change(await screen.findByLabelText('Correo'), { target: { value: 'ana@x.mx' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mandar otro' }));
    await waitFor(() => expect(forgotPassword).toHaveBeenCalledWith('ana@x.mx'));
    expect(resendVerificationEmail).not.toHaveBeenCalled();
    expect(await screen.findByText(/te mandamos otro enlace/)).toBeInTheDocument();
  });

  it('422 con sesión ⇒ «Mandar otro» usa verify-email/resend (sin pedir el correo)', async () => {
    setStoredUser({ id: 'u', email: 'ana@x.mx', name: 'ana', role: 'customer', locale: 'es', emailVerified: false });
    accountSetup.mockRejectedValue(new ApiClientError(422, { code: 'ACCOUNT_SETUP_TOKEN_INVALID', message: 'x' }));
    resendVerificationEmail.mockResolvedValue({ ok: true });
    renderWithIntl(<AccountSetupView token={TOKEN} />);
    submit();
    fireEvent.click(await screen.findByRole('button', { name: 'Mandar otro' }));
    await waitFor(() => expect(resendVerificationEmail).toHaveBeenCalledTimes(1));
    expect(forgotPassword).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Correo')).toBeNull();
  });

  it('sin token en la URL ⇒ directo a «Mandar otro», sin petición', () => {
    renderWithIntl(<AccountSetupView token={undefined} />);
    expect(screen.getByText('El enlace ya se usó o caducó')).toBeInTheDocument();
    expect(accountSetup).not.toHaveBeenCalled();
  });
});

/**
 * DESIGN_SYSTEM §CTA-UX.3 (vCTA-1, petición 3) — los botones-enlace de las páginas con token llevan el estilo de
 * `Button` primary (recto, §4.2; etiqueta en versalitas, §6.1), no el `rounded-md` en minúsculas de antes; y los avisos
 * de tope y error de «Mandar otro» son `Banner` (no un `<p>` en `text-warning`/`text-danger` de contraste no medido).
 * Mutaciones: devolver el `className` viejo a cualquiera de los enlaces; devolver el `<p>` a cualquiera de los avisos.
 */
describe('CTA-UX.3 · botones-enlace como Button primary y avisos como Banner', () => {
  function expectPrimaryButtonLink(a: HTMLElement) {
    expect(a.tagName).toBe('A');
    expect(a).toHaveClass('bg-primary', 'text-primary-fg', 'uppercase', 'tracking-label', 'min-h-[44px]');
    expect(a.className).not.toMatch(/\brounded/);
  }
  function submitSetup() {
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Ana' } });
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'longenough1' } });
    fireEvent.change(screen.getByLabelText('Confirmar contraseña'), { target: { value: 'longenough1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
  }

  it('/account-setup «Listo»: «Entrar» es un enlace con estilo de Button primary', async () => {
    accountSetup.mockResolvedValue({ ok: true, deviceToken: 'd' });
    renderWithIntl(<AccountSetupView token={TOKEN} />);
    submitSetup();
    expectPrimaryButtonLink(await screen.findByRole('link', { name: 'Entrar' }));
  });

  it('/account-setup EN: «Sign in»', async () => {
    accountSetup.mockResolvedValue({ ok: true, deviceToken: 'd' });
    renderWithIntl(<AccountSetupView token={TOKEN} />, 'en');
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ana' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'longenough1' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'longenough1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expectPrimaryButtonLink(await screen.findByRole('link', { name: 'Sign in' }));
  });

  it('/reset-password: «Iniciar sesión» (éxito) y «Solicitar otro enlace» (enlace caducado) con estilo de Button primary', async () => {
    resetPassword.mockResolvedValue({ ok: true, deviceToken: 'd' });
    const { unmount } = renderWithIntl(<ResetPasswordView token={TOKEN} />);
    fireEvent.change(screen.getByLabelText('Nueva contraseña'), { target: { value: 'longenough1' } });
    fireEvent.change(screen.getByLabelText('Confirmar contraseña'), { target: { value: 'longenough1' } });
    fireEvent.click(screen.getByRole('button', { name: /Cambiar contraseña/ }));
    expectPrimaryButtonLink(await screen.findByRole('link', { name: 'Iniciar sesión' }));
    unmount();
    renderWithIntl(<ResetPasswordView token={undefined} />);
    expectPrimaryButtonLink(screen.getByRole('link', { name: 'Solicitar otro enlace' }));
  });

  it('/verify-email (misma familia de páginas con token): «Entrar» con estilo de Button primary (§CTA-UX.3b)', async () => {
    verifyEmail.mockResolvedValue({ verified: true });
    renderWithIntl(<VerifyEmailView token={TOKEN} />);
    fireEvent.change(screen.getByLabelText(es.verifyEmailPage.password), { target: { value: 'mi-clave-1' } });
    fireEvent.click(screen.getByRole('button', { name: es.verifyEmailPage.submit }));
    expectPrimaryButtonLink(await screen.findByRole('link', { name: 'Entrar' }));
  });

  it('«Mandar otro» sin sesión con tope ⇒ Banner warning role=alert', async () => {
    forgotPassword.mockRejectedValue(new ApiClientError(429, { code: 'RATE_LIMITED', message: 'x' }));
    renderWithIntl(<AccountSetupView token={undefined} />);
    fireEvent.change(await screen.findByLabelText('Correo'), { target: { value: 'ana@x.mx' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mandar otro' }));
    const text = await screen.findByText('Ya pediste varios enlaces. Espera un rato y vuelve a intentarlo.');
    const banner = text.closest('[data-variant]')!;
    expect(banner).toHaveAttribute('data-variant', 'warning');
    expect(banner).toHaveAttribute('role', 'alert');
  });

  it.each([
    ['RATE_LIMITED', 'Ya pediste varios enlaces. Espera un rato y vuelve a intentarlo.', 'warning'],
    ['BOOM', 'No se pudo completar. Inténtalo de nuevo.', 'danger'],
  ] as const)('«Mandar otro» con sesión, %s ⇒ Banner %s', async (code, msg, variant) => {
    setStoredUser({ id: 'u', email: 'ana@x.mx', name: 'ana', role: 'customer', locale: 'es', emailVerified: false });
    resendVerificationEmail.mockRejectedValue(new ApiClientError(code === 'BOOM' ? 500 : 429, { code, message: 'x' }));
    renderWithIntl(<AccountSetupView token={undefined} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Mandar otro' }));
    const banner = (await screen.findByText(msg)).closest('[data-variant]')!;
    expect(banner).toHaveAttribute('data-variant', variant);
    expect(banner).toHaveAttribute('role', 'alert');
  });
});
