import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { renderWithIntl } from '@/test/render';
import { VerifyEmailBanner, isVerifyBannerPath } from './VerifyEmailBanner';
import type { UserDTO } from '@/types/contract';

let currentPath: string | null = '/es/account';
vi.mock('next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/navigation')>();
  return { ...actual, usePathname: () => currentPath };
});

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

afterEach(() => {
  vi.clearAllMocks();
  currentPath = '/es/account';
});

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

/**
 * **UX-13** (`DESIGN_SYSTEM §42.7`, nota N-2): una cuenta del equipo SIN correo trae `emailVerified:false` (CHECK 4)
 * y no tiene correo que verificar ⇒ el banner no se pinta. Canario: quitar `&& email != null`.
 */
describe('UX-13 · VerifyEmailBanner sin correo', () => {
  it('`emailVerified:false, email:null` ⇒ no pinta nada', () => {
    sessionValue = {
      user: user({ email: null, username: 'ana', role: 'vault_operator', emailVerified: false }),
      isAuthenticated: true,
      ready: true,
    };
    const { container } = renderWithIntl(<VerifyEmailBanner />);
    expect(container).toBeEmptyDOMElement();
  });
});

/**
 * DESIGN_SYSTEM §CTA-UX.6 petición 9 (contrato §CTA.5: comprar ya no exige correo verificado). El aviso deja de ser
 * global: solo donde la verificación desbloquea algo — `/account` (Mi cuenta), `/orders` (ver y reclamar pedidos
 * anteriores: `GET /orders/claimable`, `POST /orders/claim`), `/buylist` (vender: `POST /buylist/requests`; la
 * petición dice «/sell», ruta que no existe en el árbol) y `/shipments` (retiro de bóveda: `POST /shipments`). Nunca en
 * catálogo, ficha, carrito ni `/checkout`. Y el botón dice lo que el servidor manda (§CTA.5 `verify-email/resend`):
 * cuenta pendiente ⇒ «Reenviar enlace para terminar tu cuenta» (manda «Termina tu cuenta»).
 * Mutaciones: volver a pintar fuera de esas rutas; botón fijo «Reenviar correo de verificación».
 */
describe('CTA-UX.6 (9) · el aviso solo donde verificar desbloquea algo', () => {
  it.each([
    '/es/account',
    '/en/account/password',
    '/es/orders',
    '/es/orders/o-1',
    '/es/buylist',
    '/en/buylist/requests',
    '/es/shipments',
    '/es/shipments/s-1',
  ])('se pinta en %s', (path) => {
    currentPath = path;
    sessionValue = { user: user({ emailVerified: false }), isAuthenticated: true, ready: true };
    renderWithIntl(<VerifyEmailBanner />);
    expect(screen.getByText('Verifica tu correo')).toBeInTheDocument();
  });

  it.each([
    '/es',
    '/es/catalog',
    '/es/catalog/abc',
    '/es/sellado/xyz',
    '/es/checkout',
    '/en/checkout/',
    '/es/vault',
    '/es/accounts',
    '/es/lista-de-deseos',
  ])('NO se pinta en %s', (path) => {
    currentPath = path;
    sessionValue = { user: user({ emailVerified: false }), isAuthenticated: true, ready: true };
    const { container } = renderWithIntl(<VerifyEmailBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('sin ruta conocida ⇒ no se pinta', () => {
    expect(isVerifyBannerPath(null)).toBe(false);
    expect(isVerifyBannerPath(undefined)).toBe(false);
  });

  it('cuenta pendiente (sin contraseña) ⇒ «Reenviar enlace para terminar tu cuenta»; enviado ⇒ «otro enlace»', async () => {
    resendVerificationEmail.mockResolvedValueOnce({ ok: true });
    sessionValue = {
      user: user({ emailVerified: false, accountSetupPending: true, hasPassword: false }),
      isAuthenticated: true,
      ready: true,
    };
    renderWithIntl(<VerifyEmailBanner />);
    expect(screen.queryByRole('button', { name: /Reenviar correo de verificación/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Reenviar enlace para terminar tu cuenta' }));
    expect(await screen.findByText('Te mandamos otro enlace. Revisa tu correo.')).toBeInTheDocument();
  });

  it('con contraseña y sin verificar ⇒ «Reenviar correo de verificación»', () => {
    sessionValue = {
      user: user({ emailVerified: false, accountSetupPending: false, hasPassword: true }),
      isAuthenticated: true,
      ready: true,
    };
    renderWithIntl(<VerifyEmailBanner />);
    expect(screen.getByRole('button', { name: 'Reenviar correo de verificación' })).toBeInTheDocument();
  });
});
