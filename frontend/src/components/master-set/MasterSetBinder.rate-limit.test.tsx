import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import es from '../../../messages/es.json';
import en from '../../../messages/en.json';
import type { MasterSetSummaryDTO } from '@/types/contract';
import { ApiClientError } from '@/lib/api-client';

// §BUYLIST-429 (criterios A y D): lotes en serie, 429 reintentado en silencio, caché 10 min.
vi.mock('@/lib/api', () => ({
  getMasterSetBinder: vi.fn(),
  getAdminVaultMasterSetBinder: vi.fn(),
  getVaultMasterSetBinder: vi.fn(),
  searchBuylistCards: vi.fn(),
  batchQuote: vi.fn(),
  BUYLIST_QUOTE_BATCH_MAX: 50,
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}));

import { MasterSetBinder } from './MasterSetBinder';
import { batchQuote, getAdminVaultMasterSetBinder, getMasterSetBinder, getVaultMasterSetBinder, searchBuylistCards } from '@/lib/api';
import { setRateLimitWait } from '@/lib/api/rate-limit-retry';
import { QUERY_DEFAULTS } from '@/components/Providers';

const set: MasterSetSummaryDTO = {
  setId: 'sv08', name: 'Surging Sparks', logoUrl: null, ptcgoCode: null, catalogCardCount: 30,
  distinctCardsOwned: 0, completionPct: 0, totalPieces: 0, catalogVariantCount: 60,
  distinctVariantsOwned: 0, variantCompletionPct: 0,
};

// 30 cartas × 2 acabados = 60 ítems ⇒ 2 lotes de ≤50.
const cards = Array.from({ length: 30 }, (_, i) => ({
  id: `c${i}`, number: String(i + 1).padStart(3, '0'), name: `Carta ${i + 1}`, rarity: 'Common',
  imageSmallUrl: 'https://img.example/x.png', availableFinishes: ['normal', 'reverse_holo'],
})) as never[];

const okBatch = (items: unknown[]) => ({
  results: items.map((_, index) => ({
    index, ok: true, rarity: 'Common', finish: 'normal', priceBasis: 'market', referencePrice: null,
    quote: { status: 'ok', quotedPriceCents: 1000 },
  })),
}) as never;
const tooMany = (retryAfter?: string) => {
  const e = new ApiClientError(429, { code: 'RATE_LIMITED', message: 'Demasiadas solicitudes' });
  if (retryAfter) e.retryAfter = retryAfter;
  return e;
};

function ui(client: QueryClient, locale: 'es' | 'en' = 'es', mode: 'quoter' | 'platform' | 'user_vault_self' | 'user_vault_admin' = 'quoter') {
  return (
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale={locale} messages={locale === 'es' ? es : en}>
        <MasterSetBinder mode={mode} userId="u1" set={set} onBack={() => {}} onOpenCell={() => {}} />
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
}
// Mismos defaults que producción (Providers); las opciones del binder los sobreescriben.
const newClient = () => new QueryClient({ defaultOptions: { queries: { ...QUERY_DEFAULTS } } });

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.mocked(searchBuylistCards).mockReset();
  vi.mocked(batchQuote).mockReset();
  vi.mocked(searchBuylistCards).mockResolvedValue({ data: cards, total: 30, page: 1, pageSize: 50 } as never);
  vi.mocked(batchQuote).mockImplementation(async (items) => okBatch(items));
});
afterEach(() => vi.useRealTimers());

