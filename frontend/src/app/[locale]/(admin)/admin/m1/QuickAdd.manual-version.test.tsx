/**
 * §ALTA-LIGA-2 (UX-ALTA-LIGA-2, opción A; `docs/API_CONTRACT_ALTA_LIGA.md`): en el alta rápida del cajón la fila
 * «Versión» sale siempre que `GET …/versions` traiga `canAddManual`, con «+ Versión de liga»: carta sin liga ⇒ se crea
 * ⇒ queda seleccionada (la ruta de la captura del dueño: Erika's Victreebel ASC #6).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import * as manual from '@/lib/api/manual-version';
import { ApiClientError } from '@/lib/api-client';
import type { CardVersionsResponse, VersionComboDTO } from '@/types/contract';
import { QuickAddSection } from './QuickAdd';

vi.mock('@/lib/role', () => ({
  useRole: () => ({ role: 'super_admin', setRole: () => {}, isSuperAdmin: true, canSwitchRole: false }),
}));

beforeEach(() => vi.restoreAllMocks());

const target = { cardId: 'c-victreebel-asc6', productType: 'raw' as const, finish: 'holofoil' as const };
const MANUAL = { type: 'prize_pack' as const, label: null, productId: -1, manual: true as const };
const combo = (o: Partial<VersionComboDTO>): VersionComboDTO => ({
  finish: 'holofoil', finishLabel: 'holo', language: 'en', stamp: null, previewPriceCents: 20000, baseReferenceMxnCents: 20000,
  appliedMarketPct: null, buySuggestedCents: null, unavailableReason: null, ...o,
});
/** Lo que mide la captura: sin producto de liga ni candidatas, pero el servidor deja crear a mano. */
const NO_LEAGUE: CardVersionsResponse = { combos: [combo({})], candidates: [], canAddManual: true, stampTypes: ['prize_pack', 'league', 'staff'] };
const WITH_MANUAL: CardVersionsResponse = {
  ...NO_LEAGUE,
  combos: [combo({}), combo({ stamp: MANUAL, previewPriceCents: 20000, priceSource: 'inherited_base' })],
};
const createResponse = (): manual.ManualVersionResponse => ({ created: true, finishAdded: false, stamp: MANUAL, finishes: ['holofoil'], combos: [] });

function render(first: CardVersionsResponse, ...next: CardVersionsResponse[]) {
  const get = vi.spyOn(api, 'getCardVersions').mockResolvedValueOnce(first);
  for (const n of next) get.mockResolvedValueOnce(n);
  get.mockResolvedValue(next.at(-1) ?? first);
  const batch = vi.spyOn(api, 'batchCreateItems').mockResolvedValue({
    batchKey: 'k', idempotentReplay: false, summary: { requested: 1, createdItems: 1, failedLines: 0 },
    results: [{ index: 0, ok: true as const, folios: ['INV-1'], inventoryItemIds: ['id-1'] }],
  });
  renderWithProviders(<QuickAddSection target={target} buyEffectiveCents={87_500} buySource="market" marketRefCents={125_000} onToast={vi.fn()} />, 'es');
  return { get, batch };
}

