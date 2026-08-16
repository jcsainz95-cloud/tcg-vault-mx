import { describe, it, expect, afterEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithIntl } from '@/test/render';
import { AuthForm } from './AuthForm';
import { config } from '@/lib/config';

// AuthForm y GoogleSignInButton usan next-intl navigation; lo mockeamos.
import { vi } from 'vitest';
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const mockNoticeEs =
  'Autenticación pendiente de backend: el envío simula el flujo y guarda una sesión local.';

describe('AuthForm — aviso de mock', () => {
  const original = config.useMocks;
  afterEach(() => {
    config.useMocks = original;
  });

  it('con mocks activos muestra el banner de sesión simulada', () => {
    config.useMocks = true;
    renderWithIntl(<AuthForm mode="login" />, 'es');
    expect(screen.getByText(mockNoticeEs)).toBeInTheDocument();
  });

  it('con backend real (useMocks=false) NO muestra el banner', () => {
    config.useMocks = false;
    renderWithIntl(<AuthForm mode="login" />, 'es');
    expect(screen.queryByText(mockNoticeEs)).not.toBeInTheDocument();
  });
});