describe('MasterSetBinder quoter · 429 de quote/batch', () => {
  it('429 con Retry-After: avisa «Cotizando…», espera, reintenta el mismo lote y termina bien', async () => {
    vi.mocked(batchQuote)
      .mockImplementationOnce(async (items) => okBatch(items))
      .mockRejectedValueOnce(tooMany('20'))
      .mockImplementation(async (items) => okBatch(items));
    render(ui(newClient()));
    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('Cotizando… continúa en 20 s');
    expect(status).toHaveClass('sr-only'); // el lector recibe el aviso educado; lo visible es la cuenta atrás aria-hidden
    expect(vi.mocked(batchQuote)).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(4_000); });
    expect(screen.getByText('Cotizando… continúa en 16 s')).toBeInTheDocument(); // cuenta atrás visible
    expect(screen.getByRole('status')).toHaveTextContent('Cotizando… continúa en 20 s'); // lo anunciado no cambia cada segundo
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(vi.mocked(batchQuote)).toHaveBeenCalledTimes(2); // aún esperando los 20 s
    await act(async () => { await vi.advanceTimersByTimeAsync(1_500); });
    await screen.findAllByText('Carta 1');
    expect(vi.mocked(batchQuote)).toHaveBeenCalledTimes(3); // lote 1 una vez, lote 2 dos veces
    expect(screen.queryByText(/Algo salió mal/)).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('el aviso existe en inglés', async () => {
    vi.mocked(batchQuote).mockRejectedValueOnce(tooMany('5'));
    render(ui(newClient(), 'en'));
    expect(await screen.findByRole('status')).toHaveTextContent('Pricing… resuming in 10 s');
  });

  it('sin Retry-After espera 15 s; 4 respuestas 429 (1 + 3 reintentos) ⇒ error visible con Reintentar', async () => {
    vi.mocked(batchQuote).mockRejectedValue(tooMany());
    render(ui(newClient()));
    await screen.findByRole('status');
    expect(vi.mocked(batchQuote)).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(14_000); });
    expect(vi.mocked(batchQuote)).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(46_000); });
    expect(await screen.findByText(/Reintentar/i)).toBeInTheDocument();
    expect(vi.mocked(batchQuote)).toHaveBeenCalledTimes(4);
  });

  it('reabrir un set visto hace <10 min y filtrar/buscar: 0 llamadas nuevas', async () => {
    const client = newClient();
    const first = render(ui(client));
    await screen.findAllByText('Carta 1');
    const batches = vi.mocked(batchQuote).mock.calls.length;
    const cardCalls = vi.mocked(searchBuylistCards).mock.calls.length;
    expect(batches).toBe(2);
    // filtrar por nombre dentro del set cargado
    fireEvent.change(screen.getByLabelText(/Buscar carta/i), { target: { value: 'Carta 2' } });
    expect(vi.mocked(batchQuote)).toHaveBeenCalledTimes(batches);
    expect(vi.mocked(searchBuylistCards)).toHaveBeenCalledTimes(cardCalls);
    // salir y reabrir 5 min después
    first.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60_000); });
    render(ui(client));
    await screen.findAllByText('Carta 1');
    expect(vi.mocked(batchQuote)).toHaveBeenCalledTimes(batches);
    expect(vi.mocked(searchBuylistCards)).toHaveBeenCalledTimes(cardCalls);
  });

  it('vigencia exacta: a los 9 min sigue fresco (0 llamadas); a los 11 min vuelve a cotizar', async () => {
    const client = newClient();
    const first = render(ui(client));
    await screen.findAllByText('Carta 1');
    expect(vi.mocked(batchQuote).mock.calls.length).toBe(2);
    first.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(9 * 60_000); });
    const again = render(ui(client));
    await screen.findAllByText('Carta 1');
    expect(vi.mocked(batchQuote).mock.calls.length).toBe(2);
    again.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(2 * 60_000); });
    render(ui(client));
    await vi.waitFor(() => expect(vi.mocked(batchQuote).mock.calls.length).toBe(4));
  });

  it('los lotes van en serie (nunca dos quote/batch a la vez)', async () => {
    let inFlight = 0;
    let max = 0;
    vi.mocked(batchQuote).mockImplementation(async (items) => {
      inFlight += 1; max = Math.max(max, inFlight);
      await new Promise((r) => setTimeout(r, 50));
      inFlight -= 1;
      return okBatch(items);
    });
    render(ui(newClient()));
    await screen.findAllByText('Carta 1');
    expect(vi.mocked(batchQuote)).toHaveBeenCalledTimes(2);
    expect(max).toBe(1);
  });

  it('«Reintentar» tras agotar los 3 reintentos vuelve a cotizar y termina bien', async () => {
    vi.mocked(batchQuote).mockRejectedValue(tooMany('1'));
    render(ui(newClient()));
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    const btn = await screen.findByRole('button', { name: /Reintentar/i });
    expect(vi.mocked(batchQuote)).toHaveBeenCalledTimes(4);
    vi.mocked(batchQuote).mockReset();
    vi.mocked(batchQuote).mockImplementation(async (items) => okBatch(items));
    fireEvent.click(btn);
    await screen.findAllByText('Carta 1');
    expect(vi.mocked(batchQuote)).toHaveBeenCalledTimes(2);
  });

  it('un error que NO es 429 no se reintenta (F16)', async () => {
    vi.mocked(batchQuote).mockRejectedValue(new ApiClientError(500, { code: 'INTERNAL', message: 'x' }));
    render(ui(newClient()));
    await screen.findByRole('button', { name: /Reintentar/i });
    expect(vi.mocked(batchQuote)).toHaveBeenCalledTimes(1);
  });

  it('un 429 de GET /buylist/cards también se reintenta (F10)', async () => {
    vi.mocked(searchBuylistCards).mockRejectedValueOnce(tooMany('2'));
    render(ui(newClient()));
    await screen.findByRole('status');
    expect(vi.mocked(searchBuylistCards)).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(2_500); });
    await screen.findAllByText('Carta 1');
    expect(vi.mocked(searchBuylistCards)).toHaveBeenCalledTimes(2);
  });

  it('el filtro «Acabado» no llama a la red', async () => {
    render(ui(newClient()));
    await screen.findAllByText('Carta 1');
    const calls = [vi.mocked(batchQuote).mock.calls.length, vi.mocked(searchBuylistCards).mock.calls.length];
    fireEvent.change(screen.getByLabelText('Acabado'), { target: { value: 'reverse_holo' } });
    expect([vi.mocked(batchQuote).mock.calls.length, vi.mocked(searchBuylistCards).mock.calls.length]).toEqual(calls);
  });

  it('I-1: la espera sobrevive al remontaje (el aviso aparece al reabrir el set durante la espera)', async () => {
    vi.mocked(batchQuote).mockImplementation(() => new Promise(() => {})); // consulta en curso
    setRateLimitWait('quoter:sv08', Date.now() + 30_000);
    render(ui(newClient()));
    expect(await screen.findByRole('status')).toHaveTextContent('Cotizando… continúa en 30 s');
    setRateLimitWait('quoter:sv08', null);
  });

  it('m-2: al salir del set se cancela la espera y no se lanzan más lotes', async () => {
    vi.mocked(batchQuote).mockRejectedValue(tooMany('5'));
    const view = render(ui(newClient()));
    await screen.findByRole('status');
    expect(vi.mocked(batchQuote)).toHaveBeenCalledTimes(1);
    view.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(vi.mocked(batchQuote)).toHaveBeenCalledTimes(1);
  });
});

describe('B-1 · la caché de 10 min es SOLO del cotizador', () => {
  const binderResp = { set: { id: 'sv08', name: 'S', ptcgoCode: 'S' }, printedTotal: 1, catalogCardCount: 0, cells: [], scope: 'platform' } as never;
  it.each([
    ['platform', getMasterSetBinder],
    ['user_vault_self', getVaultMasterSetBinder],
    ['user_vault_admin', getAdminVaultMasterSetBinder],
  ] as const)('%s reabre a los 5 min y vuelve a pedir (defaults de la base)', async (mode, fn) => {
    vi.mocked(fn).mockReset();
    vi.mocked(fn).mockResolvedValue(binderResp);
    const client = newClient();
    const first = render(ui(client, 'es', mode));
    await vi.waitFor(() => expect(vi.mocked(fn)).toHaveBeenCalledTimes(1));
    first.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60_000); });
    render(ui(client, 'es', mode));
    await vi.waitFor(() => expect(vi.mocked(fn)).toHaveBeenCalledTimes(2));
  });
});
