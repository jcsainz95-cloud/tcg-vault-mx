/**
 * LIVE-8 · `/privacidad` con el aviso REAL — LEG-P1 (§14.17): provisional y coherente ⇒ se publica
 * también en producción. LEG-4 (con marcadores ⇒ 404) vive en `page.markers.test.tsx`, con fixture.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithIntl } from '@/test/render';
import { PROVISIONAL_FISCAL_TEXT, privacyNoticeEs } from '@/content/legal/privacidad.es';
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
