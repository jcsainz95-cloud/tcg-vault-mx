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

describe('revisión por carta §10', () => {
  it('singular, etiqueta de mercado, reverse_holo traducido, no_source_product sin botón y «retenida» sin decir que se puso precio', async () => {
    vi.spyOn(rv, 'getSetCards').mockResolvedValue({ setId: 's1', items: [
      { cardId: 'c1', name: 'Pikachu ex', number: '063', reason: 'name_mismatch', candidates: [{ productId: 501, name: 'Pikachu', number: '063', finishes: ['reverse_holo'], priceCents: 18900 }] },
      { cardId: 'c2', name: 'Raro', number: '9', reason: 'no_source_product', candidates: [] },
    ] });
    vi.spyOn(rv, 'confirmCardLink').mockResolvedValue({ cardId: 'c1', productId: 501, priced: 0, alreadyConfirmed: false });
    const onProgress = vi.fn();
    renderWithProviders(<CardReviewPanel setId="s1" setName="SV" count={1} onProgress={onProgress} />);
    expect(screen.getByRole('button', { name: /Revisar cartas de SV/ }).textContent).toBe('Revisar 1 carta');
    fireEvent.click(screen.getByRole('button', { name: /Revisar cartas de SV/ }));
    const li = (await screen.findByTestId('card-review-item')).textContent ?? '';
    expect(li).toMatch(/Reverse Holofoil/);
    expect(li).toMatch(/mercado \(sin margen ni IVA\)/);
    expect(screen.getAllByTestId('card-review-item')).toHaveLength(1);
    expect(screen.getByTestId('card-review-no-source')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Es esta: ligar Pikachu ex/ }));
    await waitFor(() => expect(onProgress).toHaveBeenCalledWith({ linked: 1, priced: 0 }));
    const done = (await screen.findByTestId('card-review-done')).textContent ?? '';
    expect(done).toMatch(/no se publicó su precio/);
    expect(done).not.toMatch(/se puso su precio/);
  });
});

describe('corridas y reversa §9.6', () => {
  const runs: rv.AutoLinkRun[] = [{ runId: 'r1', at: '2026-11-26T10:00:00Z', setsTried: 1, linked: 5, priced: 5, held: 0, aborted: null,
    sets: [{ setId: 's1', name: 'Classic', groupId: 1, via: 'b3', linked: 5, priced: 5, held: 0, finishesAdded: 0,
      sample: [{ cardName: 'Charizard', number: '4', finish: 'holofoil', newPriceCents: 1240900, previousPriceCents: null }] }] }];
  it('muestra la corrida con muestra y «Deshacer este set» pide confirmación', async () => {
    vi.spyOn(rv, 'getAutoLinkRuns').mockResolvedValue(runs);
    const u = vi.spyOn(rv, 'unlinkSet').mockResolvedValue({ unlinked: 5, pricesRemoved: 5 });
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
  it('§10.3: sin enlaces del job (linked 0) no hay botón; con ellos, el resultado dice cuánto se quitó', async () => {
    const r0: rv.AutoLinkRun[] = [{ ...runs[0], sets: [{ ...runs[0].sets[0], linked: 0 }] }];
    vi.spyOn(rv, 'getAutoLinkRuns').mockResolvedValue(r0);
    const { unmount } = renderWithProviders(<AutoLinkRunsPanel canUnlink />);
    fireEvent.click(screen.getByTestId('auto-link-runs-toggle'));
    await screen.findByTestId('auto-link-run');
    expect(screen.queryByRole('button', { name: /Deshacer el enlace automático/ })).toBeNull();
    unmount();
    vi.spyOn(rv, 'getAutoLinkRuns').mockResolvedValue(runs);
    vi.spyOn(rv, 'unlinkSet').mockResolvedValue({ unlinked: 5, pricesRemoved: 4 });
    renderWithProviders(<AutoLinkRunsPanel canUnlink />);
    fireEvent.click(screen.getByTestId('auto-link-runs-toggle'));
    fireEvent.click(await screen.findByRole('button', { name: /Deshacer el enlace automático/ }));
    fireEvent.click(screen.getByTestId('auto-link-undo-confirm'));
    expect((await screen.findByTestId('auto-link-undone')).textContent).toMatch(/5 enlaces y 4 precios/);
  });
  it('§10.3: 409 NOTHING_TO_UNLINK se explica', async () => {
    vi.spyOn(rv, 'getAutoLinkRuns').mockResolvedValue(runs);
    vi.spyOn(rv, 'unlinkSet').mockRejectedValue(new ApiClientError(409, { code: 'NOTHING_TO_UNLINK', message: 'x', details: {} }));
    renderWithProviders(<AutoLinkRunsPanel canUnlink />);
    fireEvent.click(screen.getByTestId('auto-link-runs-toggle'));
    fireEvent.click(await screen.findByRole('button', { name: /Deshacer el enlace automático/ }));
    fireEvent.click(screen.getByTestId('auto-link-undo-confirm'));
    expect((await screen.findByTestId('auto-link-undo-error')).textContent).toMatch(/nada que deshacer/);
  });
  it('§10.5/§10.8: etiqueta de mercado en las muestras y aborted como texto (no booleano)', async () => {
    vi.spyOn(rv, 'getAutoLinkRuns').mockResolvedValue([{ ...runs[0], aborted: 'lock_busy' }]);
    renderWithProviders(<AutoLinkRunsPanel canUnlink />);
    fireEvent.click(screen.getByTestId('auto-link-runs-toggle'));
    const t = (await screen.findByTestId('auto-link-run')).textContent ?? '';
    expect(t).toMatch(/mercado \(sin margen ni IVA\)/);
    expect(t).toMatch(/se detuvo antes de terminar: había otra tarea/);
  });
});
