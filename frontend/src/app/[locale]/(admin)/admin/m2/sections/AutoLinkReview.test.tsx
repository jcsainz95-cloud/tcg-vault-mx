import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as fr from '@/lib/api/catalog-finish-review';
import * as rv from '@/lib/api/catalog-link-review';
import { ApiClientError } from '@/lib/api-client';
import { FinishReviewSection } from './FinishReviewSection';
import { CardReviewPanel } from './CardReviewPanel';
import { AutoLinkRunsPanel } from './AutoLinkRunsPanel';

vi.mock('@/lib/role', () => ({ useRole: () => ({ role: 'super_admin', isSuperAdmin: true }) }));
beforeEach(() => { vi.restoreAllMocks(); });

const item = (o: Partial<fr.FinishReviewItem> = {}): fr.FinishReviewItem => ({
  inventoryItemId: 'i1', folio: 'TH-1', cardId: 'c', cardName: 'Snorlax', setName: 'Gym Heroes', number: '12', status: 'listed',
  currentFinish: 'normal', targetFinish: 'first_edition', currentPriceCents: 113100, targetPriceCents: 389700, blockedReason: null, hasManualPrice: false, ...o,
});

describe('finish-review §9.1', () => {
  it('el resultado muestra unitPriceCents (con IVA), nunca listPriceCents', async () => {
    vi.spyOn(fr, 'getFinishReview').mockResolvedValue({ pending: 1, items: [item()], nextCursor: null });
    vi.spyOn(fr, 'decideFinishReview').mockResolvedValue({
      inventoryItemId: 'i1', decision: 'first_edition', alreadyResolved: false, before: null,
      after: { finish: 'first_edition', unitPriceCents: 1240900, listPriceCents: 1025000, manualPriceKept: false } as never,
    });
    renderWithProviders(<FinishReviewSection />);
    fireEvent.click(await screen.findByRole('button', { name: /Marcar Snorlax como 1\.ª edición/ }));
    const t = (await screen.findByTestId('finish-review-result')).textContent ?? '';
    expect(t).toMatch(/12,409\.00/);
    expect(t).not.toMatch(/10,250/);
  });
  it('precio manual: aviso en la fila y en el resultado', async () => {
    vi.spyOn(fr, 'getFinishReview').mockResolvedValue({ pending: 1, items: [item({ hasManualPrice: true })], nextCursor: null });
    vi.spyOn(fr, 'decideFinishReview').mockResolvedValue({
      inventoryItemId: 'i1', decision: 'first_edition', alreadyResolved: false, before: null, after: { finish: 'first_edition', unitPriceCents: 50000, manualPriceKept: true },
    });
    renderWithProviders(<FinishReviewSection />);
    expect((await screen.findByTestId('finish-review-manual')).textContent).toMatch(/precio manual: revísalo/i);
    fireEvent.click(screen.getByRole('button', { name: /Marcar Snorlax como 1\.ª edición/ }));
    expect((await screen.findByTestId('finish-review-result')).textContent).toMatch(/conservó tu precio manual \(MX\$500\.00\)/);
  });
  it('sin fila de precio vigente: «sin precio publicado»', async () => {
    vi.spyOn(fr, 'getFinishReview').mockResolvedValue({ pending: 1, items: [item({ currentPriceCents: null })], nextCursor: null });
    renderWithProviders(<FinishReviewSection />);
    expect((await screen.findByTestId('finish-review-item')).textContent).toMatch(/sin precio publicado/);
  });
  it('error del GET: aviso y reintento, sin ocultar la sección', async () => {
    const g = vi.spyOn(fr, 'getFinishReview').mockRejectedValueOnce(new ApiClientError(500, { code: 'X', message: 'x', details: {} }));
    renderWithProviders(<FinishReviewSection />);
    expect(await screen.findByTestId('finish-review-retry')).toBeTruthy();
    g.mockResolvedValue({ pending: 1, items: [item()], nextCursor: null });
    fireEvent.click(screen.getByTestId('finish-review-retry'));
    expect(await screen.findByTestId('finish-review-item')).toBeTruthy();
  });
});

