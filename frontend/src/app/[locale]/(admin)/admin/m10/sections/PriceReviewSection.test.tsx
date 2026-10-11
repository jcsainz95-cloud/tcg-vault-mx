import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import type { PriceReviewCaseDTO, PriceReviewQueueResponse } from '@/types/contract';
import { PriceReviewSection } from './PriceReviewSection';

/**
 * 💰 `API_CONTRACT §PRE.D/E/F`, criterio 876/877 — la cola de revisión del candado anti-inflado.
 * El dueño ve el caso con los datos delante (carta, propuesto, base, salto, qué dijo cada fuente) y
 * lo resuelve con una de las tres acciones. Los endpoints son read-only + un `resolve`.
 */

const OPEN_CASE: PriceReviewCaseDTO = {
  id: 'prc-1',
  card: { id: 'c-gengar', name: 'Gengar VMAX', setName: 'Fusion Strike', number: '271' },
  finish: 'holofoil',
  productType: 'raw',
  gradeKey: 'raw:NM',
  cardProductId: 'cp-gengar-nm',
  axis: 'sell',
  proposedMxnCents: 550000,
  baselineMxnCents: 10000,
  jumpFactorMilli: 55000,
  sourceCount: 1,
  familyCount: 1,
  consensus: false,
  quotes: [
    { source: 'cardmarket', family: 'cardmarket', priceMxnCents: 550000, capturedDate: '2026-10-11', stale: false },
    { source: 'tcgdex', family: 'tcgplayer', priceMxnCents: 9800, capturedDate: '2026-09-20', stale: true },
  ],
  status: 'open',
  createdAt: '2026-10-11T07:30:00Z',
};

