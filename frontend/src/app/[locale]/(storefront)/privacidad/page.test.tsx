/**
 * LIVE-8 · `/privacidad` — LEG-4: con marcadores, 404 en producción; borrador visible y marcado en
 * la vista previa; publicado sin aviso de borrador.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithIntl } from '@/test/render';
import { privacyNoticeEs } from '@/content/legal/privacidad.es';
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

describe('LEG-4 · la página respeta el candado', () => {
  it('producción de Vercel con el borrador vigente ⇒ notFound (404)', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    await expect(PrivacyPage({ params: params('es') })).rejects.toBe(NOT_FOUND);
  });

  it('sin VERCEL_ENV y sin LEGAL_DRAFT_PREVIEW ⇒ notFound', async () => {
    vi.stubEnv('VERCEL_ENV', '');
    vi.stubEnv('LEGAL_DRAFT_PREVIEW', '');
    await expect(PrivacyPage({ params: params('es') })).rejects.toBe(NOT_FOUND);
  });

  it('vista previa ⇒ borrador con aviso y marcadores resaltados', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    const ui = await PrivacyPage({ params: params('es') });
    const { container } = renderWithIntl(ui);
    expect(screen.getByRole('heading', { level: 1, name: 'Aviso de privacidad' })).toBeInTheDocument();
    expect(screen.getByText('Borrador — no publicado')).toBeInTheDocument();
    const marks = container.querySelectorAll('mark[data-legal-marker]');
    expect(marks.length).toBeGreaterThan(5);
    expect([...marks].some((m) => m.textContent?.includes('DATO DEL DUEÑO'))).toBe(true);
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(10);
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
