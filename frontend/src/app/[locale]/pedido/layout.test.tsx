/**
 * LIVE-8 · sitio 7 del aviso de privacidad: pie de la página de seguimiento del invitado
 * (API_CONTRACT §14.14 E-9 lote 3 y §14.17 E4-3; DESIGN_SYSTEM §80.1/§80.2, F-6; criterio 503).
 *
 * Variante `nav`: tras «Términos y políticas», en la MISMA fila y con las mismas clases; misma pestaña;
 * sin página servida no se pinta nada (como el pie de la tienda, sitio 1).
 */
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { PrivacyLinkProvider } from '@/components/legal/PrivacyNoticeLink';
import es from '../../../../messages/es.json';
import en from '../../../../messages/en.json';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/pedido',
}));
vi.mock('@/components/ui/LocaleToggle', () => ({ LocaleToggle: () => <span data-testid="locale-toggle" /> }));

import PublicTrackingLayout from './layout';

function renderLayout(linked: boolean, locale: 'es' | 'en' = 'es') {
  return renderWithProviders(
    <PrivacyLinkProvider linked={linked}>
      <PublicTrackingLayout>
        <p>contenido</p>
      </PublicTrackingLayout>
    </PrivacyLinkProvider>,
    locale,
  );
}

describe('LIVE-8 · sitio 7 — pie del seguimiento del invitado', () => {
  it('con la página servida: «Aviso de privacidad» tras «Términos», misma fila, misma pestaña, mismas clases', () => {
    renderLayout(true);
    const footer = document.querySelector('footer')!;
    const terms = footer.querySelector('a[href="/terminos"]')!;
    const privacy = footer.querySelector('a[href="/privacidad"]')!;
    expect(terms).not.toBeNull();
    expect(privacy).not.toBeNull();
    expect(privacy.textContent).toBe(es.privacy.link);
    expect(privacy).not.toHaveAttribute('target');
    expect(privacy.querySelector('svg')).toBeNull();
    expect(privacy.className).toBe(terms.className);
    // Misma fila: hermanos, y el aviso va DESPUÉS de términos.
    expect(privacy.parentElement).toBe(terms.parentElement);
    expect(terms.compareDocumentPosition(privacy) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Aviso de privacidad' })).toBe(privacy);
  });

  it('en inglés: «Privacy notice»', () => {
    renderLayout(true, 'en');
    expect(document.querySelector('footer a[href="/privacidad"]')!.textContent).toBe(en.privacy.link);
  });

  it('sin página servida: no se pinta nada (ni enlace ni texto), y «Términos» sigue', () => {
    renderLayout(false);
    const footer = document.querySelector('footer')!;
    expect(footer.querySelector('a[href="/privacidad"]')).toBeNull();
    expect(footer.textContent).not.toContain(es.privacy.link);
    expect(footer.querySelector('a[href="/terminos"]')).not.toBeNull();
  });
});