describe('revisión por carta §9.4', () => {
  const cards: rv.SetCards = { setId: 's1', items: [{ cardId: 'c1', name: 'Pikachu ex', number: '063', reason: 'name_mismatch',
    candidates: [{ productId: 501, name: 'Pikachu ex - 063/191', number: '063', finishes: ['holofoil'], priceCents: 18900 }] }] };
  it('abre la lista, «Es esta» liga la carta y la quita en sitio', async () => {
    vi.spyOn(rv, 'getSetCards').mockResolvedValue(cards);
    const c = vi.spyOn(rv, 'confirmCardLink').mockResolvedValue({ cardId: 'c1', productId: 501, priced: 1, alreadyConfirmed: false });
    renderWithProviders(<CardReviewPanel setId="s1" setName="SV" count={3} />);
    fireEvent.click(screen.getByRole('button', { name: /Revisar cartas de SV/ }));
    expect((await screen.findByTestId('card-review-item')).textContent).toMatch(/MX\$189\.00/);
    fireEvent.click(screen.getByRole('button', { name: /Es esta: ligar Pikachu ex/ }));
    await waitFor(() => expect(c).toHaveBeenCalledWith('s1', 'c1', 501));
    await waitFor(() => expect(screen.queryByTestId('card-review-item')).toBeNull());
    expect(screen.getByTestId('card-review-done')).toBeTruthy();
  });
  it('409 PRODUCT_TAKEN con texto claro', async () => {
    vi.spyOn(rv, 'getSetCards').mockResolvedValue(cards);
    vi.spyOn(rv, 'confirmCardLink').mockRejectedValue(new ApiClientError(409, { code: 'PRODUCT_TAKEN', message: 'x', details: {} }));
    renderWithProviders(<CardReviewPanel setId="s1" setName="SV" count={3} />);
    fireEvent.click(screen.getByRole('button', { name: /Revisar cartas de SV/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Es esta: ligar/ }));
    expect((await screen.findByTestId('card-review-error')).textContent).toMatch(/Otra carta ya tomó/);
  });
});

describe('corridas y reversa §9.6', () => {
  const runs: rv.AutoLinkRun[] = [{ runId: 'r1', at: '2026-11-26T10:00:00Z', setsTried: 1, linked: 5, priced: 5, held: 0, aborted: false,
    sets: [{ setId: 's1', name: 'Classic', groupId: 1, via: 'b3', linked: 5, priced: 5, held: 0, finishesAdded: 0,
      sample: [{ cardName: 'Charizard', number: '4', finish: 'holofoil', newPriceCents: 1240900, previousPriceCents: null }] }] }];
  it('muestra la corrida con muestra y «Deshacer este set» pide confirmación', async () => {
    vi.spyOn(rv, 'getAutoLinkRuns').mockResolvedValue(runs);
    const u = vi.spyOn(rv, 'unlinkSet').mockResolvedValue();
    renderWithProviders(<AutoLinkRunsPanel canUnlink />);
    fireEvent.click(screen.getByTestId('auto-link-runs-toggle'));
    expect((await screen.findByTestId('auto-link-run')).textContent).toMatch(/Charizard #4.*MX\$12,409\.00/);
    fireEvent.click(screen.getByRole('button', { name: /Deshacer el enlace automático de Classic/ }));
    expect(u).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('auto-link-undo-confirm'));
    await waitFor(() => expect(u).toHaveBeenCalledWith('s1'));
  });
  it('unlink 404: dice que aún no está disponible', async () => {
    vi.spyOn(rv, 'getAutoLinkRuns').mockResolvedValue(runs);
    vi.spyOn(rv, 'unlinkSet').mockRejectedValue(new ApiClientError(404, { code: 'NOT_FOUND', message: 'x', details: {} }));
    renderWithProviders(<AutoLinkRunsPanel canUnlink />);
    fireEvent.click(screen.getByTestId('auto-link-runs-toggle'));
    fireEvent.click(await screen.findByRole('button', { name: /Deshacer el enlace automático/ }));
    fireEvent.click(screen.getByTestId('auto-link-undo-confirm'));
    expect((await screen.findByTestId('auto-link-undo-error')).textContent).toMatch(/aún no está disponible/);
  });
});
