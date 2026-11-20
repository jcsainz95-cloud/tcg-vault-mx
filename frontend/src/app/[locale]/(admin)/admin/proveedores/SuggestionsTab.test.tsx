import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/render';
import { SuggestionsTab } from './SuggestionsTab';
import { RoleProvider } from '@/lib/role';
import * as api from '@/lib/api/supply-suggestions';

const settings = (over: Partial<api.SupplySettings> = {}): api.SupplySettings => ({
  autoPublish: true, autoAccept: false, defaultPctBps: 7000, weeklyBudgetCents: 500000, weekSpentCents: 12000,
  weekStartsAt: '2026-11-16T06:00:00Z', lastRunAt: null, ...over,
});
const view = () => renderWithProviders(<RoleProvider><SuggestionsTab /></RoleProvider>);

afterEach(() => vi.restoreAllMocks());

describe('§PROV-F4 · ajustes de sugeridas', () => {
  it('muestra interruptor, presupuesto en pesos y autoAccept apagado', async () => {
    vi.spyOn(api, 'getSupplySettings').mockResolvedValue(settings());
    vi.spyOn(api, 'listSupplySuggestions').mockResolvedValue({ data: [], page: 1, pageSize: 20, total: 0 });
    view();
    const sw = await screen.findByRole('switch');
    expect(sw.getAttribute('aria-checked')).toBe('true');
    expect((screen.getByLabelText(/presupuesto semanal/i) as HTMLInputElement).value).toBe('5000.00');
    expect(screen.getByText(/aceptar ofertas sigue siendo tuyo/i)).toBeTruthy();
    expect(screen.getByText('MX$120.00')).toBeTruthy();
  });

  it('presupuesto inválido bloquea guardar; válido envía centavos enteros', async () => {
    vi.spyOn(api, 'getSupplySettings').mockResolvedValue(settings());
    vi.spyOn(api, 'listSupplySuggestions').mockResolvedValue({ data: [], page: 1, pageSize: 20, total: 0 });
    const patch = vi.spyOn(api, 'patchSupplySettings').mockResolvedValue(settings());
    view();
    const input = (await screen.findByLabelText(/presupuesto semanal/i)) as HTMLInputElement;
    await userEvent.clear(input);
    await userEvent.type(input, 'abc');
    expect((screen.getByRole('button', { name: /guardar presupuesto/i }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.clear(input);
    await userEvent.type(input, '2500.50');
    await userEvent.click(screen.getByRole('button', { name: /guardar presupuesto/i }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith({ weeklyBudgetCents: 250050 }));
  });
});
