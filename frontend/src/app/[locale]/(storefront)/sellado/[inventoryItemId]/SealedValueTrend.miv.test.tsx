import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { SealedValueTrend } from './SealedValueTrend';
import * as api from '@/lib/api';
import type { SealedValueHistoryResponse } from '@/types/contract';

/**
 * §MIV.3 (v1.90⟨miv⟩) · tendencia del sellado con IVA (P-MIV-6 «sí», criterio 861).
 *
 * - MIV-F5: neto [190000, 200000], display [220400, 232000], `displayAbsMxnCents` 11600, `pct` 5.26 ⇒
 *   cifra grande «MX$2,320.00», «MX$116.00», «5.26 %», rótulo de IVA; la curva lleva los display.
 * - MIV-F6: sin campos `display*` (servidor sin §MIV) ⇒ el componente no se pinta.
 * - MIV-UX-3: grupo «MX$2,320.00 IVA 16 % incluido»; con `ivaRatePct={8}` dice «IVA 8 %»; en
 *   «Recopilando…» no hay rótulo.
 *
 * La curva: `recharts` se sustituye por un doble que expone el `data` que recibe, para afirmar QUÉ serie
 * se dibuja (en jsdom `ResponsiveContainer` mide 0 y no pinta nada).
 */

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  LineChart: ({ data }: { data: { v: number }[] }) => (
    <div data-testid="trend-chart" data-values={JSON.stringify(data.map((d) => d.v))} />
  ),
  Line: () => null,
}));

