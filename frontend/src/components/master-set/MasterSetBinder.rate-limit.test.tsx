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
import { batchQuote, searchBuylistCards } from '@/lib/api';
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

function ui(client: QueryClient, locale: 'es' | 'en' = 'es') {
  return (
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale={locale} messages={locale === 'es' ? es : en}>
        <MasterSetBinder mode="quoter" set={set} onBack={() => {}} onOpenCell={() => {}} />
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
    expect(status).toHaveTextContent('Cotizando… un momento');
    expect(vi.mocked(batchQuote)).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(19_000); });
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
    expect(await screen.findByRole('status')).toHaveTextContent('Pricing… one moment');
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
});
