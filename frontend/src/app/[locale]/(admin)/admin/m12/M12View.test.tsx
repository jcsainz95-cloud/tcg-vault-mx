import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { M12View } from './M12View';
import * as api from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import type { DecksMetaRefreshReport } from '@/types/contract';

beforeEach(() => {
  vi.restoreAllMocks();
});

function report(over: Partial<DecksMetaRefreshReport> = {}): DecksMetaRefreshReport {
  return {
    mode: 'dryrun',
    formatCode: 'H-F',
    formatLabel: 'Standard (H–F)',
    autopublish: false,
    startedAt: '2026-09-19T12:00:00Z',
    finishedAt: '2026-09-19T12:00:38Z',
    urlsFetched: ['home', 'list/a', 'list/b'],
    decks: [
      { archetypeId: 'dragapult-ex', name: 'Dragapult ex', rank: 1, sharePct: 12.4, listId: 'a', cardsParsed: 18, sumQuantity: 60, matched: 17, total: 18, matchStatusBreakdown: { matched: 17 }, legalityDrops: 0, inBand: true },
      { archetypeId: 'charizard-ex', name: 'Charizard ex', rank: 2, sharePct: 10.1, listId: 'b', cardsParsed: 20, sumQuantity: 60, matched: 20, total: 20, matchStatusBreakdown: { matched: 20 }, legalityDrops: 1, inBand: true },
    ],
    canary: {
      verdict: 'PUBLISH',
      inBandDeckCount: 2,
      reason: null,
      checks: [
        { id: 'C1', ok: true, measured: 2, threshold: 3, label: 'x' },
        { id: 'C2', ok: true, measured: 0, threshold: 0, label: 'x' },
        { id: 'C3', ok: true, measured: 0.97, threshold: 0.9, label: 'x' },
        { id: 'C4', ok: true, measured: 0.03, threshold: 0.1, label: 'x' },
        { id: 'C5', ok: true, measured: 8, threshold: 3, label: 'x' },
      ],
    },
    verdict: 'PUBLISH',
    wouldPublish: true,
    applied: false,
    persistedCount: 0,
    publishedSlugs: [],
    supersededListIds: [],
    manualConflicts: [],
    pausedSkipped: [],
    errors: [],
    ...over,
  };
}

describe('M12View · Ensayo decks meta (dry-run)', () => {
  it('al correr el ensayo pinta el veredicto PUBLICARÍA y una fila por deck', async () => {
    vi.spyOn(api, 'getDecksMetaPreview').mockResolvedValue({ skipped: false, mode: 'dryrun', report: report() });
    renderWithProviders(<M12View />, 'es');

    fireEvent.click(screen.getByRole('button', { name: 'Correr ensayo' }));

    expect(await screen.findByText('PUBLICARÍA')).toBeInTheDocument();
    // Una fila por deck (aparece dos veces: tabla md+ y bloque móvil, por eso getAllByText).
    expect(screen.getAllByText('Dragapult ex').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Charizard ex').length).toBeGreaterThan(0);
    // Los cinco chequeos con su rótulo humano.
    expect(screen.getByText('arquetipos encontrados')).toBeInTheDocument();
    expect(screen.getByText('página principal legible')).toBeInTheDocument();
    // Modo en solo-lectura.
    expect(screen.getByText('ensayo — no publica nada')).toBeInTheDocument();
  });

  it('cuando el canary NO pasa, el veredicto es NO PUBLICARÍA', async () => {
    vi.spyOn(api, 'getDecksMetaPreview').mockResolvedValue({
      skipped: false,
      mode: 'dryrun',
      report: report({
        verdict: 'NO_PUBLISH',
        wouldPublish: false,
        canary: {
          verdict: 'NO_PUBLISH',
          inBandDeckCount: 0,
          reason: 'C1',
          checks: [{ id: 'C1', ok: false, measured: 0, threshold: 3, label: 'x' }],
        },
        manualConflicts: ['gardevoir-ex'],
      }),
    });
    renderWithProviders(<M12View />, 'es');
    fireEvent.click(screen.getByRole('button', { name: 'Correr ensayo' }));

    expect(await screen.findByText('NO PUBLICARÍA')).toBeInTheDocument();
    // Conflicto manual listado en notas.
    expect(screen.getByText('gardevoir-ex')).toBeInTheDocument();
  });

  it('un fallo de red muestra el aviso amable con reintento', async () => {
    vi.spyOn(api, 'getDecksMetaPreview').mockRejectedValue(new ApiClientError(502, { code: 'INTERNAL', message: 'boom' }));
    renderWithProviders(<M12View />, 'es');
    fireEvent.click(screen.getByRole('button', { name: 'Correr ensayo' }));

    expect(
      await screen.findByText('No se pudo correr el ensayo. Suele ser un problema de red con Limitless; vuelve a intentarlo.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });

  it('en EN también pinta el veredicto (paridad de catálogo)', async () => {
    vi.spyOn(api, 'getDecksMetaPreview').mockResolvedValue({ skipped: false, mode: 'dryrun', report: report() });
    renderWithProviders(<M12View />, 'en');
    fireEvent.click(screen.getByRole('button', { name: 'Run dry-run' }));
    expect(await screen.findByText('WOULD PUBLISH')).toBeInTheDocument();
  });
});
