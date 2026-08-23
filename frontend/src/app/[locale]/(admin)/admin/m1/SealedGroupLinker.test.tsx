import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { SealedGroupLinker } from './SealedGroupLinker';
import type { SealedSyncCandidatesResponse } from '@/types/contract';
import * as api from '@/lib/api';

const CANDIDATES: SealedSyncCandidatesResponse = {
  set: { id: 'sv08', name: 'Surging Sparks' },
  candidates: [
    { tcgplayerGroupId: 24010, name: 'Mega Evolution', publishedOn: '2026-08-01', alreadyLinked: false, matchScore: 0.92 },
    { tcgplayerGroupId: 24099, name: 'Old Promos', publishedOn: '2026-06-10', alreadyLinked: true, matchScore: 0.4 },
  ],
};

beforeEach(() => vi.restoreAllMocks());

describe('SealedGroupLinker (P-38, §16.8a) · curación de grupos promo/colección', () => {
  it('lista candidatos con confianza y enlaza como promo_collection → dispara re-sync (onLinked)', async () => {
    vi.spyOn(api, 'getSealedSyncCandidates').mockResolvedValue(CANDIDATES);
    const linkSpy = vi.spyOn(api, 'linkSealedSetGroup').mockResolvedValue({
      id: 'ssg-new',
      setId: 'sv08',
      tcgplayerGroupId: 24010,
      kind: 'promo_collection',
    });
    const onLinked = vi.fn();
    renderWithProviders(<SealedGroupLinker setId="sv08" onLinked={onLinked} />, 'es');

    // Medidor de confianza orientativo (no una cifra cruda) + estado «Ya enlazado».
    expect(await screen.findByText('Coincidencia alta')).toBeInTheDocument();
    expect(screen.getByText('Ya enlazado')).toBeInTheDocument();

    // Solo el candidato NO enlazado tiene botón de enlace.
    const linkBtn = screen.getByRole('button', { name: 'Enlazar como promo/colección' });
    fireEvent.click(linkBtn);

    await waitFor(() =>
      expect(linkSpy).toHaveBeenCalledWith('sv08', {
        tcgplayerGroupId: 24010,
        kind: 'promo_collection',
      }),
    );
    await waitFor(() => expect(onLinked).toHaveBeenCalledTimes(1));
  });
});
