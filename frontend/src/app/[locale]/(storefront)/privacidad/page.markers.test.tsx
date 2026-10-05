/**
 * LIVE-8 · `/privacidad` — LEG-4 (se queda tras §14.17): con marcadores, 404 en producción; borrador
 * visible y marcado en la vista previa. El aviso real ya no tiene marcadores (modo provisional), así
 * que aquí la página lee un FIXTURE con marcadores (el módulo del aviso, sustituido).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithIntl } from '@/test/render';

const NOT_FOUND = new Error('NEXT_NOT_FOUND');
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw NOT_FOUND;
  },
}));

vi.mock('@/content/legal/privacidad.es', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/content/legal/privacidad.es')>();
  const doc = JSON.parse(JSON.stringify(orig.privacyNoticeEs));
  doc.updatedAt = '[FECHA DE PUBLICACIÓN]';
  doc.sections[0].blocks.push({ type: 'p', text: 'RFC: **[DATO DEL DUEÑO: RFC]**.' });
  return { ...orig, privacyNoticeEs: doc };
});

import PrivacyPage from './page';

afterEach(() => vi.unstubAllEnvs());

const params = (locale: string) => Promise.resolve({ locale });

describe('LEG-4 · la página respeta el candado (texto con marcadores)', () => {
  it('producción de Vercel ⇒ notFound (404)', async () => {
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
    expect(marks.length).toBe(2);
    expect([...marks].some((m) => m.textContent?.includes('DATO DEL DUEÑO'))).toBe(true);
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(10);
  });
});
