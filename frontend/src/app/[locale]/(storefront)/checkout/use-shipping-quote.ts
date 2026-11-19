'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  postShippingQuote,
  type ShippingQuoteDTO,
  type ShippingQuoteItemInput,
} from '@/lib/api/shipping-quote';

/** §ENV3.3: se cotiza al completar 5 dígitos, con debounce de 500 ms. En vitest () es 0; una prueba puede fijarlo. */
let debounceMs = process.env.NODE_ENV === 'test' ? 0 : 500;
export function setShippingQuoteDebounceMs(ms: number) {
  debounceMs = ms;
}

/** §ENV3.7: la cotización dura 30 min en el servidor; se refresca mucho antes de que llegue el 409. */
const STALE_MS = 10 * 60_000;

export type ShippingQuoteStatus = 'idle' | 'waiting' | 'ready' | 'error';

export interface ShippingQuoteState {
  status: ShippingQuoteStatus;
  quote: ShippingQuoteDTO | null;
  /** Reintenta la cotización (error de red o 5xx). */
  retry: () => void;
  /** 409 SHIPPING_QUOTE_STALE: adopta la cotización nueva que trae el error, sin pedirla otra vez. */
  adopt: (q: ShippingQuoteDTO) => void;
}

const CP_RE = /^\d{5}$/;

/**
 * §ENV3 — cotiza el envío del carrito al CP capturado. ⛔ No calcula ni suma nada: lo cobrado lo decide el servidor
 * (`shippingQuoteId` viaja a quote/session). Sin CP válido (o `enabled=false`) ⇒ `idle` y no se llama a nadie.
 */
export function useShippingQuote(args: { cp: string; items: ShippingQuoteItemInput[]; enabled: boolean }): ShippingQuoteState {
  const { cp, items, enabled } = args;
  const queryClient = useQueryClient();
  const validCp = CP_RE.test(cp) ? cp : '';
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    if (!validCp) {
      setDebounced('');
      return;
    }
    if (debounceMs <= 0) {
      setDebounced(validCp);
      return;
    }
    const id = setTimeout(() => setDebounced(validCp), debounceMs);
    return () => clearTimeout(id);
  }, [validCp]);

  const itemsKey = useMemo(() => JSON.stringify(items), [items]);
  const live = enabled && !!validCp && debounced === validCp && items.length > 0;
  const key = useMemo(() => ['shipping-quote', debounced, itemsKey] as const, [debounced, itemsKey]);
  const q = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => postShippingQuote({ cp: debounced, items }, signal),
    enabled: live,
    staleTime: STALE_MS,
    retry: 1,
    refetchOnWindowFocus: false,
  });

  const retry = useCallback(() => {
    void q.refetch();
  }, [q]);
  const adopt = useCallback(
    (nq: ShippingQuoteDTO) => {
      queryClient.setQueryData(key, nq);
    },
    [queryClient, key],
  );

  if (!enabled || !validCp || items.length === 0) return { status: 'idle', quote: null, retry, adopt };
  // CP escrito pero aún en el debounce, o petición en vuelo: «esperando». Nunca se enseña una cifra de otro CP.
  if (!live || q.isPending) return { status: 'waiting', quote: null, retry, adopt };
  if (q.isError) return { status: 'error', quote: null, retry, adopt };
  return { status: 'ready', quote: q.data ?? null, retry, adopt };
}
