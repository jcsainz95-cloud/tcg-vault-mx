import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('@/lib/api/shipping-quote', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/shipping-quote')>();
  return { ...actual, postShippingQuote: vi.fn() };
});
import { postShippingQuote } from '@/lib/api/shipping-quote';
import { useShippingQuote } from './use-shipping-quote';

const items = [{ inventoryItemId: 'inv-1' }];
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);

beforeEach(() => vi.mocked(postShippingQuote).mockReset());

describe('§ENV3 M-1 · re-cotiza solo antes de que caduque el token', () => {
  it('a 60 s de `expiresAt` vuelve a pedir la cotización (sin acción del cliente) y adopta la nueva', async () => {
    vi.mocked(postShippingQuote)
      .mockResolvedValueOnce({ quoteId: 'sq-1', shippingFeeCents: 100, service: 'x', etaDays: 1, expiresAt: new Date(Date.now() + 60_150).toISOString() })
      .mockResolvedValue({ quoteId: 'sq-2', shippingFeeCents: 100, service: 'x', etaDays: 1, expiresAt: new Date(Date.now() + 1_800_000).toISOString() });
    const { result } = renderHook(() => useShippingQuote({ cp: '44100', items, enabled: true }), { wrapper });
    await waitFor(() => expect(result.current.quote?.quoteId).toBe('sq-1'));
    await waitFor(() => expect(result.current.quote?.quoteId).toBe('sq-2'), { timeout: 2000 });
    expect(postShippingQuote).toHaveBeenCalledTimes(2);
  });
});
