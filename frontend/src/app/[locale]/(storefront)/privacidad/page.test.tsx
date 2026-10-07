/**
 * LIVE-8 · `/privacidad` con el aviso REAL — LEG-P1 (§14.17): provisional y coherente ⇒ se publica
 * también en producción. LEG-4 (con marcadores ⇒ 404) vive en `page.markers.test.tsx`, con fixture.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithIntl } from '@/test/render';
import { PROVISIONAL_FISCAL_TEXT, privacyNoticeEs } from '@/content/legal/privacidad.es';
import { WISHLIST_PRIVACY_EN, WISHLIST_PRIVACY_ES } from '@/content/legal/privacy-wishlist';
import { PrivacyNoticeView } from './PrivacyNoticeView';

const NOT_FOUND = new Error('NEXT_NOT_FOUND');
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw NOT_FOUND;
  },
}));

import PrivacyPage from './page';

afterEach(() => vi.unstubAllEnvs());

const params = (locale: string) => Promise.resolve({ locale });

describe('LEG-P1 · el aviso real (provisional, §14.17) se publica en producción', () => {
  it('producción de Vercel ⇒ 200 con h1, la frase fija, el contacto y sin aviso de borrador ni corchetes', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    const ui = await PrivacyPage({ params: params('es') });
    const { container } = renderWithIntl(ui);
    expect(screen.getByRole('heading', { level: 1, name: 'Aviso de privacidad' })).toBeInTheDocument();
    expect(screen.queryByText('Borrador — no publicado')).toBeNull();
    expect(container.querySelector('mark')).toBeNull();
    const text = container.textContent ?? '';
    expect(text).toContain(PROVISIONAL_FISCAL_TEXT.replace(/\*\*/g, ''));
    expect(text).toContain('soporte@tcghunt.mx');
    expect(text).not.toMatch(/[[\]]/);
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(10);
  });

  it('servidor sin VERCEL_ENV (falla hacia lo seguro) ⇒ también se sirve: no hay nada que esconder', async () => {
    vi.stubEnv('VERCEL_ENV', '');
    vi.stubEnv('LEGAL_DRAFT_PREVIEW', '');
    await expect(PrivacyPage({ params: params('en') })).resolves.toBeTruthy();
  });
});

describe('PrivacyNoticeView', () => {
  it('en inglés añade «Legal notice available in Spanish only.» y el texto sigue en español', () => {
    renderWithIntl(<PrivacyNoticeView doc={privacyNoticeEs} draft showSpanishOnly />, 'en');
    expect(screen.getByText('Legal notice available in Spanish only.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Privacy notice' })).toBeInTheDocument();
    expect(screen.getByText('1. Quién es el responsable de tus datos.')).toBeInTheDocument();
  });

  it('publicado: sin aviso de borrador, negritas como <strong>, tabla de proveedores', () => {
    const clean = {
      ...privacyNoticeEs,
      updatedAt: '5 de octubre de 2026',
      sections: [
        {
          id: 'x',
          title: '1. Responsable.',
          blocks: [
            { type: 'p' as const, text: '**Ejemplo S.A.** es responsable.' },
            { type: 'table' as const, head: ['Proveedor'], rows: [['**Stripe**']] },
          ],
        },
      ],
    };
    const { container } = renderWithIntl(<PrivacyNoticeView doc={clean} draft={false} showSpanishOnly={false} />);
    expect(screen.queryByText('Borrador — no publicado')).toBeNull();
    expect(container.querySelector('mark')).toBeNull();
    expect(screen.getByText('Ejemplo S.A.').tagName).toBe('STRONG');
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByText(/5 de octubre de 2026/)).toBeInTheDocument();
  });
});

describe('824 · el párrafo «Lista de deseos» se ve en /es/privacidad y en /en/privacidad, sin sesión', () => {
  const plain = (s: string) => s.replace(/\*\*/g, '');

  it('es: el párrafo español literal, y no el inglés', async () => {
    const ui = await PrivacyPage({ params: params('es') });
    const { container } = renderWithIntl(ui);
    const text = container.textContent ?? '';
    expect(text).toContain(plain(WISHLIST_PRIVACY_ES));
    expect(text).not.toContain(plain(WISHLIST_PRIVACY_EN));
    expect(screen.getByText('Lista de deseos.', { selector: 'strong' })).toBeInTheDocument();
  });

  it('en: el párrafo inglés literal (lang="en") junto al aviso en español', async () => {
    const ui = await PrivacyPage({ params: params('en') });
    const { container } = renderWithIntl(ui, 'en');
    const text = container.textContent ?? '';
    expect(text).toContain(plain(WISHLIST_PRIVACY_EN));
    expect(text).toContain(plain(WISHLIST_PRIVACY_ES));
    const en = screen.getByText('Wishlist.', { selector: 'strong' }).closest('p');
    expect(en).toHaveAttribute('lang', 'en');
  });
});