describe('§ALTA-LIGA-2 · alta rápida: «+ Versión de liga»', () => {
  it('carta sin liga: la fila Versión sale igual, con «Sin liga» y el botón', async () => {
    render(NO_LEAGUE);
    const version = await screen.findByRole('radiogroup', { name: 'Versión' });
    expect(within(version).getAllByRole('radio').map((r) => r.textContent)).toEqual(['Sin liga']);
    expect(screen.getByRole('button', { name: '+ Versión de liga' })).toBeTruthy();
  });

  it('sin canAddManual no hay botón ni fila (el DOM de hoy)', async () => {
    render({ combos: [combo({})], candidates: [] });
    await screen.findByTestId('ids-price');
    expect(screen.queryByRole('radiogroup', { name: 'Versión' })).toBeNull();
    expect(screen.queryByTestId('manual-version-open')).toBeNull();
  });

  it('ruta de la captura: crea ⇒ re-pide versions ⇒ queda seleccionada, con «precio de la normal» y el alta lleva el productId negativo', async () => {
    const create = vi.spyOn(manual, 'createManualVersion').mockResolvedValue(createResponse());
    const { get, batch } = render(NO_LEAGUE, WITH_MANUAL);
    await userEvent.click(await screen.findByRole('button', { name: '+ Versión de liga' }));
    expect(screen.getByLabelText('Tipo de sello')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Crear versión' }));
    await waitFor(() => expect(create).toHaveBeenCalledWith('c-victreebel-asc6', { stampType: 'prize_pack', stampLabel: '', finish: 'holofoil' }));
    await waitFor(() => expect(get.mock.calls.length).toBeGreaterThanOrEqual(2));
    const version = await screen.findByRole('radiogroup', { name: 'Versión' });
    await waitFor(() => expect(within(version).getByRole('radio', { name: 'De liga · Prize Pack' })).toHaveAttribute('aria-checked', 'true'));
    expect(screen.getByTestId('ids-price-source')).toHaveTextContent('Precio de la carta normal hasta que llegue el precio real');
    expect(screen.queryByTestId('manual-version-form')).toBeNull();
    fireEvent.change(screen.getByLabelText('Costo TOTAL de la factura, IVA incluido (MXN)'), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Dar de alta al inventario' }));
    await waitFor(() => expect(batch).toHaveBeenCalled());
    expect(JSON.stringify(batch.mock.calls[0])).toContain('"cardProductId":-1');
  });

  it('manda la etiqueta recortada solo si se escribió', async () => {
    const create = vi.spyOn(manual, 'createManualVersion').mockResolvedValue(createResponse());
    render(NO_LEAGUE, WITH_MANUAL);
    await userEvent.click(await screen.findByRole('button', { name: '+ Versión de liga' }));
    await userEvent.type(screen.getByLabelText(/Etiqueta/), '  Temporada 7 ');
    await userEvent.click(screen.getByRole('button', { name: 'Crear versión' }));
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0][1]).toMatchObject({ stampLabel: '  Temporada 7 ' });
  });

  it('409 USE_EXISTING: ofrece ligar la candidata existente ahí mismo (attach) y la deja elegida', async () => {
    vi.spyOn(manual, 'createManualVersion').mockRejectedValue(
      new ApiClientError(409, { code: 'USE_EXISTING', message: 'x', details: { candidates: [{ tcgplayerProductId: 777001, name: 'Erika Victreebel (Prize Pack)' }] } }),
    );
    const attach = vi.spyOn(api, 'attachStampedCandidate').mockResolvedValue({
      ...NO_LEAGUE,
      combos: [combo({}), combo({ stamp: { type: 'prize_pack', label: null, productId: 777001 } })],
    });
    render(NO_LEAGUE);
    await userEvent.click(await screen.findByRole('button', { name: '+ Versión de liga' }));
    await userEvent.click(screen.getByRole('button', { name: 'Crear versión' }));
    expect(await screen.findByText('Esta carta ya tiene una versión de ese tipo')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /Ligar la existente: Erika Victreebel/ }));
    await waitFor(() => expect(attach).toHaveBeenCalledWith(777001, expect.objectContaining({ id: 'c-victreebel-asc6' })));
    const version = await screen.findByRole('radiogroup', { name: 'Versión' });
    await waitFor(() => expect(within(version).getByRole('radio', { name: 'De liga · Prize Pack' })).toHaveAttribute('aria-checked', 'true'));
  });

  it.each([
    [429, 'RATE_LIMITED', /Creaste muchas versiones/],
    [422, 'FINISH_NOT_AVAILABLE', /no existe en ese acabado/],
    [404, 'CARD_NOT_FOUND', /No encontramos esa carta/],
    [500, 'INTERNAL', /No pudimos crear la versión/],
  ])('error %s %s: texto claro en el mismo panel', async (status, code, text) => {
    vi.spyOn(manual, 'createManualVersion').mockRejectedValue(new ApiClientError(status, { code, message: 'x' }));
    render(NO_LEAGUE);
    await userEvent.click(await screen.findByRole('button', { name: '+ Versión de liga' }));
    await userEvent.click(screen.getByRole('button', { name: 'Crear versión' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(text);
    expect(screen.getByTestId('manual-version-form')).toBeTruthy();
  });

  it('422 PRODUCT_NOT_FOUND (el manual se fusionó): re-pide versions, re-selecciona el real equivalente, avisa y el reintento ya lleva el productId real', async () => {
    const REAL = { type: 'prize_pack' as const, label: null, productId: 777001 };
    const MERGED: CardVersionsResponse = { ...NO_LEAGUE, combos: [combo({}), combo({ stamp: REAL, previewPriceCents: 21000 })] };
    const { get, batch } = render(WITH_MANUAL, MERGED);
    batch.mockReset();
    batch
      .mockRejectedValueOnce(new ApiClientError(422, { code: 'PRODUCT_NOT_FOUND', message: 'x' }))
      .mockResolvedValue({ batchKey: 'k', idempotentReplay: false, summary: { requested: 1, createdItems: 1, failedLines: 0 }, results: [{ index: 0, ok: true as const, folios: ['INV-2'], inventoryItemIds: ['id-2'] }] });
    const version = await screen.findByRole('radiogroup', { name: 'Versión' });
    fireEvent.click(within(version).getByRole('radio', { name: 'De liga · Prize Pack' }));
    fireEvent.change(screen.getByLabelText('Costo TOTAL de la factura, IVA incluido (MXN)'), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Dar de alta al inventario' }));
    await waitFor(() => expect(batch).toHaveBeenCalledTimes(1));
    expect(JSON.stringify(batch.mock.calls[0])).toContain('"cardProductId":-1');
    // Aviso claro y versions vuelto a pedir.
    expect(await screen.findByText(/Esta versión se actualizó mientras la dabas de alta/)).toBeTruthy();
    await waitFor(() => expect(get.mock.calls.length).toBeGreaterThanOrEqual(2));
    // Sigue elegida "De liga · Prize Pack", ahora el producto real.
    await waitFor(() => expect(within(screen.getByRole('radiogroup', { name: 'Versión' })).getByRole('radio', { name: 'De liga · Prize Pack' })).toHaveAttribute('aria-checked', 'true'));
    fireEvent.change(screen.getByLabelText('Costo TOTAL de la factura, IVA incluido (MXN)'), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Dar de alta al inventario' }));
    await waitFor(() => expect(batch).toHaveBeenCalledTimes(2));
    expect(JSON.stringify(batch.mock.calls[1])).toContain('"cardProductId":777001');
    expect(JSON.stringify(batch.mock.calls[1])).not.toContain('-1,');
  });

  it('PRODUCT_CARD_MISMATCH sin versión equivalente tras refrescar: vuelve a «Sin liga» y avisa', async () => {
    const { batch } = render(WITH_MANUAL, NO_LEAGUE);
    batch.mockReset();
    batch.mockRejectedValue(new ApiClientError(422, { code: 'PRODUCT_CARD_MISMATCH', message: 'x' }));
    const version = await screen.findByRole('radiogroup', { name: 'Versión' });
    fireEvent.click(within(version).getByRole('radio', { name: 'De liga · Prize Pack' }));
    fireEvent.change(screen.getByLabelText('Costo TOTAL de la factura, IVA incluido (MXN)'), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Dar de alta al inventario' }));
    expect(await screen.findByText(/Esta versión se actualizó/)).toBeTruthy();
    await waitFor(() => expect(within(screen.getByRole('radiogroup', { name: 'Versión' })).getByRole('radio', { name: 'Sin liga' })).toHaveAttribute('aria-checked', 'true'));
  });
});
