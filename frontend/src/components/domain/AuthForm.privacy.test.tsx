/**
 * LIVE-8 · sitio 2 del aviso de privacidad en `AuthForm` (DESIGN_SYSTEM §80.2 2a/2b; criterio 504;
 * API_CONTRACT v1.84.1 §14.14 E-9). Lo que se vigila es la POSICIÓN: la leyenda se lee antes de
 * «Continuar con Google» al registrarse, y bajo Google al entrar (2b: Google también crea cuenta).
 */
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithIntl } from '@/test/render';
import { PrivacyLinkProvider } from '@/components/legal/PrivacyNoticeLink';
import { AuthForm } from './AuthForm';

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('./GoogleSignInButton', () => ({
  GoogleSignInButton: () => (
    <button type="button" data-testid="google-alt">
      Google
    </button>
  ),
}));

/** Orden de DOM: botón de enviar, leyendas del aviso y Google. */
function order(): string[] {
  const form = document.querySelector('form') as HTMLFormElement;
  return Array.from(form.querySelectorAll('button[type="submit"], [data-testid^="privacy-site-"], [data-testid="google-alt"]')).map(
    (el) => (el.getAttribute('data-testid') ?? 'submit'),
  );
}

describe('LIVE-8 · sitio 2 — AuthForm', () => {
  it('2a · registro: «Crear cuenta» → leyenda (enlazada) → Google', () => {
    renderWithIntl(
      <PrivacyLinkProvider linked>
        <AuthForm mode="register" />
      </PrivacyLinkProvider>,
    );
    expect(order()).toEqual(['submit', 'privacy-site-register', 'google-alt']);
    const p = screen.getByTestId('privacy-site-register');
    expect(p.textContent).toContain('Al crear tu cuenta aceptas los Términos');
    expect(p.querySelector('a[href="/privacidad"]')).toHaveAttribute('target', '_blank');
    expect(p.querySelector('a[href="/terminos"]')).toHaveAttribute('target', '_blank');
    expect(screen.queryByTestId('privacy-site-googleSignIn')).toBeNull();
  });

  it('2b · entrar: Google → leyenda de Google; sin la de registro', () => {
    renderWithIntl(
      <PrivacyLinkProvider linked>
        <AuthForm mode="login" />
      </PrivacyLinkProvider>,
    );
    expect(order()).toEqual(['submit', 'google-alt', 'privacy-site-googleSignIn']);
    expect(screen.getByTestId('privacy-site-googleSignIn').querySelector('a[href="/privacidad"]')).not.toBeNull();
    expect(screen.queryByTestId('privacy-site-register')).toBeNull();
  });

  it('sin página servida: la leyenda sigue entera y sin enlace al aviso', () => {
    renderWithIntl(
      <PrivacyLinkProvider linked={false}>
        <AuthForm mode="register" />
      </PrivacyLinkProvider>,
    );
    const p = screen.getByTestId('privacy-site-register');
    expect(p.querySelector('a[href="/privacidad"]')).toBeNull();
    expect(p.textContent).toContain('y el Aviso de privacidad.');
  });
});
