import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { setStoredUser } from '@/lib/session';
import { readGoogleSignup, stashGoogleSignup, trackSignupPhone } from '@/lib/api/google-signup';
import { filterParams } from '@/lib/measurement/track';
import { normalizePhoneInput } from '@/lib/phone';
import { toAddressPayload, validateGuestForm, type GuestFormState } from '@/app/[locale]/(storefront)/checkout/guest-validation';
import { InlineAuthPanel } from '@/app/[locale]/(storefront)/checkout/InlineAuthPanel';
import { GoogleSignupComplete } from './GoogleSignupComplete';
import { GoogleSignInButton } from './GoogleSignInButton';
import { ClaimPhonePrompt } from './claimable/ClaimPhonePrompt';
import { ClaimableOrdersNotice } from './claimable/ClaimableOrdersNotice';

/** §CELULAR-ALTA (`API_CONTRACT_CELULAR.md` §6): celular al CREAR la cuenta. Sin SMS. */

const nav = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), pathname: '/checkout' }));
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ replace: nav.replace, push: nav.push }),
  usePathname: () => nav.pathname,
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const trackSpy = vi.hoisted(() => vi.fn());
vi.mock('@/lib/measurement/track', async (orig) => ({ ...(await orig<object>()), track: trackSpy }));

beforeEach(() => {
  vi.restoreAllMocks();
  nav.replace.mockReset();
  nav.push.mockReset();
  trackSpy.mockReset();
  window.sessionStorage.clear();
  window.localStorage.clear();
});

