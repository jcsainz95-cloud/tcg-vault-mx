import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as exc from '@/lib/api/catalog-link-exceptions';
import * as fr from '@/lib/api/catalog-finish-review';
import { ApiClientError } from '@/lib/api-client';
import { AutoLinkSummary } from './AutoLinkSummary';
import { FinishReviewSection } from './FinishReviewSection';

const role = vi.hoisted(() => ({ isSuperAdmin: true }));
vi.mock('@/lib/role', () => ({ useRole: () => ({ role: 'super_admin', isSuperAdmin: role.isSuperAdmin }) }));

const SUM = { unlinkedCards: 3, unlinkedSets: 1, repairedYesterday: 5, pricedYesterday: 4, lastRunAt: null, nextRunAt: null, waitingDecision: 0, pendingConfirm: 2 };
beforeEach(() => { vi.restoreAllMocks(); role.isSuperAdmin = true; });

describe('§8a interruptor', () => {
  it('apagar pide confirmación y escribe off; sin confirmar no escribe', async () => {
    vi.spyOn(exc, 'getLinkExceptions').mockResolvedValue({ unlinkedCards: 3, sets: [], summary: { ...SUM, autoLinkEnabled: true } });
    const set = vi.spyOn(exc, 'setAutoLinkEnabled').mockResolvedValue();
    renderWithProviders(<AutoLinkSummary />);
    fireEvent.click(await screen.findByTestId('auto-link-toggle'));
    expect(set).not.toHaveBeenCalled();
    expect(screen.getByText('¿Apagar la reparación automática?')).toBeTruthy();
    fireEvent.click(screen.getByTestId('auto-link-confirm-off'));
    await waitFor(() => expect(set).toHaveBeenCalledWith(false));
  });
  it('encender no pide confirmación', async () => {
    vi.spyOn(exc, 'getLinkExceptions').mockResolvedValue({ unlinkedCards: 3, sets: [], summary: { ...SUM, autoLinkEnabled: false } });
    const set = vi.spyOn(exc, 'setAutoLinkEnabled').mockResolvedValue();
    renderWithProviders(<AutoLinkSummary />);
    fireEvent.click(await screen.findByTestId('auto-link-toggle'));
    await waitFor(() => expect(set).toHaveBeenCalledWith(true));
  });
  it('no super_admin: sin interruptor; con piezas por confirmar, enlace a la sección', async () => {
    role.isSuperAdmin = false;
    vi.spyOn(exc, 'getLinkExceptions').mockResolvedValue({ unlinkedCards: 3, sets: [], summary: { ...SUM, autoLinkEnabled: true } });
    renderWithProviders(<AutoLinkSummary />);
    expect((await screen.findByTestId('auto-link-pending-link')).textContent).toBe('2 piezas antiguas por confirmar');
    expect(screen.queryByTestId('auto-link-toggle')).toBeNull();
  });
  it('sin link-exceptions usa sync-status.autoLink', async () => {
    vi.spyOn(exc, 'getLinkExceptions').mockRejectedValue(new Error('404'));
    renderWithProviders(<AutoLinkSummary fallback={{ ...SUM, autoLinkEnabled: false }} />);
    expect((await screen.findByTestId('auto-link-job')).textContent).toMatch(/apagada/);
  });
});

describe('§8b piezas antiguas', () => {
  const item = (o: Partial<fr.FinishReviewItem> = {}): fr.FinishReviewItem => ({
    inventoryItemId: 'i1', folio: 'TH-1', cardId: 'c', cardName: 'Snorlax', setName: 'Gym Heroes', number: '12', status: 'listed',
    currentFinish: 'normal', targetFinish: 'first_edition', currentPriceCents: 113100, targetPriceCents: 389700, blockedReason: null, ...o,
  });
  it('muestra precio actual vs destino del servidor, decide y deja el resultado junto a la pieza', async () => {
    vi.spyOn(fr, 'getFinishReview').mockResolvedValue({ pending: 1, items: [item()], nextCursor: null });
    const d = vi.spyOn(fr, 'decideFinishReview').mockResolvedValue({ inventoryItemId: 'i1', decision: 'first_edition', alreadyResolved: false, before: null, after: { finish: 'first_edition', unitPriceCents: 389700, listPriceCents: 389700 } });
    renderWithProviders(<FinishReviewSection />);
    const li = (await screen.findByTestId('finish-review-item'));
    expect(li.textContent).toMatch(/MX\$1,131\.00 → MX\$3,897\.00/);
    fireEvent.click(screen.getByRole('button', { name: /Marcar Snorlax como 1\.ª edición/ }));
    await waitFor(() => expect(d).toHaveBeenCalledWith('i1', 'first_edition', 'normal'));
    expect((await screen.findByTestId('finish-review-result')).textContent).toMatch(/ahora es 1\.ª edición, precio MX\$3,897\.00/);
  });
  it('bloqueada por venta: sin botones activos y motivo en claro; sin precio destino solo «dejar así»', async () => {
    vi.spyOn(fr, 'getFinishReview').mockResolvedValue({ pending: 2, nextCursor: null, items: [
      item({ blockedReason: 'has_sale' }), item({ inventoryItemId: 'i2', blockedReason: 'no_target_price', targetPriceCents: null }) ] });
    renderWithProviders(<FinishReviewSection />);
    await screen.findAllByTestId('finish-review-item');
    const [a, b] = screen.getAllByTestId('finish-review-item');
    expect(a.querySelectorAll('button:disabled')).toHaveLength(2);
    expect(b.textContent).toMatch(/sin precio/);
    expect(b.querySelectorAll('button:disabled')).toHaveLength(1);
  });
  it('409 ITEM_LOCKED y ALREADY_RESOLVED con texto claro', async () => {
    vi.spyOn(fr, 'getFinishReview').mockResolvedValue({ pending: 1, items: [item()], nextCursor: null });
    vi.spyOn(fr, 'decideFinishReview').mockRejectedValueOnce(new ApiClientError(409, { code: 'ITEM_LOCKED', message: 'x', details: {} }))
      .mockRejectedValueOnce(new ApiClientError(409, { code: 'ALREADY_RESOLVED', message: 'x', details: {} }));
    renderWithProviders(<FinishReviewSection />);
    fireEvent.click(await screen.findByRole('button', { name: /Dejar Snorlax como está/ }));
    expect((await screen.findByTestId('finish-review-error')).textContent).toMatch(/pedido, reserva/);
    fireEvent.click(screen.getByRole('button', { name: /Dejar Snorlax como está/ }));
    await waitFor(() => expect(screen.getByTestId('finish-review-error').textContent).toMatch(/decisión contraria/));
  });
  it('pending 0 o no super_admin: no pinta nada', async () => {
    vi.spyOn(fr, 'getFinishReview').mockResolvedValue({ pending: 0, items: [], nextCursor: null });
    const { container } = renderWithProviders(<FinishReviewSection />);
    await waitFor(() => expect(fr.getFinishReview).toHaveBeenCalled());
    expect(container.querySelector('[data-testid="finish-review"]')).toBeNull();
  });
});
