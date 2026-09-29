import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { DecksMetaListView } from './DecksMetaListView';
import * as api from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import type { DecksMetaListResponse } from '@/types/contract';

vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn() }),
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const response: DecksMetaListResponse = {
  data: [
    { slug: 'dragapult-ex', name: 'Dragapult ex', rank: 1, sharePct: 12.4, trend: 1, fromPriceMxnCents: 184500, availableCount: 52, totalCount: 60, imageUrl: 'https://img/d.png' },
    { slug: 'charizard-ex', name: 'Charizard ex', rank: 2, sharePct: 10.1, trend: -1, fromPriceMxnCents: 210000, availableCount: 48, totalCount: 60, imageUrl: 'https://img/c.png' },
  ],
  updatedAt: '2026-09-14T12:00:00Z',
  source: 'Datos de Limitless TCG',
};

beforeEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('DecksMetaListView · top-10 del meta', () => {
  it('pinta las tejas con rank, nombre, disponibilidad y «desde», más la cita de fuente', async () => {
    vi.spyOn(api, 'getDecksMeta').mockResolvedValue(response);
    renderWithProviders(<DecksMetaListView />, 'es');

    expect(await screen.findByRole('link', { name: /Dragapult ex/ })).toHaveAttribute('href', '/decks-meta/dragapult-ex');
    expect(screen.getByText('#1')).toBeInTheDocument();
    expect(screen.getByText('52 de 60 disponibles')).toBeInTheDocument();
    expect(screen.getByText('Desde MX$1,845.00')).toBeInTheDocument();
    // Cita de fuente obligatoria del contrato §13.
    expect(screen.getByText(/Datos de Limitless TCG/)).toBeInTheDocument();
    // Acceso a «pegar lista».
    expect(screen.getByRole('link', { name: 'Pegar mi lista' })).toHaveAttribute('href', '/decks-meta/pegar');
  });

  it('lista vacía → estado vacío honesto (nunca datos inventados)', async () => {
    vi.spyOn(api, 'getDecksMeta').mockResolvedValue({ ...response, data: [] });
    renderWithProviders(<DecksMetaListView />, 'es');
    expect(await screen.findByText('Aún no hay decks publicados')).toBeInTheDocument();
  });

  it('error → banner del contrato con reintento', async () => {
    vi.spyOn(api, 'getDecksMeta').mockRejectedValue(new ApiClientError(503, { code: 'BUSY_TRY_AGAIN', message: 'busy' }));
    renderWithProviders(<DecksMetaListView />, 'es');
    expect(await screen.findByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });

  it('EN: los rótulos se localizan (paridad es/en)', async () => {
    vi.spyOn(api, 'getDecksMeta').mockResolvedValue(response);
    renderWithProviders(<DecksMetaListView />, 'en');
    expect(await screen.findByText('52 of 60 available')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Paste my list' })).toBeInTheDocument();
  });
});