function serve(cases: PriceReviewCaseDTO[] = [OPEN_CASE], open = 1): void {
  const res: PriceReviewQueueResponse = { data: cases, total: cases.length, counts: { open } };
  vi.spyOn(api, 'getPriceReviewQueue').mockResolvedValue(res);
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('§PRE · Precios por revisar', () => {
  it('pinta la carta, el propuesto, la base, el salto «×55», las fuentes y el contador de abiertos', async () => {
    serve();
    renderWithProviders(<PriceReviewSection />, 'es');
    await screen.findByTestId('price-review-case-prc-1');
    expect(screen.getByText('Gengar VMAX')).toBeInTheDocument();
    // Propuesto y base en pesos (el propuesto también aparece como cotización ⇒ puede salir 2 veces).
    expect(screen.getAllByText(/MX\$5,500\.00/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/MX\$100\.00/).length).toBeGreaterThan(0);
    // Salto legible desde jumpFactorMilli (55000 ⇒ ×55).
    expect(screen.getByText('×55')).toBeInTheDocument();
    // Qué dijo cada fuente + la marca de vieja (cardmarket es fuente y grupo ⇒ sale 2 veces).
    expect(screen.getAllByText('cardmarket').length).toBeGreaterThan(0);
    expect(screen.getByText('Vieja')).toBeInTheDocument();
    // Contador de casos abiertos (counts.open).
    expect(screen.getByTestId('price-review-open-count')).toHaveTextContent('1 caso por revisar');
  });

  it('CLASE E — por defecto pide la cola con `status=open` y la primera página (pageSize 50)', async () => {
    const spy = vi.spyOn(api, 'getPriceReviewQueue').mockResolvedValue({ data: [OPEN_CASE], total: 1, counts: { open: 1 } });
    renderWithProviders(<PriceReviewSection />, 'es');
    await screen.findByTestId('price-review-case-prc-1');
    expect(spy).toHaveBeenCalledWith({ status: 'open', axis: undefined, page: 1, pageSize: 50 });
  });

  it('usa `total` del servidor: «Mostrando 1–50 de 51» y pasa a la página 2 sin perder el caso 51', async () => {
    // El servidor devuelve 50 filas pero declara 51 en total (uno más allá de los primeros 50).
    const firstPage = Array.from({ length: 50 }, (_, i) => ({ ...OPEN_CASE, id: `prc-${i + 1}` }));
    const secondPage = [{ ...OPEN_CASE, id: 'prc-51' }];
    const spy = vi
      .spyOn(api, 'getPriceReviewQueue')
      .mockResolvedValueOnce({ data: firstPage, total: 51, counts: { open: 51 } })
      .mockResolvedValueOnce({ data: secondPage, total: 51, counts: { open: 51 } });
    renderWithProviders(<PriceReviewSection />, 'es');
    await screen.findByTestId('price-review-case-prc-1');
    expect(screen.getByTestId('price-review-page-info')).toHaveTextContent('Mostrando 1–50 de 51');
    // Pasar a la página 2: el dueño llega al caso 51, que sin paginación quedaba oculto.
    fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }));
    await waitFor(() => expect(spy).toHaveBeenLastCalledWith({ status: 'open', axis: undefined, page: 2, pageSize: 50 }));
    await screen.findByTestId('price-review-case-prc-51');
    expect(screen.getByTestId('price-review-page-info')).toHaveTextContent('Mostrando 51–51 de 51');
  });

  it('con una sola página no muestra controles de paginación', async () => {
    serve();
    renderWithProviders(<PriceReviewSection />, 'es');
    await screen.findByTestId('price-review-case-prc-1');
    expect(screen.getByTestId('price-review-page-info')).toHaveTextContent('Mostrando 1–1 de 1');
    expect(screen.queryByRole('button', { name: /Siguiente/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Anterior/ })).toBeNull();
  });

  it('«Aceptar» resuelve con action=accept', async () => {
    serve();
    const resolve = vi.spyOn(api, 'resolvePriceReviewCase').mockResolvedValue({ ...OPEN_CASE, status: 'accepted' });
    renderWithProviders(<PriceReviewSection />, 'es');
    await screen.findByTestId('price-review-case-prc-1');
    fireEvent.click(screen.getByRole('button', { name: /Aceptar/ }));
    await waitFor(() => expect(resolve).toHaveBeenCalledWith('prc-1', { action: 'accept' }));
  });

  it('«Conservar» resuelve con action=keep', async () => {
    serve();
    const resolve = vi.spyOn(api, 'resolvePriceReviewCase').mockResolvedValue({ ...OPEN_CASE, status: 'kept' });
    renderWithProviders(<PriceReviewSection />, 'es');
    await screen.findByTestId('price-review-case-prc-1');
    fireEvent.click(screen.getByRole('button', { name: /Conservar/ }));
    await waitFor(() => expect(resolve).toHaveBeenCalledWith('prc-1', { action: 'keep' }));
  });

  it('«Precio a mano» exige un monto > 0 y resuelve con manual + los centavos', async () => {
    serve();
    const resolve = vi.spyOn(api, 'resolvePriceReviewCase').mockResolvedValue({ ...OPEN_CASE, status: 'manual' });
    renderWithProviders(<PriceReviewSection />, 'es');
    await screen.findByTestId('price-review-case-prc-1');
    fireEvent.click(screen.getByRole('button', { name: /Precio a mano/ }));
    const dialog = await screen.findByRole('dialog');
    // Vacío ⇒ guardar deshabilitado (money-safe: no publica a MX$0).
    const save = within(dialog).getByRole('button', { name: /Guardar precio/ });
    expect(save).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/Precio a mano/), { target: { value: '150' } });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() =>
      expect(resolve).toHaveBeenCalledWith('prc-1', { action: 'manual', manualPriceMxnCents: 15000 }),
    );
  });

  it('un 409 CONFLICT muestra el aviso de «ya se resolvió»', async () => {
    serve();
    vi.spyOn(api, 'resolvePriceReviewCase').mockRejectedValue(
      new ApiClientError(409, { code: 'CONFLICT', message: 'ya resuelto', details: { status: 'accepted' } }),
    );
    renderWithProviders(<PriceReviewSection />, 'es');
    await screen.findByTestId('price-review-case-prc-1');
    fireEvent.click(screen.getByRole('button', { name: /Conservar/ }));
    expect(await screen.findByText('Este caso ya se resolvió')).toBeInTheDocument();
  });

  it('cola vacía ⇒ estado vacío positivo', async () => {
    serve([], 0);
    renderWithProviders(<PriceReviewSection />, 'es');
    expect(await screen.findByText('No hay precios por revisar. Todo está al día.')).toBeInTheDocument();
  });

  it('💰 condición E — propuesto $0 deshabilita «Aceptar» (defensa money-safe) y deja Conservar/Precio a mano', async () => {
    serve([{ ...OPEN_CASE, id: 'prc-z', proposedMxnCents: 0, baselineMxnCents: 10000 }]);
    renderWithProviders(<PriceReviewSection />, 'es');
    const kase = await screen.findByTestId('price-review-case-prc-z');
    // «Aceptar» publicaría $0 ⇒ deshabilitado.
    expect(within(kase).getByTestId('price-review-accept-prc-z')).toBeDisabled();
    // Las salidas sensatas siguen vivas.
    expect(within(kase).getByRole('button', { name: /Conservar/ })).toBeEnabled();
    expect(within(kase).getByRole('button', { name: /Precio a mano/ })).toBeEnabled();
    // Y lo explica.
    expect(within(kase).getByText(/Sin precio de mercado/)).toBeInTheDocument();
  });

  it('propuesto > 0 deja «Aceptar» habilitado (la defensa es `=== 0` exacto)', async () => {
    serve([{ ...OPEN_CASE, id: 'prc-ok', proposedMxnCents: 1 }]);
    renderWithProviders(<PriceReviewSection />, 'es');
    const kase = await screen.findByTestId('price-review-case-prc-ok');
    expect(within(kase).getByTestId('price-review-accept-prc-ok')).toBeEnabled();
  });

  it('un caso ya resuelto no ofrece acciones, muestra quién y cuándo', async () => {
    serve(
      [
        {
          ...OPEN_CASE,
          id: 'prc-9',
          status: 'kept',
          resolvedAction: 'keep',
          resolvedBy: 'u-admin',
          resolvedAt: '2026-10-11T08:00:00Z',
        },
      ],
      0,
    );
    renderWithProviders(<PriceReviewSection />, 'es');
    // Hay que cambiar de pestaña a «Conservados» para verlo (por defecto solo `open`).
    const kase = await screen.findByTestId('price-review-case-prc-9');
    expect(within(kase).queryByRole('button', { name: /Aceptar/ })).toBeNull();
    expect(screen.getByTestId('price-review-resolved-prc-9')).toHaveTextContent(/Resuelto/);
  });
});