describe('1 · Google nuevo: «Completa tu cuenta»', () => {
  const stash = () => stashGoogleSignup({ signupToken: 'tok-1', email: 'nueva@gmail.com', name: 'Nueva' });

  it('pendingSignup ⇒ el botón guarda el token en sessionStorage (no en la URL) y manda a /completa-cuenta; sin sesión', async () => {
    vi.spyOn(api, 'loginWithGoogle').mockResolvedValue({ pendingSignup: { signupToken: 'tok-1', email: 'nueva@gmail.com', name: 'Nueva' } });
    const onSuccess = vi.fn();
    const onPending = vi.fn();
    renderWithProviders(<GoogleSignInButton onSuccess={onSuccess} next="/cuenta" onPendingSignup={onPending} />, 'es');
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(onPending).toHaveBeenCalled());
    const url = String(onPending.mock.calls[0]![0]);
    expect(url).toBe('/completa-cuenta?next=%2Fcuenta');
    expect(url).not.toContain('tok-1');
    expect(readGoogleSignup()?.signupToken).toBe('tok-1');
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('cuenta Google existente ⇒ entra directo (onSuccess), sin pasar por el celular', async () => {
    const user = { id: 'u', email: 'a@b.mx', name: 'A', role: 'customer', locale: 'es' } as never;
    vi.spyOn(api, 'loginWithGoogle').mockResolvedValue({ user, accessToken: 'a', refreshToken: 'r' });
    const onSuccess = vi.fn();
    renderWithProviders(<GoogleSignInButton onSuccess={onSuccess} />, 'es');
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
  });

  it('el botón «Crear mi cuenta» exige 10 dígitos válidos; al enviar llama complete con el celular NORMALIZADO y va a `next`', async () => {
    stash();
    const spy = vi.spyOn(api, 'completeGoogleSignup').mockResolvedValue({ user: { role: 'customer' } } as never);
    renderWithProviders(<GoogleSignupComplete next="/checkout" />, 'es');
    expect(await screen.findByText('Completa tu cuenta')).toBeInTheDocument();
    const btn = screen.getByRole('button', { name: 'Crear mi cuenta' });
    const field = screen.getByLabelText('Celular (10 dígitos)');
    fireEvent.change(field, { target: { value: '0000000000' } });
    expect(btn).toBeDisabled();
    fireEvent.change(field, { target: { value: '+52 55 1234 5678' } });
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ signupToken: 'tok-1', phone: '5512345678' }));
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/checkout'));
    expect(readGoogleSignup()).toBeNull();
  });

  it('token caducado (401 SIGNUP_EXPIRED) ⇒ mensaje claro y volver a empezar', async () => {
    stash();
    vi.spyOn(api, 'completeGoogleSignup').mockRejectedValue(new ApiClientError(401, { code: 'SIGNUP_EXPIRED', message: 'x' }));
    renderWithProviders(<GoogleSignupComplete />, 'es');
    fireEvent.change(await screen.findByLabelText('Celular (10 dígitos)'), { target: { value: '5512345678' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear mi cuenta' }));
    expect(await screen.findByText('Se acabó el tiempo. Vuelve a entrar con Google.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Volver a empezar' })).toHaveAttribute('href', '/login');
    expect(readGoogleSignup()).toBeNull();
  });

  it('sin token (recarga en otra pestaña) ⇒ el mismo mensaje, nunca un formulario que no puede enviar', async () => {
    renderWithProviders(<GoogleSignupComplete />, 'en');
    expect(await screen.findByText('Time ran out. Sign in with Google again.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create my account' })).toBeNull();
  });

  it('422 ⇒ error en línea; red ⇒ otro mensaje (el número no tiene la culpa)', async () => {
    stash();
    const spy = vi.spyOn(api, 'completeGoogleSignup').mockRejectedValueOnce(new ApiClientError(422, { code: 'PHONE_INVALID', message: 'x' }));
    renderWithProviders(<GoogleSignupComplete />, 'es');
    const f = await screen.findByLabelText('Celular (10 dígitos)');
    fireEvent.change(f, { target: { value: '5512345678' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear mi cuenta' }));
    expect(await screen.findByText('Escribe un celular de 10 dígitos')).toBeInTheDocument();
    spy.mockRejectedValueOnce(new Error('network'));
    fireEvent.click(screen.getByRole('button', { name: 'Crear mi cuenta' }));
    expect(await screen.findByText(/No pudimos guardarlo/)).toBeInTheDocument();
  });
});

describe('3 · Invitado: validación estricta del celular', () => {
  const base = (phone: string): GuestFormState =>
    ({
      email: 'a@b.mx',
      emailConfirmed: true,
      acceptedTerms: true,
      address: { recipientName: 'Ash', line1: 'Calle 1', neighborhood: 'Centro', city: 'CDMX', state: 'CDMX', postalCode: '06000', country: 'MX', phone },
    }) as GuestFormState;

  for (const bad of ['0000000000', '5555555555', '1234567890', '0123456789', '1555555555', 'abc', '', '123']) {
    it(`«${bad}» ⇒ error de celular`, () => {
      expect(validateGuestForm(base(bad)).phone).toBe('invalid');
    });
  }
  it('«55 1234 5678» y «+52 55-1234-5678» pasan y viajan normalizados', () => {
    expect(validateGuestForm(base('55 1234 5678')).phone).toBeUndefined();
    expect(toAddressPayload(base('+52 55-1234-5678').address).phone).toBe('5512345678');
  });
});

describe('4 · Reclamo: 422 PHONE_REQUIRED ⇒ pedir el celular y reintentar', () => {
  it('ClaimPhonePrompt: inválido ⇒ no envía; válido ⇒ entrega los 10 dígitos', () => {
    const onSubmit = vi.fn();
    renderWithProviders(<ClaimPhonePrompt onSubmit={onSubmit} />, 'es');
    expect(screen.getByText('Para avisarte de tu pedido necesitamos tu celular.')).toBeInTheDocument();
    const f = screen.getByLabelText('Celular (10 dígitos)');
    fireEvent.change(f, { target: { value: '1111111111' } });
    expect(screen.getByRole('button', { name: 'Guardar y vincular mi pedido' })).toBeDisabled();
    fireEvent.change(f, { target: { value: '52 55 1234 5678' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar y vincular mi pedido' }));
    expect(onSubmit).toHaveBeenCalledWith('5512345678');
  });

  it('el aviso de pedidos reclamables: PHONE_REQUIRED ⇒ campo ahí mismo y reintento con `phone`', async () => {
    setStoredUser({ id: 'u-777', email: 'ash@example.com', name: 'Ash', role: 'customer', locale: 'es', emailVerified: true } as never);
    vi.spyOn(api, 'getClaimableOrders').mockResolvedValue([
      { orderId: 'o1', orderNumber: 'TCG-1', status: 'settled', totalCents: 1000, itemCount: 1, createdAt: '2026-08-10T18:20:00Z', settledAt: '2026-08-10T18:22:00Z' },
    ] as never);
    const claim = vi
      .spyOn(api, 'claimGuestOrders')
      .mockRejectedValueOnce(new ApiClientError(422, { code: 'PHONE_REQUIRED', message: 'x', details: { field: 'phone' } }))
      .mockResolvedValueOnce({ claimed: ['o1'], failed: [], addressesSaved: 0 });
    renderWithProviders(<ClaimableOrdersNotice surface="vault" />, 'es');
    fireEvent.click(await screen.findByRole('button', { name: 'Vincular a mi cuenta' }));
    expect(await screen.findByTestId('claim-phone-prompt')).toBeInTheDocument();
    expect(claim).toHaveBeenLastCalledWith(['o1'], undefined);
    fireEvent.change(screen.getByLabelText('Celular (10 dígitos)'), { target: { value: '5512345678' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar y vincular mi pedido' }));
    await waitFor(() => expect(claim).toHaveBeenLastCalledWith(['o1'], '5512345678'));
    await waitFor(() => expect(screen.queryByTestId('claim-phone-prompt')).toBeNull());
  });
});

describe('solo-correo del checkout (§6.3)', () => {
  it('con el celular del comprador válido lo manda sin pedir otro campo', async () => {
    const reg = vi.spyOn(api, 'registerEmailOnly').mockResolvedValue({ user: {} } as never);
    renderWithProviders(<InlineAuthPanel variant="register" defaultEmail="a@b.mx" phone="55 1234 5678" onSuccess={() => {}} />, 'es');
    expect(screen.queryByLabelText('Celular (10 dígitos)')).toBeNull();
    fireEvent.submit(screen.getByRole('button', { name: /crear cuenta/i }).closest('form')!);
    await waitFor(() => expect(reg).toHaveBeenCalledWith(expect.objectContaining({ email: 'a@b.mx', phone: '5512345678' })));
  });
  it('sin celular válido pide el campo y NO crea la cuenta hasta tenerlo', async () => {
    const reg = vi.spyOn(api, 'registerEmailOnly').mockResolvedValue({ user: {} } as never);
    renderWithProviders(<InlineAuthPanel variant="register" defaultEmail="a@b.mx" phone="0000000000" onSuccess={() => {}} />, 'es');
    const f = screen.getByLabelText('Celular (10 dígitos)');
    fireEvent.submit(f.closest('form')!);
    expect(await screen.findByText('Escribe un celular de 10 dígitos')).toBeInTheDocument();
    expect(reg).not.toHaveBeenCalled();
  });
});

describe('5 · Medición sin el número', () => {
  it('`signup_phone_*` llevan solo `method`; la lista cerrada descarta cualquier `phone`', () => {
    trackSignupPhone('shown', 'google');
    trackSignupPhone('done', 'password');
    expect(trackSpy).toHaveBeenNthCalledWith(1, 'signup_phone_shown', { method: 'google' });
    expect(trackSpy).toHaveBeenNthCalledWith(2, 'signup_phone_done', { method: 'password' });
    expect(filterParams('signup_phone_done', { method: 'checkout', phone: '5512345678', email: 'a@b.mx' })).toEqual({ method: 'checkout' });
  });
  it('normalizePhoneInput: pega con +52/52/guiones y topa a 10 dígitos', () => {
    expect(normalizePhoneInput('+52 55-1234-5678')).toBe('5512345678');
    expect(normalizePhoneInput('55 1234 5678 99')).toBe('5512345678');
    expect(normalizePhoneInput('ab55')).toBe('55');
  });
});