const F5: SealedValueHistoryResponse = {
  product: { inventoryItemId: 'inv-1008' },
  range: '1m',
  points: [
    { date: '2026-10-08', valueMxnCents: 190000, displayValueMxnCents: 220400, pricedCardCount: 1 },
    { date: '2026-10-09', valueMxnCents: 200000, displayValueMxnCents: 232000, pricedCardCount: 1 },
  ],
  change: { absMxnCents: 10000, pct: 5.26, direction: 'up', displayAbsMxnCents: 11600 },
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('MIV-F5 · la tendencia pinta SOLO las cifras con IVA; el % tal cual', () => {
  it('cifra grande, cambio en pesos, porcentaje, rótulo y curva', async () => {
    vi.spyOn(api, 'getSealedValueHistory').mockResolvedValue(F5);
    const { container } = renderWithProviders(<SealedValueTrend inventoryItemId="inv-1008" ivaRatePct={16} />, 'es');

    expect(await screen.findByText('MX$2,320.00')).toBeInTheDocument();
    expect(screen.getByText(/MX\$116\.00/)).toBeInTheDocument();
    expect(screen.getByText(/5\.26 %/)).toBeInTheDocument();
    expect(screen.getByTestId('iva-label')).toHaveTextContent('IVA 16 % incluido');
    // ⛔ ni el neto actual ni el cambio neto.
    expect(container.textContent).not.toContain('MX$2,000.00');
    expect(container.textContent).not.toContain('MX$100.00');
    // La curva va en la misma escala que la cifra (criterio 861).
    expect(JSON.parse(screen.getByTestId('trend-chart').getAttribute('data-values')!)).toEqual([220400, 232000]);
  });

  it('MIV-UX-3: grupo accesible «MX$2,320.00 IVA 16 % incluido», sin aria-label propio', async () => {
    vi.spyOn(api, 'getSealedValueHistory').mockResolvedValue(F5);
    renderWithProviders(<SealedValueTrend inventoryItemId="inv-1008" ivaRatePct={16} />, 'es');
    const g = await screen.findByRole('group', { name: 'MX$2,320.00 IVA 16 % incluido' });
    expect(g.getAttribute('aria-label')).toBeNull();
  });

  it('MIV-UX-3: la tasa es la prop (`ivaRatePct={8}` ⇒ «IVA 8 % incluido»), no un 16 fijo', async () => {
    vi.spyOn(api, 'getSealedValueHistory').mockResolvedValue(F5);
    renderWithProviders(<SealedValueTrend inventoryItemId="inv-1008" ivaRatePct={8} />, 'es');
    expect(await screen.findByTestId('iva-label')).toHaveTextContent('IVA 8 % incluido');
  });

  it('en inglés: «16 % VAT included» y la misma cifra', async () => {
    vi.spyOn(api, 'getSealedValueHistory').mockResolvedValue(F5);
    renderWithProviders(<SealedValueTrend inventoryItemId="inv-1008" ivaRatePct={16} />, 'en');
    expect(await screen.findByRole('group', { name: 'MX$2,320.00 16 % VAT included' })).toBeInTheDocument();
  });

  it('cambio con redondeo: el cambio en pesos es `displayAbsMxnCents`, no el neto ni otra cuenta', async () => {
    // Serie [1, 4] de §MIV.7 MIV-B7: displays [1, 5] ⇒ «MX$0.04»; el neto diría «MX$0.03».
    vi.spyOn(api, 'getSealedValueHistory').mockResolvedValue({
      product: {},
      range: '1m',
      points: [
        { date: '2026-10-08', valueMxnCents: 1, displayValueMxnCents: 1, pricedCardCount: 1 },
        { date: '2026-10-09', valueMxnCents: 4, displayValueMxnCents: 5, pricedCardCount: 1 },
      ],
      change: { absMxnCents: 3, pct: 300, direction: 'up', displayAbsMxnCents: 4 },
    });
    renderWithProviders(<SealedValueTrend inventoryItemId="inv-1008" ivaRatePct={16} />, 'es');
    expect(await screen.findByText(/MX\$0\.04/)).toBeInTheDocument();
    expect(screen.queryByText(/MX\$0\.03/)).toBeNull();
    expect(screen.getByText(/300\.00 %/)).toBeInTheDocument();
  });

  it('MIV-UX-3: «Recopilando historial…» (serie vacía) va SIN rótulo de IVA', async () => {
    vi.spyOn(api, 'getSealedValueHistory').mockResolvedValue({
      product: {},
      range: '1m',
      points: [],
      change: { absMxnCents: 0, pct: null, direction: 'flat', displayAbsMxnCents: 0 },
    });
    renderWithProviders(<SealedValueTrend inventoryItemId="inv-1008" ivaRatePct={16} />, 'es');
    expect(await screen.findByText('Recopilando historial de mercado.')).toBeInTheDocument();
    expect(screen.queryByTestId('iva-label')).toBeNull();
  });
});

describe('MIV-F6 · sin campos `display*` (servidor sin §MIV) ⇒ el componente se oculta; ⛔ nunca el neto', () => {
  const OLD = {
    set: { id: 'sealed:x', name: 'X' },
    range: '1m',
    points: [
      { date: '2026-10-08', valueMxnCents: 190000, pricedCardCount: 1 },
      { date: '2026-10-09', valueMxnCents: 200000, pricedCardCount: 1 },
    ],
    change: { absMxnCents: 10000, pct: 5.26, direction: 'up' },
  } as unknown as SealedValueHistoryResponse;

  it('respuesta vieja entera ⇒ nada en el DOM', async () => {
    const spy = vi.spyOn(api, 'getSealedValueHistory').mockResolvedValue(OLD);
    const { container } = renderWithProviders(<SealedValueTrend inventoryItemId="inv-1008" ivaRatePct={16} />, 'es');
    await waitFor(() => expect(spy).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(container.textContent).not.toContain('MX$2,000.00');
  });

  it('falta solo `change.displayAbsMxnCents` ⇒ también se oculta', async () => {
    const partial = {
      ...F5,
      change: { absMxnCents: 10000, pct: 5.26, direction: 'up' },
    } as unknown as SealedValueHistoryResponse;
    const spy = vi.spyOn(api, 'getSealedValueHistory').mockResolvedValue(partial);
    const { container } = renderWithProviders(<SealedValueTrend inventoryItemId="inv-1008" ivaRatePct={16} />, 'es');
    await waitFor(() => expect(spy).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('a un punto le falta `displayValueMxnCents` ⇒ también se oculta', async () => {
    const partial = {
      ...F5,
      points: [
        { date: '2026-10-08', valueMxnCents: 190000, pricedCardCount: 1 },
        F5.points[1],
      ],
    } as unknown as SealedValueHistoryResponse;
    const spy = vi.spyOn(api, 'getSealedValueHistory').mockResolvedValue(partial);
    const { container } = renderWithProviders(<SealedValueTrend inventoryItemId="inv-1008" ivaRatePct={16} />, 'es');
    await waitFor(() => expect(spy).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
